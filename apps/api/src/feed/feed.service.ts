import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DrizzleDB } from '../db/drizzle.provider';
import { userInterests } from '../db/schema';
import { AiService } from '../ai/ai.service';

export interface FeedArticle {
  title: string;
  summary: string | null;
  url: string;
  source: string;
  publishedAt: string | null;
  imageUrl: string | null;
  score: number;
}

export interface FeedResponse {
  hasMatches: boolean;
  articles: FeedArticle[];
  fallback: FeedArticle[];
}

export interface DebugFeedArticle {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  source: string;
  cosineDistance: number;
  similarityScore: number;
}

export interface DebugFeedResponse {
  queryText: string;
  articles: DebugFeedArticle[];
}

// Cosine distance below this = article is relevant to user interests
const RELEVANCE_THRESHOLD = 0.5;

// Articles newer than this are considered "today's feed"
const RECENCY_DAYS = 1;

// How much to reduce distance for articles whose tags overlap user interests
const TAG_BONUS = 0.15;

// Max number of articles to return in the personalized feed (top N after ranking + filters)
const FEED_LIMIT = 5;

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    private readonly aiService: AiService,
  ) {}

  async getPersonalizedFeed(userId: string): Promise<FeedResponse> {
    try {
      const interestRow = await this.db
        .select({
          tags: userInterests.tags,
          queryEmbedding: userInterests.queryEmbedding,
        })
        .from(userInterests)
        .where(eq(userInterests.userId, userId))
        .limit(1);

      const tags = interestRow[0]?.tags ?? [];
      const cachedEmbedding = interestRow[0]?.queryEmbedding;

      // Richer query text gives the embedding model more context than bare keywords
      const queryText =
        tags.length > 0
          ? `software engineering articles about ${tags.join(', ')} for developers`
          : 'software development programming tutorials';

      let embedding: number[];
      if (cachedEmbedding && cachedEmbedding.length > 0) {
        this.logger.log(`Using cached embedding for user ${userId}`);
        embedding = cachedEmbedding;
      } else {
        this.logger.log(
          `Generating embedding for user ${userId} | query: "${queryText}"`,
        );
        try {
          embedding = await this.aiService.embed(queryText);
          if (interestRow.length > 0) {
            await this.db
              .update(userInterests)
              .set({ queryEmbedding: embedding, updatedAt: new Date() })
              .where(eq(userInterests.userId, userId));
          }
        } catch (err) {
          this.logger.error(
            `Failed to generate embedding for user ${userId} — returning empty feed: ${err}`,
          );
          return { hasMatches: false, articles: [], fallback: [] };
        }
      }

      const embeddingStr = `[${embedding.join(',')}]`;
      const recencyCutoff = new Date(
        Date.now() - RECENCY_DAYS * 24 * 60 * 60 * 1000,
      );

      const rows = await this.db.execute<{
        id: string;
        title: string;
        url: string;
        source: string;
        summary: string | null;
        created_at: string;
        published_at: string | null;
        image_url: string | null;
        tags: string[];
        cosine_distance: string;
      }>(
        sql`
          SELECT id, title, url, source, summary, created_at, published_at, image_url, tags,
            (embedding <=> ${embeddingStr}::vector) AS cosine_distance
          FROM articles
          WHERE embedding IS NOT NULL AND created_at >= ${recencyCutoff.toISOString()}::timestamp
          ORDER BY cosine_distance
          LIMIT 60
        `,
      );

      const userTagsLower = tags.map((t) => t.toLowerCase());

      const allArticles = rows.rows.map((r) => {
        const articleTags: string[] = Array.isArray(r.tags) ? r.tags : [];
        const matchedTags =
          userTagsLower.length > 0
            ? articleTags.filter((t) => userTagsLower.includes(t.toLowerCase()))
            : [];
        const tagBoost = Math.min(0.3, matchedTags.length * TAG_BONUS);
        const raw = Number(r.cosine_distance);
        const distance = Math.max(0, (isNaN(raw) ? 1 : raw) - tagBoost);
        const score = Math.max(0, Math.min(1, 1 - distance));

        return {
          title: r.title,
          summary: r.summary,
          url: r.url,
          source: r.source,
          createdAt: r.created_at ? new Date(r.created_at) : new Date(0),
          publishedAt: r.published_at ? new Date(r.published_at) : null,
          imageUrl: r.image_url,
          distance,
          score,
        };
      });

      // Recent articles that pass the relevance threshold
      const matched = allArticles.filter(
        (a) => a.createdAt >= recencyCutoff && a.distance < RELEVANCE_THRESHOLD,
      );

      if (matched.length > 0) {
        // Sort matching articles by match score descending
        matched.sort((a, b) => b.score - a.score);

        const selectedArticles: typeof matched = [];
        const selectedSources = new Set<string>();

        // First pass: select the highest ranking article from each unique source
        for (const article of matched) {
          if (selectedArticles.length >= FEED_LIMIT) break;
          if (!selectedSources.has(article.source)) {
            selectedArticles.push(article);
            selectedSources.add(article.source);
          }
        }

        // Second pass: fill the remaining slots with the next best matches
        if (selectedArticles.length < FEED_LIMIT) {
          for (const article of matched) {
            if (selectedArticles.length >= FEED_LIMIT) break;
            if (!selectedArticles.some((a) => a.url === article.url)) {
              selectedArticles.push(article);
            }
          }
        }

        // Re-sort the final selection by score descending
        selectedArticles.sort((a, b) => b.score - a.score);

        this.logger.log(
          `${selectedArticles.length} diverse articles matched interests within last ${RECENCY_DAYS} days`,
        );
        return {
          hasMatches: true,
          articles: selectedArticles.map(toFeedArticle),
          fallback: [],
        };
      }

      // Nothing new today — return empty feed (no fallback archive feed anymore)
      this.logger.log(
        `No recent matches — returning empty feed for user ${userId}`,
      );
      return {
        hasMatches: false,
        articles: [],
        fallback: [],
      };
    } catch (err) {
      this.logger.error(
        `Unexpected error building personalized feed for user ${userId}: ${err}`,
      );
      return { hasMatches: false, articles: [], fallback: [] };
    }
  }

  async getDebugFeed(userId: string): Promise<DebugFeedResponse> {
    try {
      const interestRow = await this.db
        .select({
          tags: userInterests.tags,
          queryEmbedding: userInterests.queryEmbedding,
        })
        .from(userInterests)
        .where(eq(userInterests.userId, userId))
        .limit(1);

      const tags = interestRow[0]?.tags ?? [];
      const cachedEmbedding = interestRow[0]?.queryEmbedding;
      const queryText =
        tags.length > 0
          ? `software engineering articles about ${tags.join(', ')} for developers`
          : 'software development programming tutorials';

      let embedding: number[];
      if (cachedEmbedding && cachedEmbedding.length > 0) {
        this.logger.log(`Using cached embedding for user ${userId} (debug)`);
        embedding = cachedEmbedding;
      } else {
        this.logger.log(
          `Generating embedding for user ${userId} (debug) | query: "${queryText}"`,
        );
        try {
          embedding = await this.aiService.embed(queryText);
          if (interestRow.length > 0) {
            await this.db
              .update(userInterests)
              .set({ queryEmbedding: embedding, updatedAt: new Date() })
              .where(eq(userInterests.userId, userId));
          }
        } catch (err) {
          this.logger.error(
            `Failed to generate embedding for user ${userId} (debug): ${err}`,
          );
          return { queryText, articles: [] };
        }
      }

      const embeddingStr = `[${embedding.join(',')}]`;

      const rows = await this.db.execute<{
        id: string;
        title: string;
        url: string;
        source: string;
        summary: string | null;
        cosine_distance: string;
      }>(
        sql`
          SELECT id, title, url, source, summary,
            (embedding <=> ${embeddingStr}::vector) AS cosine_distance
          FROM articles
          WHERE embedding IS NOT NULL
          ORDER BY cosine_distance
          LIMIT 20
        `,
      );

      return {
        queryText,
        articles: rows.rows.map((r) => ({
          id: r.id,
          title: r.title,
          summary: r.summary,
          url: r.url,
          source: r.source,
          cosineDistance: Number(r.cosine_distance),
          similarityScore: 1 - Number(r.cosine_distance),
        })),
      };
    } catch (err) {
      this.logger.error(
        `Unexpected error in debug feed for user ${userId}: ${err}`,
      );
      const queryText = 'debug query';
      return { queryText, articles: [] };
    }
  }
}

function toFeedArticle(a: {
  title: string;
  summary: string | null;
  url: string;
  source: string;
  publishedAt?: Date | null;
  createdAt?: Date | null;
  imageUrl?: string | null;
  score: number;
}): FeedArticle {
  const date = a.publishedAt || a.createdAt || null;
  return {
    title: a.title,
    summary: a.summary,
    url: a.url,
    source: a.source,
    publishedAt: date ? date.toISOString() : null,
    imageUrl: a.imageUrl || null,
    score: a.score,
  };
}
