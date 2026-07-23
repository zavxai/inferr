import { Controller, Post, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { ScraperKeyGuard } from '../scraper/scraper-key.guard';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * Ops-only batch job: summarize + embed articles that still lack a summary.
   * Protected with SCRAPER_API_KEY (same trust model as POST /scraper/run) so
   * any signed-in end user cannot burn OpenAI quota by calling this repeatedly.
   * Normal summarization also runs via cron and POST /scraper/run.
   */
  @UseGuards(ScraperKeyGuard)
  @Post('process')
  async process() {
    const result = await this.aiService.processUnsummarized();
    return result;
  }
}
