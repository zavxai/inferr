import { Inject, Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { eq, desc, not, inArray, lt } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DrizzleDB } from '../db/drizzle.provider';
import { articles, NewArticle, userInterests } from '../db/schema';

export interface ScrapeResult {
  hn: number;
  devto: number;
  content: { saved: number; skipped: number };
}

interface SavedArticle {
  id: string;
  url: string;
}

interface HNHit {
  objectID: string;
  title: string;
  url?: string;
  story_text?: string;
  created_at: string;
}

interface DevToArticle {
  id: number;
  title: string;
  url: string;
  published_at: string;
  tag_list: string[];
  cover_image?: string;
}

interface RedditChild {
  data: {
    title: string;
    url: string;
    created_utc: number;
  };
}

interface RedditSearchResponse {
  data?: {
    children?: RedditChild[];
  };
}

interface TechCrunchPost {
  title?: {
    rendered?: string;
  };
  link?: string;
  date?: string;
  jetpack_featured_media_url?: string;
}

interface GitHubItem {
  full_name: string;
  description: string | null;
  html_url: string;
  created_at: string;
}

interface GitHubSearchResponse {
  items?: GitHubItem[];
}

const CONTENT_MAX_CHARS = 8000;
const FETCH_TIMEOUT_MS = 10_000;
const CONTENT_CONCURRENCY = 5;

/**
 * Age-based retention for the article corpus.
 * We keep articles for this window so that semantic search, ask_inferr (RAG),
 * and MCP tools have a useful body of knowledge instead of only the last ~100 items.
 * The personalized feed applies its own much stricter recency filter at query time.
 */
const ARTICLE_RETENTION_DAYS = 45;

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  constructor(@Inject(DRIZZLE) private db: DrizzleDB) {}

  async scrapeAll(): Promise<ScrapeResult> {
    const tags = await this.getUniqueUserInterests();
    this.logger.log(
      `Running balanced scraper for active user interests: ${tags.join(', ')}`,
    );

    const [
      hn,
      devto,
      redditProg,
      redditWebdev,
      lobsters,
      hashnode,
      medium,
      techcrunch,
      github,
      hackernoon,
    ] = await Promise.all([
      this.scrapeHackerNews(tags),
      this.scrapeDevTo(tags),
      this.scrapeRedditProgramming(tags),
      this.scrapeRedditWebdev(tags),
      this.scrapeLobsters(tags),
      this.scrapeHashnode(tags),
      this.scrapeMedium(tags),
      this.scrapeTechCrunch(tags),
      this.scrapeGitHub(tags),
      this.scrapeHackerNoon(tags),
    ]);

    const allScraped = [
      ...hn,
      ...devto,
      ...redditProg,
      ...redditWebdev,
      ...lobsters,
      ...hashnode,
      ...medium,
      ...techcrunch,
      ...github,
      ...hackernoon,
    ];

    // Keep only articles published within the last 24 hours
    const recencyCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const freshArticles = allScraped.filter((art) => {
      const pubDate = art.publishedAt ? new Date(art.publishedAt) : null;
      return pubDate && pubDate >= recencyCutoff;
    });

    // Deduplicate globally by URL to prevent saving duplicates in the same run
    const uniqueMap = new Map<string, NewArticle>();
    for (const art of freshArticles) {
      if (art.url) {
        uniqueMap.set(art.url, art);
      }
    }
    const uniqueArticles = Array.from(uniqueMap.values());
    this.logger.log(
      `Scraped ${uniqueArticles.length} unique articles across 10 sources (filtered to last 24h from ${allScraped.length} total)`,
    );

    // Save articles (deduplicating in DB via onConflictDoNothing)
    const newArticles = await this.saveArticles(uniqueArticles);

    // Fetch full page content for new articles
    const content = await this.scrapeContentForArticles(newArticles);

    // Prune using the retention policy.
    // Age-based retention builds a meaningful corpus for RAG, search_articles,
    // and ask_inferr. The /feed endpoint does its own 1-day recency filter.
    await this.cleanOldArticles();

    return {
      hn: hn.length,
      devto: devto.length,
      content,
    };
  }

  /**
   * Removes stale articles from the corpus.
   *
   * Default behavior (recommended): age-based retention using ARTICLE_RETENTION_DAYS.
   * This is what keeps a healthy body of articles for semantic search + RAG.
   *
   * Pass a positive keepCount to use the old "keep only the N newest" strategy
   * (used by some tests and the manual /scraper/run trigger if desired).
   */
  async cleanOldArticles(keepCount?: number): Promise<number> {
    if (keepCount && keepCount > 0) {
      // Legacy keep-N mode (mainly for tests / manual one-off calls)
      this.logger.log(
        `Pruning database to keep only the ${keepCount} most recent articles (legacy keep-N mode)...`,
      );
      const recent = await this.db
        .select({ id: articles.id })
        .from(articles)
        .orderBy(desc(articles.createdAt))
        .limit(keepCount);

      const recentIds = recent.map((a) => a.id);
      if (recentIds.length === 0) return 0;

      const deleted = await this.db
        .delete(articles)
        .where(not(inArray(articles.id, recentIds)))
        .returning({ id: articles.id });

      this.logger.log(`Pruned ${deleted.length} older articles.`);
      return deleted.length;
    }

    // Default: age-based pruning. This is the key fix for corpus size.
    const cutoff = new Date(
      Date.now() - ARTICLE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    this.logger.log(
      `Pruning articles older than ${ARTICLE_RETENTION_DAYS} days (cutoff=${cutoff.toISOString()})...`,
    );

    const deleted = await this.db
      .delete(articles)
      .where(lt(articles.createdAt, cutoff))
      .returning({ id: articles.id });

    this.logger.log(
      `Pruned ${deleted.length} articles past the retention window.`,
    );
    return deleted.length;
  }

  async getUniqueUserInterests(): Promise<string[]> {
    const rows = await this.db
      .select({ tags: userInterests.tags })
      .from(userInterests);
    const tagsSet = new Set<string>();
    for (const row of rows) {
      if (Array.isArray(row.tags)) {
        for (const tag of row.tags) {
          const trimmed = tag.trim().toLowerCase();
          if (trimmed) {
            tagsSet.add(trimmed);
          }
        }
      }
    }

    const uniqueTags = Array.from(tagsSet);
    if (uniqueTags.length > 0) {
      return uniqueTags;
    }

    // Fallback tags (broad tech domains)
    return [
      'ai',
      'webdev',
      'devops',
      'security',
      'database',
      'system-design',
      'open-source',
      'mobile',
      'hardware',
      'blockchain',
    ];
  }

  async scrapeHackerNews(tags: string[]): Promise<NewArticle[]> {
    this.logger.log(`Scraping Hacker News for tags: ${tags.join(', ')}`);
    const results = await Promise.all(
      tags.map(async (tag) => {
        try {
          const res = await fetch(
            `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(tag)}&tags=story&hitsPerPage=5`,
          );
          if (!res.ok) return [];
          const data = (await res.json()) as { hits: HNHit[] };
          return data.hits
            .filter((hit) => hit.url)
            .map((hit) => ({
              title: hit.title,
              url: hit.url!,
              source: 'hn',
              tags: [tag],
              publishedAt: new Date(hit.created_at),
            }));
        } catch (err) {
          this.logger.warn(`Failed to scrape HN for tag ${tag}: ${err}`);
          return [];
        }
      }),
    );
    return results.flat();
  }

  async scrapeDevTo(tags: string[]): Promise<NewArticle[]> {
    this.logger.log(`Scraping Dev.to for tags: ${tags.join(', ')}`);
    const results = await Promise.all(
      tags.map(async (tag) => {
        try {
          const res = await fetch(
            `https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&per_page=5`,
            {
              headers: { 'User-Agent': 'ai-developer-feed/1.0' },
            },
          );
          if (!res.ok) return [];
          const data = (await res.json()) as DevToArticle[];
          return data.map((article) => ({
            title: article.title,
            url: article.url,
            source: 'devto',
            tags: article.tag_list ?? [tag],
            publishedAt: new Date(article.published_at),
            imageUrl: article.cover_image || null,
          }));
        } catch (err) {
          this.logger.warn(`Failed to scrape Dev.to for tag ${tag}: ${err}`);
          return [];
        }
      }),
    );
    return results.flat();
  }

  async scrapeRedditProgramming(tags: string[]): Promise<NewArticle[]> {
    this.logger.log(
      `Scraping Reddit /r/programming for tags: ${tags.join(', ')}`,
    );
    const results = await Promise.all(
      tags.map(async (tag) => {
        try {
          const res = await fetch(
            `https://www.reddit.com/r/programming/search.json?q=${encodeURIComponent(tag)}&restrict_sr=1&sort=new&limit=5`,
            { headers: { 'User-Agent': 'ai-developer-feed/1.0' } },
          );
          if (!res.ok) return [];
          const data = (await res.json()) as RedditSearchResponse;
          const children = data?.data?.children ?? [];
          return children
            .filter((c) => c?.data?.url)
            .map((c) => ({
              title: c.data.title,
              url: c.data.url,
              source: 'reddit_programming',
              tags: [tag],
              publishedAt: new Date(c.data.created_utc * 1000),
            }));
        } catch (err) {
          this.logger.warn(
            `Failed to scrape Reddit /r/programming for tag ${tag}: ${err}`,
          );
          return [];
        }
      }),
    );
    return results.flat();
  }

  async scrapeRedditWebdev(tags: string[]): Promise<NewArticle[]> {
    this.logger.log(`Scraping Reddit /r/webdev for tags: ${tags.join(', ')}`);
    const results = await Promise.all(
      tags.map(async (tag) => {
        try {
          const res = await fetch(
            `https://www.reddit.com/r/webdev/search.json?q=${encodeURIComponent(tag)}&restrict_sr=1&sort=new&limit=5`,
            { headers: { 'User-Agent': 'ai-developer-feed/1.0' } },
          );
          if (!res.ok) return [];
          const data = (await res.json()) as RedditSearchResponse;
          const children = data?.data?.children ?? [];
          return children
            .filter((c) => c?.data?.url)
            .map((c) => ({
              title: c.data.title,
              url: c.data.url,
              source: 'reddit_webdev',
              tags: [tag],
              publishedAt: new Date(c.data.created_utc * 1000),
            }));
        } catch (err) {
          this.logger.warn(
            `Failed to scrape Reddit /r/webdev for tag ${tag}: ${err}`,
          );
          return [];
        }
      }),
    );
    return results.flat();
  }

  async scrapeLobsters(tags: string[]): Promise<NewArticle[]> {
    this.logger.log(`Scraping Lobste.rs for tags: ${tags.join(', ')}`);
    const results = await Promise.all(
      tags.map(async (tag) => {
        try {
          const res = await fetch(
            `https://lobste.rs/t/${encodeURIComponent(tag)}.rss`,
          );
          if (!res.ok) return [];
          const xml = await res.text();
          const $ = cheerio.load(xml, { xmlMode: true });
          const mapped: NewArticle[] = [];
          $('item').each((_, el) => {
            if (mapped.length >= 5) return;
            const title = $(el).find('title').text().trim();
            const url = $(el).find('link').text().trim();
            const pubDateText = $(el).find('pubDate').text().trim();
            if (title && url) {
              mapped.push({
                title,
                url,
                source: 'lobsters',
                tags: [tag],
                publishedAt: pubDateText ? new Date(pubDateText) : new Date(),
              });
            }
          });
          return mapped;
        } catch (err) {
          this.logger.warn(`Failed to scrape Lobste.rs for tag ${tag}: ${err}`);
          return [];
        }
      }),
    );
    return results.flat();
  }

  async scrapeHashnode(tags: string[]): Promise<NewArticle[]> {
    this.logger.log(`Scraping Hashnode for tags: ${tags.join(', ')}`);
    const results = await Promise.all(
      tags.map(async (tag) => {
        try {
          const res = await fetch(
            `https://hashnode.com/n/${encodeURIComponent(tag)}/rss`,
          );
          if (!res.ok) return [];
          const xml = await res.text();
          const $ = cheerio.load(xml, { xmlMode: true });
          const mapped: NewArticle[] = [];
          $('item').each((_, el) => {
            if (mapped.length >= 5) return;
            const title = $(el).find('title').text().trim();
            const url = $(el).find('link').text().trim();
            const pubDateText = $(el).find('pubDate').text().trim();
            if (title && url) {
              mapped.push({
                title,
                url,
                source: 'hashnode',
                tags: [tag],
                publishedAt: pubDateText ? new Date(pubDateText) : new Date(),
              });
            }
          });
          return mapped;
        } catch (err) {
          this.logger.warn(`Failed to scrape Hashnode for tag ${tag}: ${err}`);
          return [];
        }
      }),
    );
    return results.flat();
  }

  async scrapeMedium(tags: string[]): Promise<NewArticle[]> {
    this.logger.log(`Scraping Medium for tags: ${tags.join(', ')}`);
    const results = await Promise.all(
      tags.map(async (tag) => {
        try {
          const res = await fetch(
            `https://medium.com/feed/tag/${encodeURIComponent(tag)}`,
          );
          if (!res.ok) return [];
          const xml = await res.text();
          const $ = cheerio.load(xml, { xmlMode: true });
          const mapped: NewArticle[] = [];
          $('item').each((_, el) => {
            if (mapped.length >= 5) return;
            const title = $(el).find('title').text().trim();
            const url = $(el).find('link').text().trim();
            const pubDateText = $(el).find('pubDate').text().trim();
            if (title && url) {
              mapped.push({
                title,
                url,
                source: 'medium',
                tags: [tag],
                publishedAt: pubDateText ? new Date(pubDateText) : new Date(),
              });
            }
          });
          return mapped;
        } catch (err) {
          this.logger.warn(`Failed to scrape Medium for tag ${tag}: ${err}`);
          return [];
        }
      }),
    );
    return results.flat();
  }

  async scrapeTechCrunch(tags: string[]): Promise<NewArticle[]> {
    this.logger.log(`Scraping TechCrunch for tags: ${tags.join(', ')}`);
    const results = await Promise.all(
      tags.map(async (tag) => {
        try {
          const res = await fetch(
            `https://techcrunch.com/wp-json/wp/v2/posts?search=${encodeURIComponent(tag)}&per_page=5`,
          );
          if (!res.ok) return [];
          const data = (await res.json()) as TechCrunchPost[];
          return data.map((post) => ({
            title: post?.title?.rendered ?? '',
            url: post?.link ?? '',
            source: 'techcrunch',
            tags: [tag],
            publishedAt: post?.date ? new Date(post.date) : new Date(),
            imageUrl: post?.jetpack_featured_media_url || null,
          }));
        } catch (err) {
          this.logger.warn(
            `Failed to scrape TechCrunch for tag ${tag}: ${err}`,
          );
          return [];
        }
      }),
    );
    return results.flat();
  }

  async scrapeGitHub(tags: string[]): Promise<NewArticle[]> {
    this.logger.log(`Scraping GitHub for tags: ${tags.join(', ')}`);
    const results = await Promise.all(
      tags.map(async (tag) => {
        try {
          const res = await fetch(
            `https://api.github.com/search/repositories?q=${encodeURIComponent(tag)}&sort=stars&order=desc&per_page=5`,
            { headers: { 'User-Agent': 'ai-developer-feed/1.0' } },
          );
          if (!res.ok) return [];
          const data = (await res.json()) as GitHubSearchResponse;
          const items = data?.items ?? [];
          return items.map((item) => ({
            title: `${item.full_name}: ${item.description || ''}`,
            url: item.html_url,
            source: 'github',
            tags: [tag],
            publishedAt: item.created_at
              ? new Date(item.created_at)
              : new Date(),
          }));
        } catch (err) {
          this.logger.warn(`Failed to scrape GitHub for tag ${tag}: ${err}`);
          return [];
        }
      }),
    );
    return results.flat();
  }

  async scrapeHackerNoon(tags: string[]): Promise<NewArticle[]> {
    this.logger.log(`Scraping HackerNoon for tags: ${tags.join(', ')}`);
    const results = await Promise.all(
      tags.map(async (tag) => {
        try {
          const res = await fetch(
            `https://hackernoon.com/feed/tag/${encodeURIComponent(tag)}`,
          );
          if (!res.ok) return [];
          const xml = await res.text();
          const $ = cheerio.load(xml, { xmlMode: true });
          const mapped: NewArticle[] = [];
          $('item').each((_, el) => {
            if (mapped.length >= 5) return;
            const title = $(el).find('title').text().trim();
            const url = $(el).find('link').text().trim();
            const pubDateText = $(el).find('pubDate').text().trim();
            if (title && url) {
              mapped.push({
                title,
                url,
                source: 'hackernoon',
                tags: [tag],
                publishedAt: pubDateText ? new Date(pubDateText) : new Date(),
              });
            }
          });
          return mapped;
        } catch (err) {
          this.logger.warn(
            `Failed to scrape HackerNoon for tag ${tag}: ${err}`,
          );
          return [];
        }
      }),
    );
    return results.flat();
  }

  private async saveArticles(rows: NewArticle[]): Promise<SavedArticle[]> {
    if (rows.length === 0) return [];

    const inserted = await this.db
      .insert(articles)
      .values(rows)
      .onConflictDoNothing({ target: articles.url })
      .returning({ id: articles.id, url: articles.url });

    // Update tags for articles that already existed — covers pre-migration rows
    // that defaulted to [] and Dev.to articles whose tags change between scrapes.
    // Only newly inserted rows are returned so content scraping stays scoped to new articles.
    const insertedUrls = new Set(inserted.map((r) => r.url));
    const existingWithTags = rows.filter(
      (r) => !insertedUrls.has(r.url) && (r.tags ?? []).length > 0,
    );
    if (existingWithTags.length > 0) {
      await Promise.all(
        existingWithTags.map((row) =>
          this.db
            .update(articles)
            .set({ tags: row.tags ?? [] })
            .where(eq(articles.url, row.url)),
        ),
      );
      this.logger.log(
        `Updated tags for ${existingWithTags.length} existing articles`,
      );
    }

    this.logger.log(
      `Saved ${inserted.length} new articles (skipped ${rows.length - inserted.length} duplicates)`,
    );
    return inserted;
  }

  /**
   * Fetches the article's webpage and extracts readable text.
   * Returns null on any failure (timeout, non-200, parse error) so the
   * pipeline can skip silently — many sites block bots or paywall content.
   */
  async fetchContentAndImage(
    url: string,
  ): Promise<{ content: string | null; imageUrl: string | null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'ai-developer-feed/1.0' },
      });
      if (!res.ok) return { content: null, imageUrl: null };

      const html = await res.text();
      const $ = cheerio.load(html);

      // Extract image URL from Open Graph or Twitter Card tags
      const imageUrl =
        $('meta[property="og:image"]').attr('content') ||
        $('meta[name="twitter:image"]').attr('content') ||
        $('link[rel="image_src"]').attr('href') ||
        null;

      // Strip noise before extracting text
      $('script, style, nav, header, footer, aside').remove();

      let text = $('article').text().trim();
      if (!text) text = $('main').text().trim();
      if (!text) {
        text = $('p')
          .map((_, el) => $(el).text())
          .get()
          .join(' ')
          .trim();
      }

      const cleaned = text.replace(/\s+/g, ' ').trim();
      if (!cleaned) return { content: null, imageUrl };

      return {
        content: cleaned.slice(0, CONTENT_MAX_CHARS),
        imageUrl: imageUrl ? imageUrl.trim() : null,
      };
    } catch {
      return { content: null, imageUrl: null };
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchContent(url: string): Promise<string | null> {
    const res = await this.fetchContentAndImage(url);
    return res.content;
  }

  /**
   * Fetches and stores content and images for newly-inserted articles, in batches of
   * CONTENT_CONCURRENCY to avoid hammering sites or spiking memory.
   */
  private async scrapeContentForArticles(
    newArticles: SavedArticle[],
  ): Promise<{ saved: number; skipped: number }> {
    if (newArticles.length === 0) return { saved: 0, skipped: 0 };

    this.logger.log(
      `Fetching content and images for ${newArticles.length} articles...`,
    );

    let saved = 0;
    let skipped = 0;

    for (let i = 0; i < newArticles.length; i += CONTENT_CONCURRENCY) {
      const batch = newArticles.slice(i, i + CONTENT_CONCURRENCY);

      const results = await Promise.all(
        batch.map(async (article) => {
          const fetchRes = await this.fetchContentAndImage(article.url);
          return {
            id: article.id,
            content: fetchRes.content,
            imageUrl: fetchRes.imageUrl,
          };
        }),
      );

      const successful = results.filter((r) => r.content !== null);
      skipped += results.length - successful.length;

      if (successful.length > 0) {
        await Promise.all(
          successful.map((r) =>
            this.db
              .update(articles)
              .set({
                content: r.content,
                imageUrl: r.imageUrl,
              })
              .where(eq(articles.id, r.id)),
          ),
        );
        saved += successful.length;
      }
    }

    this.logger.log(
      `Content and images fetched — saved: ${saved}, skipped: ${skipped}`,
    );
    return { saved, skipped };
  }
}
