import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { DRIZZLE } from '../db/drizzle.provider';
import { AiService } from '../ai/ai.service';

describe('UsersService (unit)', () => {
  let service: UsersService;
  let mockDb: any;
  let mockAiService: any;

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([])),
          })),
        })),
      })),
      update: jest.fn(),
      insert: jest.fn(),
      transaction: jest.fn(),
    };

    mockAiService = {
      embed: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: AiService, useValue: mockAiService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('findById returns user when found', async () => {
    const mockUser = { id: 'u-1', email: 'test@example.com', name: 'Test' };
    mockDb.select.mockReturnValueOnce({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => Promise.resolve([mockUser])),
        })),
      })),
    });

    const user = await service.findById('u-1');
    expect(user).toEqual(mockUser);
  });

  it('findById returns null when not found', async () => {
    mockDb.select.mockReturnValueOnce({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => Promise.resolve([])),
        })),
      })),
    });

    const user = await service.findById('u-2');
    expect(user).toBeNull();
  });

  it('findByGoogleId returns user when found', async () => {
    const mockUser = { id: 'u-1', googleId: 'g-1', email: 'test@example.com', name: 'Test' };
    mockDb.select.mockReturnValueOnce({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => Promise.resolve([mockUser])),
        })),
      })),
    });

    const user = await service.findByGoogleId('g-1');
    expect(user).toEqual(mockUser);
  });
});
