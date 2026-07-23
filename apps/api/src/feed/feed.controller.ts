import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeedService } from './feed.service';
import type { User } from '../db/schema';

@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getFeed(@Req() req: Request) {
    const user = req.user as User;
    return this.feedService.getPersonalizedFeed(user.id);
  }

  @Get('debug')
  @UseGuards(JwtAuthGuard)
  async getDebugFeed(@Req() req: Request) {
    const user = req.user as User;
    return this.feedService.getDebugFeed(user.id);
  }
}
