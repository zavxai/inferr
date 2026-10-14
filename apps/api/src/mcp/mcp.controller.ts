import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpService } from './mcp.service';
import { McpOAuthProvider } from './mcp-oauth.provider';
import { getApiUrl } from '../config/public-urls';

const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';

@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly mcpService: McpService,
    private readonly mcpOAuthProvider: McpOAuthProvider,
  ) {}

  /**
   * Validates the Bearer token on an MCP request and returns the userId, or
   * sends a 401 (with the RFC 9728 WWW-Authenticate hint that points clients to
   * our OAuth metadata) and returns null.
   */
  private async extractUserId(
    req: Request,
    res: Response,
  ): Promise<string | null> {
    const authHeader = req.headers.authorization;
    const apiUrl = getApiUrl();

    if (!authHeader?.startsWith('Bearer ')) {
      res
        .status(401)
        .set(
          'WWW-Authenticate',
          `Bearer resource_metadata="${apiUrl}${RESOURCE_METADATA_PATH}"`,
        )
        .json({
          error: 'unauthorized',
          error_description: 'Missing bearer token',
        });
      return null;
    }

    try {
      const token = authHeader.slice('Bearer '.length);
      const authInfo = await this.mcpOAuthProvider.verifyAccessToken(token);
      return (authInfo.extra?.userId as string | undefined) ?? null;
    } catch {
      res
        .status(401)
        .set(
          'WWW-Authenticate',
          `Bearer error="invalid_token", resource_metadata="${apiUrl}${RESOURCE_METADATA_PATH}"`,
        )
        .json({ error: 'invalid_token' });
      return null;
    }
  }

  @Post()
  @HttpCode(200)
  async handlePost(
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const userId = await this.extractUserId(req, res);
    if (!userId) return;

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      if (sessionId && this.mcpService.hasSession(sessionId)) {
        // Existing session — route to its transport
        const transport = this.mcpService.getTransport(sessionId)!;
        await transport.handleRequest(req, res, req.body);
      } else if (!sessionId && this.mcpService.isInitializeRequest(req.body)) {
        // New client connecting — build a user-scoped server + transport
        const transport = await this.mcpService.createTransport(userId);
        await transport.handleRequest(req, res, req.body);
      } else if (sessionId && !this.mcpService.hasSession(sessionId)) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Session not found' },
          id: null,
        });
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message:
              'Bad request: send an initialize request without a session ID',
          },
          id: null,
        });
      }
    } catch (err) {
      this.logger.error('Error handling MCP POST', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  }

  @Get()
  async handleGet(
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const userId = await this.extractUserId(req, res);
    if (!userId) return;

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !this.mcpService.hasSession(sessionId)) {
      res.status(400).send('Missing or invalid Mcp-Session-Id header');
      return;
    }

    try {
      const transport = this.mcpService.getTransport(sessionId)!;
      await transport.handleRequest(req, res);
    } catch (err) {
      this.logger.error('Error handling MCP GET (SSE stream)', err);
      if (!res.headersSent) {
        res.status(500).send('Internal server error');
      }
    }
  }

  @Delete()
  async handleDelete(
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const userId = await this.extractUserId(req, res);
    if (!userId) return;

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !this.mcpService.hasSession(sessionId)) {
      res.status(400).send('Missing or invalid Mcp-Session-Id header');
      return;
    }

    try {
      const transport = this.mcpService.getTransport(sessionId)!;
      await transport.handleRequest(req, res);
    } catch (err) {
      this.logger.error('Error handling MCP DELETE', err);
      if (!res.headersSent) {
        res.status(500).send('Internal server error');
      }
    }
  }
}
