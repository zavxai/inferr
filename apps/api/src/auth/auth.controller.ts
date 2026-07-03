import {
  Controller,
  Get,
  Post,
  UseGuards,
  Res,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { UserThrottlerGuard } from '../common/guards/user-throttler.guard';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleAuthGuard } from './google-auth.guard';
import { GoogleMcpAuthGuard } from './google-mcp-auth.guard';
import { UsersService } from '../users/users.service';
import { McpOAuthProvider } from '../mcp/mcp-oauth.provider';

const isProduction = process.env.NODE_ENV === 'production';

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? ('none' as const) : ('lax' as const),
  domain: isProduction ? '.inferr.xyz' : undefined,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
};

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
    private mcpOAuthProvider: McpOAuthProvider,
  ) {}

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {}

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleAuthCallback(@Req() req: Request, @Res() res: Response) {
    const googleProfile = req.user as {
      id?: string;
      displayName?: string;
      emails?: { value: string }[];
      photos?: { value: string }[];
    };

    if (!googleProfile?.id) {
      throw new UnauthorizedException('Failed to authenticate with Google');
    }

    const user = await this.authService.validateAndUpsertGoogleUser({
      id: googleProfile.id,
      displayName: googleProfile.displayName ?? '',
      emails: googleProfile.emails ?? [],
      photos: googleProfile.photos ?? [],
    });
    const refreshToken = await this.authService.createRefreshToken(user.id);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    res.cookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTIONS);
    return res.redirect(`${frontendUrl}/auth/callback`);
  }

  // --- MCP OAuth bridge ---
  // These two endpoints let the MCP authorization flow reuse Google sign-in.
  // McpOAuthProvider.authorize() redirects Claude Desktop here with ?state=...

  @Get('google/mcp')
  @UseGuards(GoogleMcpAuthGuard)
  googleMcpAuth() {
    // GoogleMcpAuthGuard forwards `state` to Google and redirects to consent.
  }

  @Get('google/mcp-callback')
  @UseGuards(GoogleMcpAuthGuard)
  async googleMcpCallback(@Req() req: Request, @Res() res: Response) {
    const googleProfile = req.user as {
      id?: string;
      displayName?: string;
      emails?: { value: string }[];
      photos?: { value: string }[];
    };

    if (!googleProfile?.id) {
      throw new UnauthorizedException('Failed to authenticate with Google');
    }

    const googleState = (req.query.state as string | undefined) ?? '';
    if (!googleState) {
      throw new UnauthorizedException('Missing MCP authorization state');
    }

    const user = await this.authService.validateAndUpsertGoogleUser({
      id: googleProfile.id,
      displayName: googleProfile.displayName ?? '',
      emails: googleProfile.emails ?? [],
      photos: googleProfile.photos ?? [],
    });

    const { redirectUri, authCode, clientState } =
      await this.mcpOAuthProvider.completeMcpAuthorization(
        user.id,
        googleState,
      );

    const url = new URL(redirectUri);
    url.searchParams.set('code', authCode);
    if (clientState) url.searchParams.set('state', clientState);

    return res.redirect(url.toString());
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() req: Request) {
    const jwtUser = req.user as
      | { id: string; email: string; name: string }
      | undefined;

    if (!jwtUser) {
      throw new UnauthorizedException('User not found');
    }

    const user = await this.usersService.findById(jwtUser.id);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const hasInterests = await this.usersService.hasInterests(user.id);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      hasInterests,
    };
  }

  @Post('refresh')
  @Get('refresh')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async refresh(@Req() req: Request, @Res() res: Response) {
    console.log('[refresh] cookie header:', req.headers.cookie ?? '(none)');
    console.log('[refresh] parsed cookies:', JSON.stringify(req.cookies));

    const oldToken = (req.cookies as Record<string, string | undefined>)[
      'refresh_token'
    ];

    if (!oldToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const { accessToken, refreshToken } =
      await this.authService.rotateRefreshToken(oldToken);

    res.cookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTIONS);
    return res.json({ accessToken });
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    const token = (req.cookies as Record<string, string | undefined>)[
      'refresh_token'
    ];

    if (token) {
      await this.authService.revokeRefreshToken(token);
    }

    res.clearCookie('refresh_token', REFRESH_COOKIE_OPTIONS);
    return res.json({ message: 'Logged out' });
  }
}
