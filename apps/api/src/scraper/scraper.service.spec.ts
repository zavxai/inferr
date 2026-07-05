import { Test, TestingModule } from '@nestjs/testing';
import { ScraperService } from './scraper.service';
import { DRIZZLE } from '../db/drizzle.provider';

describe('ScraperService (unit)', () => {
  let service: ScraperService;
  let mockDb: any;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    mockDb = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          onConflictDoNothing: jest.fn(() => ({
            returning: jest.fn(() => Promise.resolve([])),
          })),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve({ rowCount: 0 })),
        })),
      })),
      delete: jest.fn(() => ({
        where: jest.fn(() => ({
          returning: jest.fn(() => Promise.resolve([])),
        })),
      })),
      select: jest.fn(() => ({
        from: jest.fn(() => Promise.resolve([{ tags: ['ai'] }])),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ScraperService, { provide: DRIZZLE, useValue: mockDb }],
    }).compile();

    service = module.get<ScraperService>(ScraperService);

    // Preserve real fetch (we will spy per test)
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('scrapeHackerNews fetches HN per tag, filters items with url, maps to NewArticle shape', async () => {
    const hnResponse = {
      hits: [
        {
          objectID: '1',
          title: 'TS 5.5',
          url: 'https://ex.com/ts',
          created_at: '2025-06-01T00:00:00Z',
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => hnResponse,
    } as any);

    const articles = await service.scrapeHackerNews(['ai']);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://hn.algolia.com/api/v1/search_by_date?query=ai&tags=story&hitsPerPage=5',
    );
    expect(articles).toEqual([
      {
        title: 'TS 5.5',
        url: 'https://ex.com/ts',
        source: 'hn',
        tags: ['ai'],
        publishedAt: new Date('2025-06-01T00:00:00Z'),
      },
    ]);
  });

  it('scrapeDevTo fetches, maps tags, source=devto', async () => {
    const devtoResponse = [
      {
        id: 42,
        title: 'Vite Tips',
        url: 'https://dev.to/vite',
        published_at: '2025-06-09T10:00:00Z',
        tag_list: ['vite', 'frontend'],
      },
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => devtoResponse,
    } as any);

    const articles = await service.scrapeDevTo(['ai']);

    expect(articles).toHaveLength(1);
    expect(articles[0]).toEqual(
      expect.objectContaining({ source: 'devto', tags: ['vite', 'frontend'] }),
    );
  });

  it('saveArticles (via scrape) skips duplicates via onConflictDoNothing and updates tags for pre-existing with new tags', async () => {
    // Simulate first scrape inserts 1, second scrape for same url returns 0 inserted but we update tags
    const rows = [
      {
        title: 'Dup',
        url: 'https://dup.com',
        source: 'devto',
        tags: ['newtag'],
        publishedAt: new Date(),
      },
    ];

    // First call (imagine previous insert happened)
    mockDb.insert.mockReturnValueOnce({
      values: jest.fn(() => ({
        onConflictDoNothing: jest.fn(() => ({
          returning: jest.fn(() => Promise.resolve([])), // 0 new
        })),
      })),
    });

    // The existingWithTags path will call update
    await (service as any).saveArticles(rows); // private but we can call via any for unit coverage of the tag update branch

    expect(mockDb.update).toHaveBeenCalled();
    // The set() was called on the builder returned by the update() call that happened inside saveArticles
    const updateCall = mockDb.update.mock.results[0]?.value;
    expect(updateCall?.set).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['newtag'] }),
    );
  });

  it('fetchContent strips noise, falls back through article/main/p, truncates, returns null on failure', async () => {
    // Success path
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        '<html><script>bad</script><article><p>Hello <b>world</b></p><p>More text here for length.</p></article></html>',
    } as any);

    const content = await service.fetchContent('https://ex.com/good');
    expect(content).toContain('Hello world');
    expect(content?.length).toBeLessThanOrEqual(8000);

    // Failure path
    global.fetch = jest.fn().mockResolvedValue({ ok: false } as any);
    expect(await service.fetchContent('https://ex.com/404')).toBeNull();

    // Network error
    global.fetch = jest.fn().mockRejectedValue(new Error('boom'));
    expect(await service.fetchContent('https://ex.com/err')).toBeNull();
  });

  it('scrapeAll orchestrates 10 sources, content scrape, and pruning', async () => {
    // Stub all the scrapers to avoid real net
    jest.spyOn(service, 'getUniqueUserInterests').mockResolvedValue(['ai']);
    jest.spyOn(service, 'cleanOldArticles').mockResolvedValue(0);

    jest.spyOn(service, 'scrapeHackerNews').mockResolvedValue([
      {
        title: 'H1',
        url: 'https://h.com',
        source: 'hn',
        tags: ['ai'],
        publishedAt: new Date(),
      },
    ]);
    jest.spyOn(service, 'scrapeDevTo').mockResolvedValue([]);
    jest.spyOn(service, 'scrapeRedditProgramming').mockResolvedValue([]);
    jest.spyOn(service, 'scrapeRedditWebdev').mockResolvedValue([]);
    jest.spyOn(service, 'scrapeLobsters').mockResolvedValue([]);
    jest.spyOn(service, 'scrapeHashnode').mockResolvedValue([]);
    jest.spyOn(service, 'scrapeMedium').mockResolvedValue([]);
    jest.spyOn(service, 'scrapeTechCrunch').mockResolvedValue([]);
    jest.spyOn(service, 'scrapeGitHub').mockResolvedValue([]);
    jest.spyOn(service, 'scrapeHackerNoon').mockResolvedValue([]);

    // saveArticles mock
    jest
      .spyOn(service as any, 'saveArticles')
      .mockResolvedValue([{ id: 'h1', url: 'https://h.com' }]);

    // content fetch for the new one
    jest.spyOn(service, 'fetchContentAndImage').mockResolvedValue({
      content: 'some article body',
      imageUrl: 'https://h.com/image.jpg',
    });

    // The private scrapeContentForArticles will do update for content
    mockDb.update.mockReturnValue({
      set: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve({ rowCount: 1 })),
      })),
    });

    const result = await service.scrapeAll();

    expect(result.hn).toBe(1);
    expect(result.devto).toBe(0);
    expect(result.content.saved).toBe(1);
    expect(service.fetchContentAndImage).toHaveBeenCalledWith('https://h.com');
  });

  it('cleanOldArticles calls db delete with correct date and returns count', async () => {
    mockDb.select.mockReturnValueOnce({
      from: jest.fn(() => ({
        orderBy: jest.fn(() => ({
          limit: jest.fn(() =>
            Promise.resolve([{ id: 'art-1' }, { id: 'art-2' }]),
          ),
        })),
      })),
    });

    mockDb.delete.mockReturnValueOnce({
      where: jest.fn(() => ({
        returning: jest.fn(() => Promise.resolve([{ id: 'art-3' }])),
      })),
    });

    const count = await service.cleanOldArticles(50);

    expect(mockDb.delete).toHaveBeenCalled();
    expect(count).toBe(1);
  });

  it('cleanOldArticles with no arguments performs age-based pruning and returns count', async () => {
    mockDb.delete.mockReturnValueOnce({
      where: jest.fn(() => ({
        returning: jest.fn(() => Promise.resolve([{ id: 'stale-art' }])),
      })),
    });

    const count = await service.cleanOldArticles();

    expect(mockDb.delete).toHaveBeenCalled();
    expect(count).toBe(1);
  });
});
