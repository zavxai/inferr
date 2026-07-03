/**
 * DTOs for the AI Evaluations module.
 *
 * An EvaluationInput captures everything a judge LLM needs to score a single
 * RAG turn. The three metric scores live in EvaluationResult.
 *
 * Metric definitions (all 0–1, higher is better):
 *   faithfulness    – Is the answer fully grounded in the provided context?
 *                     Low = hallucinated facts not present in context.
 *   answer_relevance – Does the answer actually address the user's question?
 *                      Low = answer is off-topic or too vague.
 *   context_recall  – Did the retrieved documents contain the info needed to
 *                      answer the question? Low = retrieval missed key facts.
 */

export interface EvaluationSource {
  title: string;
  url: string;
  source: string;
  summary?: string | null;
}

export interface EvaluationInput {
  /** The user's original question. */
  question: string;
  /** The RAG-generated answer to evaluate. */
  answer: string;
  /** The articles that were surfaced as context to the LLM during generation. */
  context: EvaluationSource[];
  /** Optional: associate evaluation with a specific user for analytics. */
  userId?: string;
  /** Optional: Langfuse trace ID of the user request. */
  traceId?: string;
}

export interface MetricScores {
  /** 0–1. 1 = perfectly grounded in context, 0 = fully hallucinated. */
  faithfulness: number;
  /** 0–1. 1 = answer directly and completely addresses the question. */
  answer_relevance: number;
  /** 0–1. 1 = context contained all information needed to answer. */
  context_recall: number;
}

export interface EvaluationResult {
  id: string;
  question: string;
  answer: string;
  scores: MetricScores;
  /** ISO timestamp set by the service at evaluation time. */
  evaluatedAt: string;
  userId?: string;
}
