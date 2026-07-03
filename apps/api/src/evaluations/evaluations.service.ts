import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { LangfuseService } from '../langfuse/langfuse.service';
import type {
  EvaluationInput,
  EvaluationResult,
  MetricScores,
} from './dto/evaluation.dto';

// ---------------------------------------------------------------------------
// Schema for structured LLM output
// ---------------------------------------------------------------------------

const JudgeSchema = z.object({
  faithfulness: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Score 0-1. How faithfully does the answer stick to the provided context? 1 = fully grounded, 0 = hallucinated.',
    ),
  answer_relevance: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Score 0-1. How directly and completely does the answer address the question? 1 = perfect, 0 = off-topic.',
    ),
  context_recall: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Score 0-1. Did the retrieved context contain the information needed to fully answer the question? 1 = fully sufficient, 0 = context had nothing useful.',
    ),
});

type JudgeOutput = z.infer<typeof JudgeSchema>;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * EvaluationsService — LLM-as-judge for RAG quality measurement.
 *
 * Uses a structured-output ChatOpenAI call to score three dimensions of a
 * RAG response: faithfulness, answer relevance, and context recall.
 * Scores are 0–1 (higher = better).
 *
 * Designed to be called fire-and-forget from AgenticRagService after generation
 * so that it never slows down the user-facing response. Errors are caught and
 * logged rather than re-thrown.
 *
 * Results are returned to the caller (e.g. for logging/storage). Persistence
 * to the DB is the caller's responsibility and is intentionally kept out of
 * this service to keep it pure and easily testable.
 */
@Injectable()
export class EvaluationsService {
  private readonly logger = new Logger(EvaluationsService.name);
  private _judgeLlm?: ReturnType<ChatOpenAI['withStructuredOutput']>;

  constructor(private readonly langfuseService: LangfuseService) {}

  private get judgeLlm(): ReturnType<ChatOpenAI['withStructuredOutput']> {
    if (!this._judgeLlm) {
      const llm = new ChatOpenAI({
        model: 'gpt-4o-mini',
        temperature: 0,
        // Structured JSON output is ~60 tokens; 150 is generous with headroom.
        maxTokens: 150,
      });
      this._judgeLlm = llm.withStructuredOutput(JudgeSchema);
    }
    return this._judgeLlm;
  }

  /**
   * Evaluate a single RAG turn using an LLM judge.
   *
   * Returns a full EvaluationResult including generated UUID, scores, and ISO
   * timestamp. Returns `null` on any error so the caller can safely ignore it.
   */
  async evaluate(input: EvaluationInput): Promise<EvaluationResult | null> {
    const { question, answer, context, userId, traceId } = input;

    if (!answer?.trim() || !question?.trim()) {
      this.logger.warn(
        'EvaluationsService.evaluate: empty question or answer, skipping',
      );
      return null;
    }

    const contextText =
      context.length > 0
        ? context
            .map(
              (c, i) =>
                `[${i + 1}] ${c.title}\nSummary: ${c.summary ?? 'No summary.'}\nURL: ${c.url}`,
            )
            .join('\n\n')
        : '(no context provided)';

    const systemPrompt = `You are an impartial expert judge evaluating the quality of a RAG (Retrieval-Augmented Generation) response for a software developer knowledge base.

You will be given:
- The user question
- The context articles retrieved from the knowledge base
- The generated answer

Score the response on three dimensions (each 0.0–1.0, two decimal places):

1. faithfulness (0–1): Does the answer only contain claims that are supported by the provided context? 
   - 1.0 = every fact in the answer is directly traceable to the context
   - 0.0 = the answer contains fabricated information not in context

2. answer_relevance (0–1): Does the answer actually address the question?
   - 1.0 = fully answers the question directly and completely
   - 0.0 = completely off-topic or refuses to answer

3. context_recall (0–1): Does the retrieved context contain the information needed to answer the question?
   - 1.0 = context has everything needed for a complete answer
   - 0.0 = context is entirely irrelevant to the question

Return a JSON object with the three numeric scores.`;

    const userPrompt = `Question: ${question}

Retrieved Context:
${contextText}

Generated Answer: ${answer}

Score the above response.`;

    try {
      const config: { callbacks?: any[] } = {};
      if (this.langfuseService.isEnabled()) {
        const handler = this.langfuseService.createCallbackHandler({
          traceName: 'RAG Evaluation',
          userId,
          tags: ['evaluation'],
          metadata: {
            parentTraceId: traceId,
          },
        });
        if (handler) {
          config.callbacks = [handler];
        }
      }

      const result = (await this.judgeLlm.invoke(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        config,
      )) as JudgeOutput;

      const scores: MetricScores = {
        faithfulness: this.clampScore(result.faithfulness),
        answer_relevance: this.clampScore(result.answer_relevance),
        context_recall: this.clampScore(result.context_recall),
      };

      const evaluation: EvaluationResult = {
        id: crypto.randomUUID(),
        question,
        answer,
        scores,
        evaluatedAt: new Date().toISOString(),
        userId,
      };

      this.logger.log(
        `Evaluation ${evaluation.id}: faithfulness=${scores.faithfulness.toFixed(2)} ` +
          `answer_relevance=${scores.answer_relevance.toFixed(2)} ` +
          `context_recall=${scores.context_recall.toFixed(2)}` +
          (userId ? ` [user=${userId}]` : ''),
      );

      if (traceId) {
        this.langfuseService.score({
          traceId,
          name: 'faithfulness',
          value: scores.faithfulness,
        });
        this.langfuseService.score({
          traceId,
          name: 'answer_relevance',
          value: scores.answer_relevance,
        });
        this.langfuseService.score({
          traceId,
          name: 'context_recall',
          value: scores.context_recall,
        });
      }

      return evaluation;
    } catch (err) {
      this.logger.error(`EvaluationsService.evaluate failed: ${err}`);
      return null;
    }
  }

  /**
   * Convenience wrapper: evaluate and do not await (fire-and-forget).
   * Safe to call without affecting the critical path.
   * Accepts a callback to receive the result if persistence is needed.
   */
  evaluateAsync(
    input: EvaluationInput,
    onResult?: (result: EvaluationResult) => void,
  ): void {
    this.evaluate(input)
      .then((result) => {
        if (result && onResult) {
          onResult(result);
        }
      })
      .catch((err) => {
        // Already handled inside evaluate(); this is a final safety net.
        this.logger.error(`evaluateAsync unhandled rejection: ${err}`);
      });
  }

  /** Clamps a score to [0, 1] to guard against misbehaving LLM output. */
  private clampScore(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
