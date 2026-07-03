import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import * as crypto from 'crypto';
import { UsersService } from '../users/users.service';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DrizzleDB } from '../db/drizzle.provider';
import { refreshTokens } from '../db/schema';
import type { User } from '../db/schema';

const GRACE_WINDOW_MS = 5_000; // accept a just-rotated token for 5s (multi-tab safety)

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    @Inject(DRIZZLE) private db: DrizzleDB,
  ) {}

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  async validateAndUpsertGoogleUser(
    googleProfile: {
      id: string;
      displayName: string;
      emails: { value: string }[];
      photos: { value: string }[];
    },
  ): Promise<User> {
    return this.usersService.upsert(googleProfile);
  }
  async getUserById(id: string): Promise<User | null> {
    return this.usersService.findById(id);
  }

  signAccessToken(user: User): string {
    const payload = { sub: user.id, email: user.email, name: user.name };
    return this.jwtService.sign(payload, { expiresIn: '15m' });
  }

  async createRefreshToken(userId: string): Promise<string> {
    const raw = crypto.randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(raw);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.db
      .insert(refreshTokens)
      .values({ userId, tokenHash, expiresAt });
    return raw; // raw token goes into the cookie; only the hash is persisted
  }

  async rotateRefreshToken(
    rawToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = this.hashToken(rawToken);

    const result = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    const stored = result[0];

    if (!stored) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Reuse detection: if revoked within the grace window, the client probably
    // sent the old token before receiving the rotated cookie (e.g. two tabs
    // loading simultaneously). Follow the replacement chain until we find a
    // valid token to rotate, or exhaust the chain.
    if (stored.revoked) {
      const revokedRecently =
        stored.revokedAt !== null &&
        stored.revokedAt !== undefined &&
        Date.now() - stored.revokedAt.getTime() < GRACE_WINDOW_MS;

      if (revokedRecently) {
        const MAX_CHAIN_DEPTH = 10;
        let current = stored;

        for (let hop = 0; hop < MAX_CHAIN_DEPTH; hop++) {
          if (!current.replacedByHash) break;

          const nextResult = await this.db
            .select()
            .from(refreshTokens)
            .where(eq(refreshTokens.tokenHash, current.replacedByHash))
            .limit(1);

          const next = nextResult[0];
          if (!next || next.userId !== stored.userId) break;

          if (!next.revoked && next.expiresAt > new Date()) {
            const user = await this.usersService.findById(next.userId);
            if (!user) throw new UnauthorizedException('User not found');

            const newRaw = crypto.randomBytes(64).toString('hex');
            const newHash = this.hashToken(newRaw);
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

            let rotated = false;
            await this.db.transaction(async (tx) => {
              await tx
                .insert(refreshTokens)
                .values({ userId: user.id, tokenHash: newHash, expiresAt });
              const result = await tx
                .update(refreshTokens)
                .set({
                  revoked: true,
                  revokedAt: new Date(),
                  replacedByHash: newHash,
                })
                .where(
                  and(
                    eq(refreshTokens.tokenHash, current.replacedByHash!),
                    eq(refreshTokens.revoked, false),
                  ),
                );
              rotated = (result.rowCount ?? 0) > 0;
            });

            if (!rotated) break;

            return {
              accessToken: this.signAccessToken(user),
              refreshToken: newRaw,
            };
          }

          // next is also revoked — continue only if still within the grace window
          const nextRevokedRecently =
            next.revokedAt !== null &&
            next.revokedAt !== undefined &&
            Date.now() - next.revokedAt.getTime() < GRACE_WINDOW_MS;

          if (!nextRevokedRecently) break;
          current = next;
        }
      }

      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Normal rotation
    const newRaw = crypto.randomBytes(64).toString('hex');
    const newHash = this.hashToken(newRaw);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.db.transaction(async (tx) => {
      await tx
        .insert(refreshTokens)
        .values({ userId: stored.userId, tokenHash: newHash, expiresAt });
      await tx
        .update(refreshTokens)
        .set({ revoked: true, revokedAt: new Date(), replacedByHash: newHash })
        .where(eq(refreshTokens.tokenHash, tokenHash));
    });

    const user = await this.usersService.findById(stored.userId);
    if (!user) throw new UnauthorizedException('User not found');

    return { accessToken: this.signAccessToken(user), refreshToken: newRaw };
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.db
      .update(refreshTokens)
      .set({ revoked: true, revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash));
  }
}
