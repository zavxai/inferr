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
  bigint,
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

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    googleId: varchar('google_id', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    avatar: varchar('avatar', { length: 2048 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('users_google_id_idx').on(t.googleId),
    index('users_email_idx').on(t.email),
  ],
);

export const articles = pgTable(
  'articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 500 }).notNull(),
    url: varchar('url', { length: 2048 }).notNull().unique(),
    source: varchar('source', { length: 255 }).notNull(),
    content: text('content'),
    contentScrapedAt: timestamp('content_scraped_at'),
    summary: text('summary'),
    embedding: vector('embedding', 1536),
    tags: text('tags').array().notNull().default([]),
    publishedAt: timestamp('published_at'),
    imageUrl: varchar('image_url', { length: 2048 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('articles_source_idx').on(t.source),
    index('articles_published_at_idx').on(t.publishedAt),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: varchar('token', { length: 255 }).notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    revoked: boolean('revoked').notNull().default(false),
    revokedAt: timestamp('revoked_at'),
    replacedByHash: varchar('replaced_by_hash', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('refresh_tokens_token_idx').on(t.token)],
);

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

export const userInterests = pgTable('user_interests', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  tags: text('tags').array().notNull().default([]),
  queryEmbedding: vector('query_embedding', 1536),
});

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    externalId: varchar('external_id', { length: 255 }).notNull().unique(),
    title: varchar('title', { length: 500 }).notNull(),
    url: varchar('url', { length: 2048 }).notNull(),
    company: varchar('company', { length: 255 }),
    category: varchar('category', { length: 255 }),
    tags: text('tags').array().notNull().default([]),
    jobType: varchar('job_type', { length: 100 }),
    location: varchar('location', { length: 255 }),
    salary: varchar('salary', { length: 255 }),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('jobs_category_idx').on(t.category),
    index('jobs_published_at_idx').on(t.publishedAt),
  ],
);

export const marketReports = pgTable('market_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  roles: jsonb('roles')
    .$type<{ role: string; demand: number; trend: string }[]>()
    .notNull(),
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
});

/**
 * Stores LLM-as-judge evaluation scores for every RAG response.
 * Written fire-and-forget by AgenticRagService after each query().
 *
 * Metrics (all 0–1, higher = better):
 *   faithfulness     — answer grounded in retrieved context
 *   answer_relevance — answer addresses the question
 *   context_recall   — retrieved context had the needed information
 */
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
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type MarketReportRow = typeof marketReports.$inferSelect;
export type NewMarketReportRow = typeof marketReports.$inferInsert;
export type AiEvaluation = typeof aiEvaluations.$inferSelect;
export type NewAiEvaluation = typeof aiEvaluations.$inferInsert;

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
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
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
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
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
