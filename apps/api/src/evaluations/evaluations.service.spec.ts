/**
 * Unit tests for EvaluationsService.
 *
 * Strategy:
 * - Mock @langchain/openai so no real API calls are made.
 * - Test the structured-output pathway: judge returns valid scores → result object.
 * - Test error handling: judge throws → evaluate() returns null.
 * - Test edge cases: empty question / answer → short-circuits.
 * - Test clampScore: out-of-range LLM values are clamped to [0, 1].
 * - Test evaluateAsync: fire-and-forget wrapper invokes callback.
 */

// Hoist the mock so the real @langchain/openai module is never imported.
jest.mock('@langchain/openai', () => {
  const invokeMock = jest.fn();
  const instance = {
    invoke: invokeMock,
    withStructuredOutput: jest.fn(function () {
      return this;
    }),
  };
  return {
    ChatOpenAI: jest.fn().mockImplementation(() => instance),
    __esModule: true,
  };
});

import { Test, TestingModule } from '@nestjs/testing';
import { EvaluationsService } from './evaluations.service';
import { LangfuseService } from '../langfuse/langfuse.service';

describe('EvaluationsService (unit)', () => {
  let service: EvaluationsService;
  let judgeLlmMock: { invoke: jest.Mock };
  let mockLangfuseService: any;

  const baseInput = {
    question: 'What is RAG?',
    answer:
      'RAG stands for Retrieval-Augmented Generation, combining a retriever with an LLM.',
    context: [
      {
        title: 'RAG Explained',
        url: 'https://ex.com/rag',
        source: 'devto',
        summary:
          'RAG is a technique that augments LLMs with external knowledge retrieval.',
      },
    ],
    userId: 'u-test-001',
  };

  const happyScores = {
    faithfulness: 0.95,
    answer_relevance: 0.88,
    context_recall: 0.9,
  };

  beforeEach(async () => {
    mockLangfuseService = {
      isEnabled: jest.fn().mockReturnValue(false),
      createCallbackHandler: jest.fn(),
      score: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvaluationsService,
        { provide: LangfuseService, useValue: mockLangfuseService },
      ],
    }).compile();

    service = module.get<EvaluationsService>(EvaluationsService);

    // Wire up a stable mock for the lazy judgeLlm getter.
    judgeLlmMock = { invoke: jest.fn().mockResolvedValue(happyScores) };
    (service as any)._judgeLlm = judgeLlmMock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  it('returns a complete EvaluationResult with scores on success', async () => {
    const result = await service.evaluate(baseInput);

    expect(result).not.toBeNull();
    expect(result!.question).toBe(baseInput.question);
    expect(result!.answer).toBe(baseInput.answer);
    expect(result!.userId).toBe('u-test-001');
    expect(typeof result!.id).toBe('string');
    expect(result!.id.length).toBe(36); // UUID v4

    expect(result!.scores.faithfulness).toBeCloseTo(0.95);
    expect(result!.scores.answer_relevance).toBeCloseTo(0.88);
    expect(result!.scores.context_recall).toBeCloseTo(0.9);
    expect(result!.evaluatedAt).toBeDefined();
    // Should be a valid ISO date string
    expect(new Date(result!.evaluatedAt).toISOString()).toBe(
      result!.evaluatedAt,
    );
  });

  it('invokes the judge LLM with a system prompt mentioning all three metrics', async () => {
    await service.evaluate(baseInput);

    expect(judgeLlmMock.invoke).toHaveBeenCalledTimes(1);
    const callArgs = judgeLlmMock.invoke.mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;

    expect(callArgs[0].role).toBe('system');
    expect(callArgs[0].content).toContain('faithfulness');
    expect(callArgs[0].content).toContain('answer_relevance');
    expect(callArgs[0].content).toContain('context_recall');

    expect(callArgs[1].role).toBe('user');
    expect(callArgs[1].content).toContain(baseInput.question);
    expect(callArgs[1].content).toContain(baseInput.answer);
    expect(callArgs[1].content).toContain('RAG Explained');
  });

  it('includes context article titles and summaries in the user prompt', async () => {
    await service.evaluate(baseInput);

    const userMsg = (judgeLlmMock.invoke.mock.calls[0][0] as any[])[1];
    expect(userMsg.content).toContain('RAG Explained');
    expect(userMsg.content).toContain('augments LLMs');
  });

  it('works without a userId (userId field is optional)', async () => {
    const { userId: _userId, ...inputNoUser } = baseInput;
    const result = await service.evaluate(inputNoUser);

    expect(result).not.toBeNull();
    expect(result!.userId).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Empty context
  // ---------------------------------------------------------------------------

  it('handles empty context array gracefully (passes "(no context provided)" to judge)', async () => {
    const result = await service.evaluate({ ...baseInput, context: [] });

    expect(result).not.toBeNull();
    const userMsg = (judgeLlmMock.invoke.mock.calls[0][0] as any[])[1];
    expect(userMsg.content).toContain('no context provided');
  });

  // ---------------------------------------------------------------------------
  // Short-circuit for empty question / answer
  // ---------------------------------------------------------------------------

  it('returns null and skips LLM call when question is empty', async () => {
    const result = await service.evaluate({ ...baseInput, question: '' });

    expect(result).toBeNull();
    expect(judgeLlmMock.invoke).not.toHaveBeenCalled();
  });

  it('returns null and skips LLM call when answer is empty', async () => {
    const result = await service.evaluate({ ...baseInput, answer: '   ' });

    expect(result).toBeNull();
    expect(judgeLlmMock.invoke).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  it('returns null (does not throw) when the judge LLM throws', async () => {
    judgeLlmMock.invoke.mockRejectedValueOnce(new Error('OpenAI rate limit'));

    const result = await service.evaluate(baseInput);

    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Score clamping
  // ---------------------------------------------------------------------------

  it('clamps out-of-range scores from misbehaving LLM to [0, 1]', async () => {
    judgeLlmMock.invoke.mockResolvedValueOnce({
      faithfulness: 1.5, // over 1
      answer_relevance: -0.3, // below 0
      context_recall: 0.7,
    });

    const result = await service.evaluate(baseInput);

    expect(result!.scores.faithfulness).toBe(1);
    expect(result!.scores.answer_relevance).toBe(0);
    expect(result!.scores.context_recall).toBeCloseTo(0.7);
  });

  // ---------------------------------------------------------------------------
  // evaluateAsync (fire-and-forget wrapper)
  // ---------------------------------------------------------------------------

  it('evaluateAsync resolves and calls the onResult callback with the result', async () => {
    const onResult = jest.fn();

    service.evaluateAsync(baseInput, onResult);

    // Wait for microtask queue to drain
    await new Promise(setImmediate);

    expect(onResult).toHaveBeenCalledTimes(1);
    const result = onResult.mock.calls[0][0];
    expect(result.scores.faithfulness).toBeCloseTo(0.95);
  });

  it('evaluateAsync does not throw when evaluate returns null (LLM error)', async () => {
    judgeLlmMock.invoke.mockRejectedValueOnce(new Error('judge down'));
    const onResult = jest.fn();

    // Should not throw synchronously or asynchronously
    expect(() => service.evaluateAsync(baseInput, onResult)).not.toThrow();
    await new Promise(setImmediate);

    expect(onResult).not.toHaveBeenCalled();
  });

  it('evaluateAsync works without a callback (fire-and-forget with no receiver)', async () => {
    // Should not throw at all
    expect(() => service.evaluateAsync(baseInput)).not.toThrow();
    await new Promise(setImmediate);
    // No assertion beyond "it didn't crash"
  });

  // ---------------------------------------------------------------------------
  // Additional Coverage Tests
  // ---------------------------------------------------------------------------

  it('should lazily initialize the judgeLlm', () => {
    delete (service as any)._judgeLlm;
    const llm = (service as any).judgeLlm;
    expect(llm).toBeDefined();
    // Subsequent calls return cached instance
    expect((service as any).judgeLlm).toBe(llm);
  });

  it('passes Langfuse callback handler to LLM when Langfuse is enabled', async () => {
    const mockHandler = { name: 'mockCallbackHandler' };
    mockLangfuseService.isEnabled.mockReturnValue(true);
    mockLangfuseService.createCallbackHandler.mockReturnValue(mockHandler);

    await service.evaluate(baseInput);

    expect(mockLangfuseService.createCallbackHandler).toHaveBeenCalledWith({
      traceName: 'RAG Evaluation',
      userId: baseInput.userId,
      tags: ['evaluation'],
      metadata: {
        parentTraceId: undefined,
      },
    });
    expect(judgeLlmMock.invoke).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ callbacks: [mockHandler] }),
    );
  });

  it('passes Langfuse callback handler to LLM and submits scores when Langfuse is enabled and traceId is provided', async () => {
    const mockHandler = { name: 'mockCallbackHandler' };
    mockLangfuseService.isEnabled.mockReturnValue(true);
    mockLangfuseService.createCallbackHandler.mockReturnValue(mockHandler);

    const traceId = 't-test-999';
    await service.evaluate({ ...baseInput, traceId });

    expect(mockLangfuseService.createCallbackHandler).toHaveBeenCalledWith({
      traceName: 'RAG Evaluation',
      userId: baseInput.userId,
      tags: ['evaluation'],
      metadata: {
        parentTraceId: traceId,
      },
    });
    expect(judgeLlmMock.invoke).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ callbacks: [mockHandler] }),
    );

    expect(mockLangfuseService.score).toHaveBeenCalledTimes(3);
    expect(mockLangfuseService.score).toHaveBeenCalledWith({
      traceId,
      name: 'faithfulness',
      value: happyScores.faithfulness,
    });
    expect(mockLangfuseService.score).toHaveBeenCalledWith({
      traceId,
      name: 'answer_relevance',
      value: happyScores.answer_relevance,
    });
    expect(mockLangfuseService.score).toHaveBeenCalledWith({
      traceId,
      name: 'context_recall',
      value: happyScores.context_recall,
    });
  });

  it('evaluateAsync logs unhandled rejection if evaluate throws', async () => {
    const loggerSpy = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation();
    jest
      .spyOn(service, 'evaluate')
      .mockRejectedValueOnce(new Error('unhandled error'));

    service.evaluateAsync(baseInput);
    await new Promise(setImmediate);

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('evaluateAsync unhandled rejection'),
    );
    loggerSpy.mockRestore();
  });
});
