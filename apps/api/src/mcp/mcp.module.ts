import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { FeedModule } from '../feed/feed.module';
import { ChatModule } from '../chat/chat.module';
import { McpAuthModule } from './mcp-auth.module';
import { McpService } from './mcp.service';
import { McpController } from './mcp.controller';

@Module({
  imports: [AiModule, FeedModule, ChatModule, McpAuthModule],
  providers: [McpService],
  controllers: [McpController],
})
export class McpModule {}
