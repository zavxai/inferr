import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { DRIZZLE } from '../db/drizzle.provider';
import { refreshTokens } from '../db/schema';
import {
  TEST_JWT_SECRET,
  setTestJwtEnv,
  restoreTestJwtEnv,
} from '../../test/test-utils';

describe('AuthService (unit)', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: JwtService;
  let mockDb: any;

  const mockUser = {
    id: 'u-123',
    email: 'test@example.com',
    name: 'Test User',
    googleId: 'g-123',
    avatar: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeAll(() => {
    setTestJwtEnv();
  });

  afterAll(() => {
    restoreTestJwtEnv();
  });

  beforeEach(async () => {
    usersService = {
      upsert: jest.fn(),
      findById: jest.fn(),
      findByGoogleId: jest.fn(),
      saveInterests: jest.fn(),
      getInterests: jest.fn(),
      hasInterests: jest.fn(),
    } as any;

    // Minimal mock db that supports the query patterns in AuthService
    // We will override per test as needed via mockImplementation / mockResolvedValue
    mockDb = {
      insert: jest.fn(() => ({
        values: jest.fn(() => Promise.resolve({ rowCount: 1 })),
      })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([])),
          })),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve({ rowCount: 1 })),
        })),
      })),
      transaction: jest.fn(async (fn: any) => {
        // simple tx shim that re-uses top level fns (tests override as needed)
        const tx = {
          insert: mockDb.insert,
          update: mockDb.update,
          select: mockDb.select,
        };
        return fn(tx);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: TEST_JWT_SECRET,
          signOptions: { expiresIn: '15m' },
        }),
      ],
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: DRIZZLE, useValue: mockDb },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signAccessToken', () => {
    it('should sign a JWT with sub/email/name and 15m expiry', () => {
      const token = service.signAccessToken(mockUser);
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(10);

      // Verify payload manually (same secret)
      const decoded = jwtService.verify(token, {
        secret: TEST_JWT_SECRET,
      });
      expect(decoded.sub).toBe(mockUser.id);
      expect(decoded.email).toBe(mockUser.email);
      expect(decoded.name).toBe(mockUser.name);
    });
  });

  describe('createRefreshToken', () => {
    it('should hash, insert into refresh_tokens, and return the raw token', async () => {
      const raw = await service.createRefreshToken('u-123');

      expect(typeof raw).toBe('string');
      expect(raw.length).toBeGreaterThan(20);

      expect(mockDb.insert).toHaveBeenCalledWith(refreshTokens);
      const insertCall = mockDb.insert.mock.results[0].value;
      expect(insertCall.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u-123',
          tokenHash: expect.any(String), // the hash
          expiresAt: expect.any(Date),
        }),
      );
    });
  });

  describe('rotateRefreshToken', () => {
    it('should reject on unknown token', async () => {
      // select returns no row
      mockDb.select.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      });

      await expect(service.rotateRefreshToken('bad-raw-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject on expired token', async () => {
      const past = new Date(Date.now() - 1000 * 3600 * 24 * 8); // >7d
      mockDb.select.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  tokenHash: 'h',
                  userId: 'u-123',
                  revoked: false,
                  expiresAt: past,
                },
              ]),
          }),
        }),
      });

      await expect(service.rotateRefreshToken('some-raw')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should perform normal rotation: insert new, revoke old, return new tokens', async () => {
      const _now = new Date();
      const future = new Date(Date.now() + 1000 * 3600 * 24 * 7);

      // First select finds the valid stored token
      mockDb.select.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  id: 'rt-1',
                  tokenHash: 'oldhash',
                  userId: 'u-123',
                  revoked: false,
                  expiresAt: future,
                  revokedAt: null,
                  replacedByHash: null,
                },
              ]),
          }),
        }),
      });

      usersService.findById.mockResolvedValueOnce(mockUser);

      const result = await service.rotateRefreshToken('old-raw-token');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');

      // transaction used
      expect(mockDb.transaction).toHaveBeenCalled();
      // insert for new + update revoke
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should handle reuse detection within grace window by following the chain', async () => {
      const now = Date.now();
      const _grace = 5_000;
      const recently = new Date(now - 2000);

      const future = new Date(now + 1000 * 3600 * 24 * 7);

      // Initial select finds a *revoked* token that was revoked recently
      mockDb.select
        // first call in rotate: the provided raw
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    tokenHash: 'revokedhash1',
                    userId: 'u-123',
                    revoked: true,
                    revokedAt: recently,
                    replacedByHash: 'hash2',
                    expiresAt: future,
                  },
                ]),
            }),
          }),
        })
        // follow replacedByHash -> next
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    tokenHash: 'hash2',
                    userId: 'u-123',
                    revoked: false,
                    revokedAt: null,
                    replacedByHash: null,
                    expiresAt: future,
                  },
                ]),
            }),
          }),
        });

      usersService.findById.mockResolvedValue(mockUser);

      // The rotate should succeed by rotating the live one in chain
      const result = await service.rotateRefreshToken('stale-raw-from-tab');

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      // It will have done an insert+update inside the tx for the chain hop
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should reject reuse detection outside grace window', async () => {
      const oldRevoke = new Date(Date.now() - 60_000); // outside 5s grace
      const future = new Date(Date.now() + 1000 * 3600 * 24);

      mockDb.select.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  tokenHash: 'oldrevoked',
                  userId: 'u-123',
                  revoked: true,
                  revokedAt: oldRevoke,
                  replacedByHash: 'nevermind',
                  expiresAt: future,
                },
              ]),
          }),
        }),
      });

      await expect(
        service.rotateRefreshToken('stale-outside-grace'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('revokeRefreshToken', () => {
    it('should mark the token revoked', async () => {
      await service.revokeRefreshToken('to-revoke-raw');

      expect(mockDb.update).toHaveBeenCalledWith(refreshTokens);
      // The set + where chain
      const updateBuilder = mockDb.update.mock.results[0]?.value;
      expect(updateBuilder?.set).toHaveBeenCalledWith(
        expect.objectContaining({ revoked: true, revokedAt: expect.any(Date) }),
      );
    });
  });
});
