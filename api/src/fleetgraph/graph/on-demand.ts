import { StateGraph, END } from '@langchain/langgraph';
import { FleetGraphState } from './state.js';
import { fetchContext } from './nodes/fetch-context.js';
import { answerQuery } from './nodes/answer-query.js';
import { formatResponse } from './nodes/format-response.js';

/**
 * On-demand graph: answers user questions with workspace context.
 *
 * Path B:
 *   fetch_context → answer_query → format_response → END
 */
export function buildOnDemandGraph() {
  const graph = new StateGraph(FleetGraphState)
    .addNode('fetch_context', fetchContext)
    .addNode('answer_query', answerQuery)
    .addNode('format_response', formatResponse)
    .addEdge('__start__', 'fetch_context')
    .addEdge('fetch_context', 'answer_query')
    .addEdge('answer_query', 'format_response')
    .addEdge('format_response', END);

  return graph.compile();
}
