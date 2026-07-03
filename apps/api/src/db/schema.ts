import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  customType,
  text,
  boolean,
  jsonb,
  real,
} from 'drizzle-orm/pg-core';

const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[] | null): string {
      if (!value || value.length === 0) return '';
      return `[${value.join(',')}]`;
    },
    fromDriver(value: string | null): number[] {
      if (!value) return [];
      return value.slice(1, -1).split(',').map(Number);
    },
  })(name);

/**
 * ============================================================================
 * INFER R DATABASE SCHEMA
 * ============================================================================
 * - All columns use snake_case (Drizzle column name in backticks).
 * - Vector columns use pgvector (1536 dims for text-embedding-3-small).
 * - Token storage: only ever store SHA-256 hashes of opaque tokens.
 * - MCP tables are completely separate from web auth tables (different trust model).
 * - This file is the source of truth. Indexes declared here should match applied
 *   migrations. Use `npm run db:generate` to create forward migrations only.
 */

// -----------------------------------------------------------------------------
// Core Identity
// -----------------------------------------------------------------------------
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    googleId: varchar('google_id', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    avatar: varchar('avatar', { length: 2048 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('users_google_id_idx').on(t.googleId),
    index('users_email_idx').on(t.email),
  ],
);

// -----------------------------------------------------------------------------
// Content Corpus (Articles + RAG source of truth)
// Articles are globally shared. Personalization happens at query time via
// user interests + vector similarity + tag boosting.
// -----------------------------------------------------------------------------
export const articles = pgTable(
  'articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 500 }).notNull(),
    url: varchar('url', { length: 2048 }).notNull().unique(),
    source: varchar('source', { length: 255 }).notNull(),
    content: text('content'),
    summary: text('summary'),
    embedding: vector('embedding', 1536),
    tags: text('tags').array().notNull().default([]),
    publishedAt: timestamp('published_at'),
    imageUrl: varchar('image_url', { length: 2048 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    index('articles_source_idx').on(t.source),
    index('articles_published_at_idx').on(t.publishedAt),
    // HNSW index for fast cosine similarity (<=>) used by feed + chat RAG.
    // Matches the index created in migration 0003.
    index('articles_embedding_hnsw_idx').using(
      'hnsw',
      t.embedding.op('vector_cosine_ops'),
    ),
  ],
);

// -----------------------------------------------------------------------------
// Web Auth - Refresh Tokens (opaque, rotated, hashed)
// Note: the `tokenHash` column stores SHA-256(raw token). The raw value is
// only ever sent to the browser in an httpOnly cookie.
// Rotation + reuse detection nukes chains on suspected theft.
// -----------------------------------------------------------------------------
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    revoked: boolean('revoked').notNull().default(false),
    revokedAt: timestamp('revoked_at'),
    replacedByHash: varchar('replaced_by_hash', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('refresh_tokens_token_hash_idx').on(t.tokenHash)],
);

// -----------------------------------------------------------------------------
// MCP Auth - Tokens (separate lifecycle and secret space from web refresh)
// Access tokens are short-lived JWTs (type: mcp_access). Refresh tokens are
// opaque + hashed here. Reuse detection revokes *all* tokens for the user.
// -----------------------------------------------------------------------------
export const mcpTokens = pgTable(
  'mcp_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    revoked: boolean('revoked').notNull().default(false),
    revokedAt: timestamp('revoked_at'),
    replacedByHash: varchar('replaced_by_hash', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('mcp_tokens_token_hash_idx').on(t.tokenHash),
    index('mcp_tokens_user_id_idx').on(t.userId),
  ],
);

// -----------------------------------------------------------------------------
// Personalization Profile (1:1 with users)
// Stores the user's chosen interest tags + a cached embedding of a rich query
// derived from those tags. Used for personalized feed ranking + RAG context.
// This is deliberately a separate table today for easy upsert + future extension
// (e.g. more profile fields, interest history). Consider folding into users if
// it stays this small.
// -----------------------------------------------------------------------------
export const userInterests = pgTable(
  'user_interests',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    tags: text('tags').array().notNull().default([]),
    queryEmbedding: vector('query_embedding', 1536),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    // Optional but useful for future direct similarity on a user's interest vector
    index('user_interests_query_embedding_hnsw_idx').using(
      'hnsw',
      t.queryEmbedding.op('vector_cosine_ops'),
    ),
  ],
);



// -----------------------------------------------------------------------------
// RAG Quality Telemetry (LLM-as-Judge)
// Fire-and-forget scores written after /chat turns. Full question + answer are
// stored for debugging (can become large; consider TTL or offloading to
// Langfuse long-term).
// -----------------------------------------------------------------------------
export const aiEvaluations = pgTable(
  'ai_evaluations',
  {
    id: uuid('id').primaryKey(), // set by EvaluationsService (crypto.randomUUID)
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    faithfulness: real('faithfulness').notNull(),
    answerRelevance: real('answer_relevance').notNull(),
    contextRecall: real('context_recall').notNull(),
    evaluatedAt: timestamp('evaluated_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('ai_evaluations_user_id_idx').on(t.userId),
    index('ai_evaluations_evaluated_at_idx').on(t.evaluatedAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type UserInterest = typeof userInterests.$inferSelect;
export type NewUserInterest = typeof userInterests.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type McpToken = typeof mcpTokens.$inferSelect;
export type NewMcpToken = typeof mcpTokens.$inferInsert;

export type AiEvaluation = typeof aiEvaluations.$inferSelect;
export type NewAiEvaluation = typeof aiEvaluations.$inferInsert;

// -----------------------------------------------------------------------------
// MCP OAuth 2.1 State (PKCE + client registry + pending codes)
// These are short-lived. Cleanup runs on a timer in McpOAuthProvider.
// NOTE: expiresAt is a proper timestamp (was historically bigint unix ms).
// -----------------------------------------------------------------------------
export const mcpClients = pgTable('mcp_clients', {
  clientId: varchar('client_id', { length: 255 }).primaryKey(),
  clientInfo: jsonb('client_info').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const pendingMcpAuthorizations = pgTable('pending_mcp_authorizations', {
  state: varchar('state', { length: 255 }).primaryKey(),
  clientId: varchar('client_id', { length: 255 }).notNull(),
  codeChallenge: varchar('code_challenge', { length: 255 }).notNull(),
  redirectUri: varchar('redirect_uri', { length: 2048 }).notNull(),
  scopes: text('scopes').array().notNull().default([]),
  clientState: varchar('client_state', { length: 2048 }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const pendingAuthCodes = pgTable('pending_auth_codes', {
  code: varchar('code', { length: 255 }).primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  clientId: varchar('client_id', { length: 255 }).notNull(),
  codeChallenge: varchar('code_challenge', { length: 255 }).notNull(),
  redirectUri: varchar('redirect_uri', { length: 2048 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type McpClient = typeof mcpClients.$inferSelect;
export type NewMcpClient = typeof mcpClients.$inferInsert;
export type McpPendingAuthorization =
  typeof pendingMcpAuthorizations.$inferSelect;
export type NewMcpPendingAuthorization =
  typeof pendingMcpAuthorizations.$inferInsert;
export type McpPendingAuthCode = typeof pendingAuthCodes.$inferSelect;
export type NewMcpPendingAuthCode = typeof pendingAuthCodes.$inferInsert;

// -----------------------------------------------------------------------------
// Operations - Distributed Locking + Execution Audit
// cron_locks uses existence + job_name PK as a simple advisory lock.
// cron_runs is an append-only history table used for catch-up decisions.
// -----------------------------------------------------------------------------
export const cronLocks = pgTable('cron_locks', {
  jobName: varchar('job_name', { length: 255 }).primaryKey(),
  lockedAt: timestamp('locked_at').notNull().defaultNow(),
});

export type CronLock = typeof cronLocks.$inferSelect;
export type NewCronLock = typeof cronLocks.$inferInsert;

export const cronRuns = pgTable(
  'cron_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobName: varchar('job_name', { length: 255 }).notNull(),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    finishedAt: timestamp('finished_at'),
    status: varchar('status', { length: 20 }).notNull().default('running'), // running | success | failed
    error: text('error'),
  },
  (table) => [
    index('idx_cron_runs_job_name').on(table.jobName, table.startedAt.desc()),
  ],
);

export type CronRun = typeof cronRuns.$inferSelect;
export type NewCronRun = typeof cronRuns.$inferInsert;
