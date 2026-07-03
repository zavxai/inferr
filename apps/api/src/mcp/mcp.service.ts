import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { DRIZZLE } from '../db/drizzle.provider';
import type { DrizzleDB } from '../db/drizzle.provider';
import { AiService } from '../ai/ai.service';
import { FeedService } from '../feed/feed.service';
import { AgenticRagService } from '../chat/agentic-rag.service';

@Injectable()
export class McpService implements OnModuleDestroy {
  private readonly logger = new Logger(McpService.name);
  private readonly transports = new Map<
    string,
    StreamableHTTPServerTransport
  >();
  private readonly sessionUsers = new Map<string, string>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly aiService: AiService,
    private readonly feedService: FeedService,
    private readonly agenticRag: AgenticRagService,
  ) {}

  /**
   * Builds a per-session MCP server whose tools are bound to one authenticated
   * user. Because each connection authenticates as a specific user, the tools
   * close over that `userId` — `get_personalized_feed` never accepts it as a
   * caller-supplied argument, which prevents one user reading another's feed.
   */
  private buildServerForUser(userId: string): McpServer {
    const server = new McpServer({ name: 'inferr', version: '1.0.0' });

    server.tool(
      'search_articles',
      'Semantically search the Inferr article database scraped from Hacker News and Dev.to. Use when the user asks about a specific technology, framework, or programming topic.',
      {
        query: z
          .string()
          .describe('Search query — a topic, question, or keywords'),
      },
      async ({ query }) => {
        const embedding = await this.aiService.embed(query);
        const embeddingStr = `[${embedding.join(',')}]`;

        const rows = await this.db.execute<{
          title: string;
          url: string;
          source: string;
          summary: string | null;
        }>(sql`
          SELECT title, url, source, summary
          FROM articles
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> ${embeddingStr}::vector
          LIMIT 5
        `);

        if (rows.rows.length === 0) {
          return { content: [{ type: 'text', text: 'No articles found.' }] };
        }

        const text = rows.rows
          .map(
            (r, i) =>
              `${i + 1}. ${r.title}\n   Source: ${r.source}\n   URL: ${r.url}\n   Summary: ${r.summary ?? 'No summary available'}`,
          )
          .join('\n\n');

        return { content: [{ type: 'text', text }] };
      },
    );

    server.tool(
      'get_personalized_feed',
      "Fetch today's personalized article feed for the authenticated Inferr user based on their saved interests. Use when the user asks for recommendations or what to read today.",
      {},
      async () => {
        const feed = await this.feedService.getPersonalizedFeed(userId);
        if (!feed.hasMatches || feed.articles.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'There are no articles today matching your interests. Try adding more interests to expand your feed.',
              },
            ],
          };
        }

        const label = 'Personalized matches for today';
        const text =
          `${label}:\n\n` +
          feed.articles
            .map(
              (a, i) =>
                `${i + 1}. ${a.title}\n   Source: ${a.source}\n   URL: ${a.url}\n   Score: ${Math.round(a.score * 100)}% Match\n   Summary: ${a.summary ?? 'No summary available'}`,
            )
            .join('\n\n');

        return { content: [{ type: 'text', text }] };
      },
    );

    server.tool(
      'ask_inferr',
      'Ask a technical question and get an answer grounded in the Inferr article knowledge base. Uses a full agentic RAG pipeline (retrieve → grade → rewrite → generate). Use when the user wants a detailed explanation or answer about a software development topic.',
      {
        question: z
          .string()
          .describe('A technical question for software developers'),
      },
      async ({ question }) => {
        const result = await this.agenticRag.query(userId, question, []);

        const sources =
          result.sources.length > 0
            ? '\n\nSources:\n' +
              result.sources.map((s) => `- ${s.title}: ${s.url}`).join('\n')
            : '';

        return { content: [{ type: 'text', text: result.answer + sources }] };
      },
    );

    return server;
  }

  isInitializeRequest(body: unknown): boolean {
    return isInitializeRequest(body);
  }

  /**
   * Creates a transport for a freshly authenticated session and connects it to
   * a user-scoped MCP server. The caller (controller) then hands the HTTP
   * request to the returned transport.
   */
  async createTransport(
    userId: string,
  ): Promise<StreamableHTTPServerTransport> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        this.logger.log(`MCP session opened: ${sessionId} (user ${userId})`);
        this.transports.set(sessionId, transport);
        this.sessionUsers.set(sessionId, userId);
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        this.logger.log(`MCP session closed: ${sid}`);
        this.transports.delete(sid);
        this.sessionUsers.delete(sid);
      }
    };

    const server = this.buildServerForUser(userId);
    await server.connect(transport);
    return transport;
  }

  getTransport(sessionId: string): StreamableHTTPServerTransport | undefined {
    return this.transports.get(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.transports.has(sessionId);
  }

  async onModuleDestroy() {
    for (const [sessionId, transport] of this.transports) {
      this.logger.log(`Closing MCP session on shutdown: ${sessionId}`);
      await transport.close();
    }
    this.transports.clear();
    this.sessionUsers.clear();
  }
}
