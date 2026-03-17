import { StateGraph, END } from '@langchain/langgraph';
import { FleetGraphState } from './state.js';
import { fetchActivity } from './nodes/fetch-activity.js';
import { fetchIssues } from './nodes/fetch-issues.js';
import { detectStale } from './nodes/detect-stale.js';
import { proposeAction } from './nodes/propose-action.js';

/**
 * Proactive graph: detects stale issues on a schedule.
 *
 * Path A (findings detected):
 *   fetch_activity → fetch_issues → detect_stale → propose_action → END
 *
 * Path C (clean run, no changes):
 *   fetch_activity → END
 */
export function buildProactiveGraph() {
  const graph = new StateGraph(FleetGraphState)
    .addNode('fetch_activity', fetchActivity)
    .addNode('fetch_issues', fetchIssues)
    .addNode('detect_stale', detectStale)
    .addNode('propose_action', proposeAction)
    .addEdge('__start__', 'fetch_activity')
    .addConditionalEdges('fetch_activity', (state) => {
      return state.hasChanges ? 'fetch_issues' : '__end__';
    }, {
      fetch_issues: 'fetch_issues',
      __end__: END,
    })
    .addEdge('fetch_issues', 'detect_stale')
    .addConditionalEdges('detect_stale', (state) => {
      return state.findings.length > 0 ? 'propose_action' : '__end__';
    }, {
      propose_action: 'propose_action',
      __end__: END,
    })
    .addEdge('propose_action', END);

  return graph.compile();
}
