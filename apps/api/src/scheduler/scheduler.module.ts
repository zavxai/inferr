import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ScraperModule } from '../scraper/scraper.module';
import { AiModule } from '../ai/ai.module';

import { SchedulerService } from './scheduler.service';

@Module({
  imports: [ScheduleModule.forRoot(), ScraperModule, AiModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
