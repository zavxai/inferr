import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { ScraperKeyGuard } from '../scraper/scraper-key.guard';

@Module({
  providers: [AiService, ScraperKeyGuard],
  controllers: [AiController],
  exports: [AiService],
})
export class AiModule {}
