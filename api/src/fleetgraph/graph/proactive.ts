import { StateGraph, END } from '@langchain/langgraph';
import { FleetGraphState } from './state.js';
import { fetchActivity } from './nodes/fetch-activity.js';
import { detectStaleIssues } from './nodes/detect-stale-issues.js';
import { detectMissingStandups } from './nodes/detect-missing-standups.js';
import { detectScopeCreep } from './nodes/detect-scope-creep.js';
import { detectMissingRituals } from './nodes/detect-missing-rituals.js';
import { proposeAction } from './nodes/propose-action.js';

/**
 * Proactive graph: detects project issues on a schedule.
 *
 * Topology (parallel fan-out to 4 detection nodes):
 *
 *   fetch_activity ──► [conditional: hasChanges?]
 *                       │
 *                       ├─ no  ──► END
 *                       │
 *                       └─ yes ──► ┌─ detect_stale_issues ────┐
 *                                  ├─ detect_missing_standups ─┤
 *                                  ├─ detect_scope_creep ──────┤──► propose_action ──► END
 *                                  └─ detect_missing_rituals ──┘
 *
 * All 4 detection nodes run in PARALLEL.
 * Each writes to the shared `findings` array (merge reducer).
 * propose_action waits for all to complete (fan-in), then persists findings.
 */
export function buildProactiveGraph() {
  const graph = new StateGraph(FleetGraphState)
    .addNode('fetch_activity', fetchActivity)
    .addNode('detect_stale_issues', detectStaleIssues)
    .addNode('detect_missing_standups', detectMissingStandups)
    .addNode('detect_scope_creep', detectScopeCreep)
    .addNode('detect_missing_rituals', detectMissingRituals)
    .addNode('propose_action', proposeAction)
    .addEdge('__start__', 'fetch_activity')
    // Parallel fan-out: return array of node names for concurrent execution
    .addConditionalEdges('fetch_activity', (state) => {
      if (!state.hasChanges) return '__end__';
      return [
        'detect_stale_issues',
        'detect_missing_standups',
        'detect_scope_creep',
        'detect_missing_rituals',
      ];
    }, {
      detect_stale_issues: 'detect_stale_issues',
      detect_missing_standups: 'detect_missing_standups',
      detect_scope_creep: 'detect_scope_creep',
      detect_missing_rituals: 'detect_missing_rituals',
      __end__: END,
    })
    // Fan-in: all detection nodes converge on propose_action
    .addEdge('detect_stale_issues', 'propose_action')
    .addEdge('detect_missing_standups', 'propose_action')
    .addEdge('detect_scope_creep', 'propose_action')
    .addEdge('detect_missing_rituals', 'propose_action')
    .addEdge('propose_action', END);

  return graph.compile();
}
