import './env';
import './otel';
import * as path from 'path';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { AppModule } from './app.module';
import { DRIZZLE } from './db/drizzle.provider';
import type { DrizzleDB } from './db/drizzle.provider';
import { McpOAuthProvider } from './mcp/mcp-oauth.provider';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { getApiUrl, getFrontendUrl } from './config/public-urls';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const db = app.get<DrizzleDB>(DRIZZLE);
  try {
    await db.execute(sql`SELECT 1`);
    logger.log('Database connection is healthy');
  } catch (err) {
    logger.error('Database connection failed', err);
    process.exit(1);
  }

  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
  } catch {
    // Neon and managed Postgres providers pre-install pgvector; the user role
    // lacks superuser privileges to CREATE EXTENSION but the extension is
    // already active. Safe to ignore.
    logger.warn(
      'Could not CREATE EXTENSION vector — assuming it is already enabled',
    );
  }
  const migrationsFolder = path.join(__dirname, '../drizzle');
  await migrate(db, { migrationsFolder });
  logger.log('Migrations applied');

  app.use(cookieParser());

  // Mount the MCP OAuth 2.1 authorization server. This installs the standard
  // endpoints (/.well-known/oauth-authorization-server, /.well-known/oauth-
  // protected-resource/mcp, /mcp/authorize, /mcp/token, /mcp/register,
  // /mcp/revoke) directly on the underlying Express app. It must be registered
  // before app.listen(); the well-known routes live at the application root.
  const mcpOAuthProvider = app.get(McpOAuthProvider);
  const apiUrl = getApiUrl();
  const expressApp = app.getHttpAdapter().getInstance() as {
    use: (handler: unknown) => void;
  };
  expressApp.use(
    mcpAuthRouter({
      provider: mcpOAuthProvider,
      issuerUrl: new URL(apiUrl),
      baseUrl: new URL(`${apiUrl}/mcp`),
      scopesSupported: ['mcp'],
      resourceName: 'Inferr MCP Server',
    }),
  );

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());

  app.enableCors({
    origin: getFrontendUrl(),
    credentials: true,
  });

  await app.listen(process.env.API_PORT ?? 3001);
}
void bootstrap();
