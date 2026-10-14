import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, StrategyOptions } from 'passport-google-oauth20';
import { getGoogleMcpCallbackUrl } from '../config/public-urls';

/**
 * A second Google OAuth strategy used only by the MCP authorization flow.
 *
 * It is identical to {@link GoogleStrategy} except for the strategy name and
 * the callback URL, which returns to `/auth/google/mcp-callback`. This lets the
 * MCP flow carry its own `state` and complete an MCP authorization without
 * disturbing the web-app login (which keeps using the `'google'` strategy).
 */
@Injectable()
export class GoogleMcpStrategy extends PassportStrategy(
  Strategy,
  'google-mcp',
) {
  constructor() {
    const clientID = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientID || !clientSecret) {
      throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
    }
    const options: StrategyOptions = {
      clientID,
      clientSecret,
      callbackURL: getGoogleMcpCallbackUrl(),
      scope: ['email', 'profile'],
    };
    super(options);
  }

  validate(
    accessToken: string,
    refreshToken: string,
    profile: {
      id: string;
      displayName: string;
      emails: { value: string }[];
      photos: { value: string }[];
    },
  ) {
    return {
      id: profile.id,
      displayName: profile.displayName,
      emails: profile.emails,
      photos: profile.photos,
    };
  }
}
