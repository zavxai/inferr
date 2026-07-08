import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, START, END, Annotation } from '@langchain/langgraph';

import { DRIZZLE } from '../db/drizzle.provider';
import type { DrizzleDB } from '../db/drizzle.provider';
import { AiService } from '../ai/ai.service';
import { EvaluationsService } from '../evaluations/evaluations.service';
import { LangfuseService } from '../langfuse/langfuse.service';
import { aiEvaluations } from '../db/schema';
import type {
  ChatSource,
  ChatResult,
  GraphHistoryMessage,
} from './dto/chat.dto';

export interface RetrievedDoc {
  id: string;
  title: string;
  url: string;
  source: string;
  summary: string | null;
}

export interface RagQueryDetails {
  answer: string;
  sources: ChatSource[];
  searchQuery: string;
  iterations: number;
  documents: RetrievedDoc[];
  relevantDocuments: RetrievedDoc[];
}

export interface QueryWithDetailsOptions {
  /** Skip fire-and-forget runtime eval (used by offline golden-set runner). */
  skipRuntimeEval?: boolean;
}

/**
 * State for the agentic RAG graph.
 * - originalQuestion: the user's raw conversational question (for final answer generation and UX)
 * - searchQuery: the (possibly LLM-rewritten) focused query used for embedding/retrieval/grading
 * This separation prevents search-oriented rewrites from polluting the final "Question:" presented to the LLM in generate.
 */
interface RagState {
  originalQuestion: string;
  searchQuery: string;
  history: GraphHistoryMessage[];
  documents: RetrievedDoc[];
  relevantDocuments: RetrievedDoc[];
  answer?: string;
  sources: ChatSource[];
  iterations: number;
}

const MAX_ITERATIONS = 2;
const RETRIEVAL_K = 8;

const RelevanceSchema = z.object({
  relevant_doc_indices: z
    .array(z.number())
    .describe(
      'Zero-based indices of the documents from the provided list that are relevant to answering the question. Return an empty array if none are relevant.',
    ),
});

@Injectable()
export class AgenticRagService {
  private readonly logger = new Logger(AgenticRagService.name);
  private _llm?: ChatOpenAI;
  private _gradingLlm?: ReturnType<ChatOpenAI['withStructuredOutput']>;
  // Use any for the compiled graph because the concrete generics produced by
  // Annotation.Root + our node functions are extremely complex and don't easily
  // assign to a simple CompiledStateGraph<TState, TUpdate> without deep type
  // gymnastics (which would hurt readability more than help). We still get
  // runtime safety from LangGraph and have targeted eslint disables.
  private _graph?: any;

  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    private readonly aiService: AiService,
    private readonly langfuseService: LangfuseService,
    @Optional() private readonly evaluationsService?: EvaluationsService,
  ) {}

  /**
   * Lazy getter for the OpenAI chat model (used by LangGraph nodes and structured output).
   * Avoids eager construction so missing OPENAI_API_KEY fails only on first /chat use (same as before),
   * but now explicit for the multiple LLM calls in the agentic flow (embed + graph nodes).
   */
  private get llm(): ChatOpenAI {
    if (!this._llm) {
      this._llm = new ChatOpenAI({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        maxTokens: 500,
      });
    }
    return this._llm;
  }

  private get gradingLlm(): ReturnType<ChatOpenAI['withStructuredOutput']> {
    if (!this._gradingLlm) {
      this._gradingLlm = this.llm.withStructuredOutput(RelevanceSchema);
    }
    return this._gradingLlm;
  }

  /**
   * Lazy getter for the compiled LangGraph. Built on first access using the (also lazy) llm.
   */
  private get graph(): any {
    if (!this._graph) {
      this._graph = this.buildGraph();
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return this._graph;
  }

  private buildGraph() {
    const State = Annotation.Root({
      originalQuestion: Annotation<string>(),
      searchQuery: Annotation<string>(),
      history: Annotation<GraphHistoryMessage[]>({
        reducer: (curr, update) => update ?? curr ?? [],
        default: () => [],
      }),
      documents: Annotation<RetrievedDoc[]>({
        reducer: (curr, update) => update ?? curr ?? [],
        default: () => [],
      }),
      relevantDocuments: Annotation<RetrievedDoc[]>({
        reducer: (curr, update) => update ?? curr ?? [],
        default: () => [],
      }),
      answer: Annotation<string>(),
      sources: Annotation<ChatSource[]>({
        reducer: (curr, update) => update ?? curr ?? [],
        default: () => [],
      }),
      iterations: Annotation<number>({
        reducer: (curr, update) => update ?? curr ?? 0,
        default: () => 0,
      }),
    });

    const workflow = new StateGraph(State)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      .addNode('retrieve', this.retrieveNode.bind(this))
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      .addNode('gradeDocuments', this.gradeDocumentsNode.bind(this))
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      .addNode('rewriteQuery', this.rewriteQueryNode.bind(this))
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      .addNode('generate', this.generateNode.bind(this))
      .addEdge(START, 'retrieve')
      .addEdge('retrieve', 'gradeDocuments')
      .addConditionalEdges(
        'gradeDocuments',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        this.routeAfterGrading.bind(this),
        {
          generate: 'generate',
          rewrite: 'rewriteQuery',
        },
      )
      .addEdge('rewriteQuery', 'retrieve')
      .addEdge('generate', END);

    return workflow.compile();
  }

  /**
   * Public entry point. Accepts optional conversation history for better multi-turn RAG.
   *
   * Note: userId is accepted (from auth) and logged for traceability, but chat retrieval
   * is intentionally pure question-driven semantic search over the global article corpus.
   * User interests/tags personalization (including tag-bonus and interest-based queryText)
   * is handled only in FeedService. This keeps chat answers faithful to the explicit question
   * rather than the user's profile (design choice confirmed per review).
   */
  async query(
    userId: string,
    question: string,
    history: GraphHistoryMessage[] = [],
  ): Promise<ChatResult> {
    const details = await this.queryWithDetails(userId, question, history);
    return {
      answer: details.answer,
      sources: details.sources,
    };
  }

  /**
   * Full pipeline result for offline evaluation and debugging.
   * Exposes retrieved/graded documents alongside the final answer.
   */
  async queryWithDetails(
    userId: string,
    question: string,
    history: GraphHistoryMessage[] = [],
    options: QueryWithDetailsOptions = {},
  ): Promise<RagQueryDetails> {
    this.logger.log(
      `Agentic RAG query from user ${userId}: "${question}" (history: ${history.length} turns)`,
    );

    const q = question.trim();
    const initialState: Partial<RagState> = {
      originalQuestion: q,
      searchQuery: q,
      history,
      iterations: 0,
    };

    let traceId: string | undefined = undefined;
    const config: { callbacks?: any[] } = {};
    if (this.langfuseService.isEnabled()) {
      const handler = this.langfuseService.createCallbackHandler({
        traceName: 'Agentic RAG Query',
        userId,
        tags: ['agentic-rag'],
        metadata: {
          question: q,
          historyTurns: history.length,
        },
      });
      if (handler) {
        config.callbacks = [handler];

        traceId = handler.traceId;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const finalState = (await this.graph.invoke(
      initialState,
      config,
    )) as RagState;

    // Fire-and-forget: score the response without blocking the user reply.
    if (this.evaluationsService && !options.skipRuntimeEval) {
      const contextForEval = (
        finalState.relevantDocuments?.length > 0
          ? finalState.relevantDocuments
          : (finalState.documents ?? [])
      ).map((d) => ({
        title: d.title,
        url: d.url,
        source: d.source,
        summary: d.summary,
      }));

      this.evaluationsService.evaluateAsync(
        {
          question: q,
          answer: finalState.answer?.trim() ?? '',
          context: contextForEval,
          userId,
          traceId,
        },
        (result) => {
          this.logger.debug(
            `RAG eval scores — faithfulness: ${result.scores.faithfulness.toFixed(2)}, ` +
              `relevance: ${result.scores.answer_relevance.toFixed(2)}, ` +
              `recall: ${result.scores.context_recall.toFixed(2)}`,
          );
          // Persist scores to DB for analytics and dashboarding.
          this.db
            .insert(aiEvaluations)
            .values({
              id: result.id,
              userId: result.userId ?? null,
              question: result.question,
              answer: result.answer,
              faithfulness: result.scores.faithfulness,
              answerRelevance: result.scores.answer_relevance,
              contextRecall: result.scores.context_recall,
              evaluatedAt: new Date(result.evaluatedAt),
            })
            .catch((err: unknown) => {
              this.logger.error(
                `Failed to persist evaluation ${result.id}: ${String(err)}`,
              );
            });
        },
      );
    }

    return {
      answer: finalState.answer?.trim() ?? '',
      sources: finalState.sources ?? [],
      searchQuery: finalState.searchQuery,
      iterations: finalState.iterations ?? 0,
      documents: finalState.documents ?? [],
      relevantDocuments: finalState.relevantDocuments ?? [],
    };
  }

  // --- Nodes ---

  private async retrieveNode(state: RagState): Promise<Partial<RagState>> {
    const embedding = await this.aiService.embed(state.searchQuery);
    const embeddingStr = `[${embedding.join(',')}]`;

    const rows = await this.db.execute<{
      id: string;
      title: string;
      url: string;
      source: string;
      summary: string | null;
    }>(
      sql`
        SELECT id, title, url, source, summary
        FROM articles
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${embeddingStr}::vector
        LIMIT ${RETRIEVAL_K}
      `,
    );

    const documents: RetrievedDoc[] = rows.rows.map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      source: r.source,
      summary: r.summary,
    }));

    this.logger.log(
      `Retrieved ${documents.length} candidate documents for "${state.originalQuestion}" (iter ${state.iterations})`,
    );

    return { documents };
  }

  private async gradeDocumentsNode(
    state: RagState,
  ): Promise<Partial<RagState>> {
    if (state.documents.length === 0) {
      return { relevantDocuments: [] };
    }

    const docsForPrompt = state.documents
      .map(
        (doc, i) =>
          `[${i}] Title: ${doc.title}\nSource: ${doc.source}\nSummary: ${doc.summary ?? 'No summary.'}`,
      )
      .join('\n\n');

    const system = `You are an expert relevance grader for a software developer knowledge base.
Given a user question and a list of article summaries, return the 0-based indices of ONLY the documents that contain information directly useful for answering the question.
Be strict: if a document is only tangentially related or lacks concrete details, do not include it.
Return an empty array if none of the documents are relevant enough.`;

    const user = `Question: ${state.searchQuery}\n\nDocuments:\n${docsForPrompt}\n\nReturn JSON only.`;

    try {
      const result = (await this.gradingLlm.invoke([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ])) as z.infer<typeof RelevanceSchema>;

      const indices = new Set(
        result.relevant_doc_indices.filter(
          (i) => i >= 0 && i < state.documents.length,
        ),
      );
      const relevantDocuments = state.documents.filter((_, idx) =>
        indices.has(idx),
      );

      this.logger.log(
        `Graded: ${relevantDocuments.length}/${state.documents.length} docs marked relevant`,
      );

      return { relevantDocuments };
    } catch (err) {
      this.logger.warn(
        `Grading failed, falling back to using all retrieved docs: ${err}`,
      );
      return { relevantDocuments: state.documents };
    }
  }

  private routeAfterGrading(state: RagState): 'generate' | 'rewrite' {
    const hasRelevant = (state.relevantDocuments?.length ?? 0) > 0;
    const canRetry = (state.iterations ?? 0) < MAX_ITERATIONS;

    if (hasRelevant) {
      return 'generate';
    }
    if (canRetry) {
      this.logger.log(
        `No relevant docs — will rewrite query (iter ${state.iterations})`,
      );
      return 'rewrite';
    }
    // Give up and generate with whatever we have (even if empty)
    return 'generate';
  }

  private async rewriteQueryNode(state: RagState): Promise<Partial<RagState>> {
    const historyText = state.history
      .slice(-4)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    const system = `You are a query rewriter for semantic search over a database of software engineering articles (Hacker News + Dev.to).
Given the conversation history and the latest user question, produce a single, precise, standalone search query (max 25 words) that will surface the most relevant articles.
Focus on technical keywords, frameworks, concepts. Do not include conversational filler. Output ONLY the rewritten query.`;

    const user = `Conversation so far:\n${historyText || '(no prior turns)'}\n\nLatest question: ${state.originalQuestion}\n\nRewritten search query:`;

    try {
      const response = await this.llm.invoke([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]);

      const newSearchQuery =
        (response.content as string)?.trim().replace(/^["']|["']$/g, '') ||
        state.searchQuery;

      this.logger.log(
        `Rewrote query: "${state.originalQuestion}" -> "${newSearchQuery}"`,
      );

      return {
        searchQuery: newSearchQuery,
        iterations: (state.iterations ?? 0) + 1,
        // Clear previous retrievals so next retrieve populates fresh
        documents: [],
        relevantDocuments: [],
      };
    } catch (err) {
      this.logger.warn(
        `Rewrite failed, falling back to original question: ${err}`,
      );
      return {
        searchQuery: state.originalQuestion,
        iterations: (state.iterations ?? 0) + 1,
        documents: [],
        relevantDocuments: [],
      };
    }
  }

  private async generateNode(state: RagState): Promise<Partial<RagState>> {
    const contextArticles =
      state.relevantDocuments.length > 0
        ? state.relevantDocuments
        : state.documents;

    const context = contextArticles
      .map(
        (a, i) =>
          `[${i + 1}] ${a.title}\nSummary: ${a.summary ?? 'No summary available.'}\nURL: ${a.url}`,
      )
      .join('\n\n');

    const historyMessages = state.history.slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const systemContent =
      'You are a helpful assistant for software developers. Answer the question using only the provided article context from the knowledge base. ' +
      'Be concise, technical, and cite specific details where possible. ' +
      'If the context does not contain enough information, say so clearly. Do not make up facts.';

    const userContent = context
      ? `Context articles:\n\n${context}\n\nQuestion: ${state.originalQuestion}`
      : `No relevant articles were found in the knowledge base.\n\nQuestion: ${state.originalQuestion}`;

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemContent },
      ...historyMessages,
      { role: 'user', content: userContent },
    ];

    try {
      const response = await this.llm.invoke(messages);
      const answer = (response.content as string)?.trim() ?? '';

      const sources: ChatSource[] = contextArticles.map((a) => ({
        title: a.title,
        url: a.url,
        source: a.source,
      }));

      this.logger.log(
        `Generated answer using ${sources.length} sources (for original question)`,
      );

      return { answer, sources };
    } catch (err) {
      this.logger.error(`Generation failed: ${err}`);
      throw new InternalServerErrorException('Failed to generate a response');
    }
  }
}
