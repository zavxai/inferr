import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DrizzleDB } from '../db/drizzle.provider';
import { users, userInterests, User, NewUser } from '../db/schema';
import { AiService } from '../ai/ai.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    private readonly aiService: AiService,
  ) {}

  async upsert(googleProfile: {
    id: string;
    displayName: string;
    emails: { value: string }[];
    photos: { value: string }[];
  }): Promise<User> {
    const email = googleProfile.emails[0]?.value || '';
    const avatar: string | null = googleProfile.photos[0]?.value || null;

    const existing = await this.db
      .select()
      .from(users)
      .where(eq(users.googleId, googleProfile.id))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await this.db
        .update(users)
        .set({ email, name: googleProfile.displayName, avatar })
        .where(eq(users.googleId, googleProfile.id))
        .returning();
      return updated;
    }

    const newUser: NewUser = {
      googleId: googleProfile.id,
      email,
      name: googleProfile.displayName,
      avatar,
    };

    const created = await this.db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values(newUser).returning();
      await tx.insert(userInterests).values({
        userId: user.id,
        tags: [],
        queryEmbedding: null,
      });
      return user;
    });

    return created;
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    const result = await this.db
      .select()
      .from(users)
      .where(eq(users.googleId, googleId))
      .limit(1);
    return result[0] ?? null;
  }

  async findById(id: string): Promise<User | null> {
    const result = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  async saveInterests(userId: string, tags: string[]): Promise<void> {
    await this.db
      .insert(userInterests)
      .values({ userId, tags, queryEmbedding: null })
      .onConflictDoUpdate({
        target: userInterests.userId,
        set: { tags, queryEmbedding: null },
      });

    // Fire-and-forget: warm the embedding cache so the next /feed request
    // doesn't have to call OpenAI cold (which risks a transient 500).
    this.warmEmbedding(userId, tags).catch((err) =>
      this.logger.warn(
        `Background embed warming failed for user ${userId}: ${err}`,
      ),
    );
  }

  private async warmEmbedding(userId: string, tags: string[]): Promise<void> {
    if (tags.length === 0) return;
    const queryText = `software engineering articles about ${tags.join(', ')} for developers`;
    this.logger.log(
      `Warming embedding for user ${userId} after interests update`,
    );
    const embedding = await this.aiService.embed(queryText);
    await this.db
      .update(userInterests)
      .set({ queryEmbedding: embedding })
      .where(eq(userInterests.userId, userId));
    this.logger.log(`Embedding warmed for user ${userId}`);
  }

  async getInterests(userId: string): Promise<{ tags: string[] }> {
    const result = await this.db
      .select({ tags: userInterests.tags })
      .from(userInterests)
      .where(eq(userInterests.userId, userId))
      .limit(1);
    return { tags: result[0]?.tags ?? [] };
  }

  async hasInterests(userId: string): Promise<boolean> {
    const result = await this.db
      .select({ tags: userInterests.tags })
      .from(userInterests)
      .where(eq(userInterests.userId, userId))
      .limit(1);
    return (result[0]?.tags?.length ?? 0) > 0;
  }

  async deleteUser(userId: string): Promise<void> {
    await this.db.delete(users).where(eq(users.id, userId));
  }
}
