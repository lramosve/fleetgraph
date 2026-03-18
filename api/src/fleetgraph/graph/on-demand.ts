import { StateGraph, END } from '@langchain/langgraph';
import { FleetGraphState } from './state.js';
import { fetchDocument } from './nodes/fetch-document.js';
import { fetchWorkspaceStats } from './nodes/fetch-workspace-stats.js';
import { fetchPendingFindings } from './nodes/fetch-pending-findings.js';
import { mergeContext } from './nodes/merge-context.js';
import { answerQuery } from './nodes/answer-query.js';
import { formatResponse } from './nodes/format-response.js';

/**
 * On-demand graph: answers user questions with workspace context.
 *
 * Topology (with parallel fan-out for context fetching):
 *
 *   __start__ ──► ┌─ fetch_document ─────────┐
 *                 │                           │
 *                 ├─ fetch_workspace_stats ───┼──► merge_context ──► answer_query ──► format_response ──► END
 *                 │                           │
 *                 └─ fetch_pending_findings ──┘
 *
 * Three context-fetch nodes run in PARALLEL, each writing to its own state field.
 * merge_context combines them into contextData for the LLM.
 * fetch_document also uses Promise.all internally for doc + history queries.
 */
export function buildOnDemandGraph() {
  const graph = new StateGraph(FleetGraphState)
    .addNode('fetch_document', fetchDocument)
    .addNode('fetch_workspace_stats', fetchWorkspaceStats)
    .addNode('fetch_pending_findings', fetchPendingFindings)
    .addNode('merge_context', mergeContext)
    .addNode('answer_query', answerQuery)
    .addNode('format_response', formatResponse)
    // Parallel fan-out: all three context-fetch nodes start concurrently
    .addConditionalEdges('__start__', () => {
      return ['fetch_document', 'fetch_workspace_stats', 'fetch_pending_findings'];
    }, {
      fetch_document: 'fetch_document',
      fetch_workspace_stats: 'fetch_workspace_stats',
      fetch_pending_findings: 'fetch_pending_findings',
    })
    // Fan-in: all context nodes converge on merge_context
    .addEdge('fetch_document', 'merge_context')
    .addEdge('fetch_workspace_stats', 'merge_context')
    .addEdge('fetch_pending_findings', 'merge_context')
    .addEdge('merge_context', 'answer_query')
    .addEdge('answer_query', 'format_response')
    .addEdge('format_response', END);

  return graph.compile();
}
