import { Injectable, Logger } from '@nestjs/common';
import { CallbackHandler } from 'langfuse-langchain';
import { Langfuse } from 'langfuse';

@Injectable()
export class LangfuseService {
  private readonly logger = new Logger(LangfuseService.name);
  private readonly langfuseClient?: Langfuse;

  constructor() {
    if (this.isEnabled()) {
      this.logger.log('Langfuse integration is enabled.');
      this.langfuseClient = new Langfuse({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
      });
    } else {
      this.logger.warn(
        'Langfuse integration is disabled (missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY).',
      );
    }
  }

  /**
   * Checks if Langfuse integration is configured and enabled in environment.
   */
  isEnabled(): boolean {
    return !!(
      process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY
    );
  }

  /**
   * Creates a CallbackHandler for LangChain / LangGraph if enabled.
   * Returns undefined if Langfuse is not configured.
   */
  createCallbackHandler(options?: {
    traceName?: string;
    userId?: string;
    sessionId?: string;
    tags?: string[];
    metadata?: Record<string, any>;
  }): CallbackHandler | undefined {
    if (!this.isEnabled()) {
      return undefined;
    }

    return new CallbackHandler({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
      ...options,
    });
  }

  /**
   * Submit an evaluation score to a trace in Langfuse.
   */
  score(params: {
    traceId: string;
    name: string;
    value: number;
    comment?: string;
  }): void {
    if (!this.isEnabled() || !this.langfuseClient) {
      return;
    }

    try {
      this.langfuseClient.score({
        traceId: params.traceId,
        name: params.name,
        value: params.value,
        comment: params.comment,
      });
      this.logger.debug(
        `Submitted score to Langfuse trace ${params.traceId}: ${params.name}=${params.value}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to submit score to Langfuse trace ${params.traceId}: ${err}`,
      );
    }
  }
}
