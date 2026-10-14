import {
  Controller,
  Get,
  Post,
  UseGuards,
  Res,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { Throttle } from '@nestjs/throttler';
import { UserThrottlerGuard } from '../common/guards/user-throttler.guard';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleAuthGuard } from './google-auth.guard';
import { GoogleMcpAuthGuard } from './google-mcp-auth.guard';
import { UsersService } from '../users/users.service';
import { McpOAuthProvider } from '../mcp/mcp-oauth.provider';
import { REFRESH_TOKEN_TTL_MS } from './auth.service';
import { getApiUrl, getFrontendUrl } from '../config/public-urls';

const deploymentIsHttps = [getApiUrl(), getFrontendUrl()].some((url) =>
  url.startsWith('https://'),
);
const configuredCookieDomain = process.env.COOKIE_DOMAIN;
const isInferrDeployment = [getApiUrl(), getFrontendUrl()].some((url) => {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith('.inferr.xyz') || hostname === 'inferr.xyz';
  } catch {
    return false;
  }
});

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  // Do not depend on NODE_ENV here: Docker Compose commonly runs a public
  // deployment with NODE_ENV=development. The actual public URLs determine
  // whether browsers require the Secure flag and shared subdomain cookie.
  secure: deploymentIsHttps,
  // `inferr.xyz` and `api.inferr.xyz` are different origins but the same
  // browser site. Lax cookies are therefore sent to the API from the web app,
  // without relying on third-party-cookie behavior. Keep this host-only by
  // default: the cookie is only ever consumed by api.inferr.xyz.
  sameSite: 'lax' as const,
  domain: configuredCookieDomain,
  maxAge: REFRESH_TOKEN_TTL_MS,
  path: '/',
};

// Before the host-only cookie above, production sessions used this domain-wide
// cookie. Clear it during sign-in/logout so browsers do not send two cookies
// named `refresh_token` and leave Express to pick a stale one.
const LEGACY_REFRESH_COOKIE_OPTIONS = isInferrDeployment
  ? {
      httpOnly: true,
      secure: true,
      sameSite: 'none' as const,
      domain: '.inferr.xyz',
      path: '/',
    }
  : undefined;

function clearLegacyRefreshCookie(res: Response) {
  if (LEGACY_REFRESH_COOKIE_OPTIONS) {
    res.clearCookie('refresh_token', LEGACY_REFRESH_COOKIE_OPTIONS);
  }
}

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
    const frontendUrl = getFrontendUrl();

    clearLegacyRefreshCookie(res);
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
    const oldToken = (req.cookies as Record<string, string | undefined>)[
      'refresh_token'
    ];

    if (!oldToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const { accessToken, refreshToken } =
      await this.authService.rotateRefreshToken(oldToken);

    clearLegacyRefreshCookie(res);
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

    clearLegacyRefreshCookie(res);
    res.clearCookie('refresh_token', REFRESH_COOKIE_OPTIONS);
    return res.json({ message: 'Logged out' });
  }
}
