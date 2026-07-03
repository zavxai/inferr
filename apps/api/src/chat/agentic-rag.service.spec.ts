import { Test, TestingModule } from '@nestjs/testing';
import { AgenticRagService } from './agentic-rag.service';
import { AiService } from '../ai/ai.service';
import { DRIZZLE } from '../db/drizzle.provider';
import { ChatService } from './chat.service';
import { EvaluationsService } from '../evaluations/evaluations.service';
import { LangfuseService } from '../langfuse/langfuse.service';

// Hoisted mocks prevent loading real ESM-only @langchain packages (and transitive uuid etc)
// during unit test collection/execution. We stub just enough for the SUT module to parse.
jest.mock('@langchain/langgraph', () => ({
  StateGraph: class {},
  START: 'START',
  END: 'END',
  Annotation: { Root: (s: any) => s },
}));
jest.mock('@langchain/openai', () => {
  const invokeMock = jest.fn();
  const instance = {
    invoke: invokeMock,
    withStructuredOutput: jest.fn(function (_s: any) {
      return this;
    }),
  };
  return {
    ChatOpenAI: jest.fn().mockImplementation((_opts?: any) => instance),
    __esModule: true,
  };
});

describe('AgenticRagService + ChatService (unit)', () => {
  let agentic: AgenticRagService;
  let _chatService: any;
  let aiService: jest.Mocked<AiService>;
  let mockDb: any;
  let mockEvaluations: jest.Mocked<EvaluationsService>;
  let mockLangfuseService: any;

  beforeEach(async () => {
    aiService = {
      embed: jest.fn(),
      summarize: jest.fn(),
      chat: jest.fn(),
      processUnsummarized: jest.fn(),
    } as any;

    mockDb = {
      execute: jest.fn().mockResolvedValue({ rows: [] }),
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
    };

    mockEvaluations = {
      evaluate: jest.fn().mockResolvedValue(null),
      evaluateAsync: jest.fn(), // fire-and-forget stub
    } as any;

    mockLangfuseService = {
      isEnabled: jest.fn().mockReturnValue(false),
      createCallbackHandler: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgenticRagService,
        { provide: AiService, useValue: aiService },
        { provide: DRIZZLE, useValue: mockDb },
        { provide: LangfuseService, useValue: mockLangfuseService },
        { provide: EvaluationsService, useValue: mockEvaluations },
      ],
    }).compile();

    agentic = module.get<AgenticRagService>(AgenticRagService);

    // Stub the expensive lazy graph + llms so public query works without OPENAI / langgraph real execution
    (agentic as any)._graph = {
      invoke: jest.fn().mockResolvedValue({
        answer: 'This is the generated answer based on context.',
        sources: [
          { title: 'Relevant Article', url: 'https://ex.com/a', source: 'hn' },
        ],
      }),
    };

    // Stable mock objects for getters (defineProperty because they are read-only getters in the class)
    (agentic as any)._llmMock = {
      invoke: jest.fn().mockResolvedValue({ content: 'stub answer' }),
    };
    (agentic as any)._gradingLlmMock = {
      invoke: jest.fn().mockResolvedValue({ relevant_doc_indices: [] }),
    };
    Object.defineProperty(agentic, 'llm', {
      get: () => (agentic as any)._llmMock,
      configurable: true,
    });
    Object.defineProperty(agentic, 'gradingLlm', {
      get: () => (agentic as any)._gradingLlmMock,
      configurable: true,
    });
  });

  it('ChatService delegates to AgenticRagService.query', async () => {
    const chat = new ChatService(agentic);

    const res = await chat.query('u-1', 'How do I use pgvector?');

    expect((agentic as any)._graph.invoke).toHaveBeenCalled();
    expect(res.answer).toContain('generated answer');
    expect(res.sources).toHaveLength(1);
  });

  it('query logs and returns result from graph (with userId for traceability)', async () => {
    const res = await agentic.query('u-42', 'Explain RAG grading');

    expect(res).toEqual({
      answer: 'This is the generated answer based on context.',
      sources: [
        { title: 'Relevant Article', url: 'https://ex.com/a', source: 'hn' },
      ],
    });
  });

  it('retrieveNode performs embedding + vector search via db.execute and returns documents', async () => {
    aiService.embed.mockResolvedValue([0.01, 0.02]);
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        {
          id: 'doc1',
          title: 'RAG 101',
          url: 'r1',
          source: 'devto',
          summary: 'Intro',
        },
        {
          id: 'doc2',
          title: 'Advanced',
          url: 'r2',
          source: 'hn',
          summary: null,
        },
      ],
    });

    const state = {
      searchQuery: 'rag tutorial',
      originalQuestion: 'q',
      iterations: 0,
    } as any;
    const out = await (agentic as any).retrieveNode(state);

    expect(aiService.embed).toHaveBeenCalledWith('rag tutorial');
    expect(mockDb.execute).toHaveBeenCalled();
    // The sql template is passed; we just care it ran
    expect(out.documents).toHaveLength(2);
    expect(out.documents[0].title).toBe('RAG 101');
  });

  it('gradeDocumentsNode uses gradingLlm and returns only relevant subset (or all on error)', async () => {
    // Success: indices [0,2] selected -- use the stable mock we attached in beforeEach
    (agentic as any)._gradingLlmMock.invoke.mockResolvedValueOnce({
      relevant_doc_indices: [0, 2],
    });

    const docs = [
      { id: 'd0', title: 'Good', url: '', source: '', summary: 'matches' },
      { id: 'd1', title: 'Bad', url: '', source: '', summary: 'tangent' },
      { id: 'd2', title: 'Also Good', url: '', source: '', summary: 'useful' },
    ];

    const state = { documents: docs, searchQuery: 'foo' } as any;
    const out = await (agentic as any).gradeDocumentsNode(state);

    expect(out.relevantDocuments).toHaveLength(2);
    expect(out.relevantDocuments.map((d: any) => d.id)).toEqual(['d0', 'd2']);

    // Error fallback path
    (agentic as any)._gradingLlmMock.invoke.mockRejectedValueOnce(
      new Error('llm down'),
    );
    const out2 = await (agentic as any).gradeDocumentsNode({
      documents: docs,
    } as any);
    expect(out2.relevantDocuments).toHaveLength(3); // falls back to all
  });

  it('routeAfterGrading chooses generate when relevant docs present, else rewrite if under max iters', () => {
    const hasRelevant = (agentic as any).routeAfterGrading({
      relevantDocuments: [{}],
      iterations: 0,
    });
    expect(hasRelevant).toBe('generate');

    const needsRewrite = (agentic as any).routeAfterGrading({
      relevantDocuments: [],
      iterations: 0,
    });
    expect(needsRewrite).toBe('rewrite');

    const giveUp = (agentic as any).routeAfterGrading({
      relevantDocuments: [],
      iterations: 2,
    });
    expect(giveUp).toBe('generate');
  });

  it('generateNode builds context from relevant (or all) docs and returns answer + sources', async () => {
    // The graph stub already covers high level; here we can test the node in isolation by stubbing llm via the stable ref
    (agentic as any)._llmMock.invoke.mockResolvedValueOnce({
      content: 'Concise technical answer here.',
    });

    const relevant = [
      {
        id: 'r1',
        title: 'The One',
        url: 'u1',
        source: 'hn',
        summary: 'Key fact X.',
      },
    ];
    const state = {
      relevantDocuments: relevant,
      documents: [],
      originalQuestion: 'What is X?',
      history: [], // prevent .slice error in real generateNode
    } as any;

    const out = await (agentic as any).generateNode(state);

    expect(out.answer).toBe('Concise technical answer here.');
    expect(out.sources).toEqual([
      { title: 'The One', url: 'u1', source: 'hn' },
    ]);
  });

  // ---------------------------------------------------------------------------
  // Evaluation integration
  // ---------------------------------------------------------------------------

  it('calls evaluationsService.evaluateAsync fire-and-forget after a successful query', async () => {
    // The graph mock already has answer + sources; evaluateAsync should be called once.
    await agentic.query('u-eval', 'What is vector search?');

    expect(mockEvaluations.evaluateAsync).toHaveBeenCalledTimes(1);
    const evalArg = mockEvaluations.evaluateAsync.mock.calls[0][0];
    expect(evalArg.question).toBe('What is vector search?');
    expect(evalArg.userId).toBe('u-eval');
    expect(evalArg.answer).toContain('generated answer');
  });

  it('passes traceId from Langfuse callback handler to evaluationsService if Langfuse is enabled', async () => {
    mockLangfuseService.isEnabled.mockReturnValue(true);
    mockLangfuseService.createCallbackHandler.mockReturnValue({
      traceId: 't-test-id-123',
    });

    await agentic.query('u-eval', 'What is vector search?');

    expect(mockEvaluations.evaluateAsync).toHaveBeenCalledTimes(1);
    const evalArg = mockEvaluations.evaluateAsync.mock.calls[0][0];
    expect(evalArg.traceId).toBe('t-test-id-123');
  });

  it('still returns a result when EvaluationsService is not injected (@Optional)', async () => {
    // Build a separate module without providing EvaluationsService to confirm
    // the @Optional() decorator means the service degrades gracefully.
    const moduleNoEval: TestingModule = await Test.createTestingModule({
      providers: [
        AgenticRagService,
        { provide: AiService, useValue: aiService },
        { provide: DRIZZLE, useValue: mockDb },
        { provide: LangfuseService, useValue: mockLangfuseService },
        // EvaluationsService intentionally omitted
      ],
    }).compile();

    const agenticNoEval =
      moduleNoEval.get<AgenticRagService>(AgenticRagService);

    // Set up same graph stub
    (agenticNoEval as any)._graph = {
      invoke: jest.fn().mockResolvedValue({
        answer: 'Answer without eval.',
        sources: [],
        relevantDocuments: [],
        documents: [],
      }),
    };

    const res = await agenticNoEval.query('u-no-eval', 'Test?');
    expect(res.answer).toBe('Answer without eval.');
    expect(res.sources).toEqual([]);
    // No error thrown — EvaluationsService absence handled via @Optional
  });
});
