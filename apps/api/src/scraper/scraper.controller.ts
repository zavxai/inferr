import { Controller, Post, UseGuards } from '@nestjs/common';
import { ScraperService, ScrapeResult } from './scraper.service';
import { ScraperKeyGuard } from './scraper-key.guard';
import { AiService } from '../ai/ai.service';

@Controller('scraper')
export class ScraperController {
  constructor(
    private readonly scraperService: ScraperService,
    private readonly aiService: AiService,
  ) {}

  @UseGuards(ScraperKeyGuard)
  @Post('run')
  async run(): Promise<{
    saved: ScrapeResult;
    summarized: { processed: number; failed: number };
    cleaned: number;
  }> {
    const saved = await this.scraperService.scrapeAll();
    const summarized = await this.aiService.processUnsummarized(50);
    const cleaned = await this.scraperService.cleanOldArticles();
    return { saved, summarized, cleaned };
  }
}
