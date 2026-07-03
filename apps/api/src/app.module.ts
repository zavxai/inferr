import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DrizzleModule } from './db/drizzle.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ScraperModule } from './scraper/scraper.module';

import { AiModule } from './ai/ai.module';
import { FeedModule } from './feed/feed.module';
import { ChatModule } from './chat/chat.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { McpModule } from './mcp/mcp.module';
import { EvaluationsModule } from './evaluations/evaluations.module';
import { LangfuseModule } from './langfuse/langfuse.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    DrizzleModule,
    AuthModule,
    UsersModule,
    ScraperModule,

    AiModule,
    FeedModule,
    ChatModule,
    SchedulerModule,
    McpModule,
    EvaluationsModule,
    LangfuseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
