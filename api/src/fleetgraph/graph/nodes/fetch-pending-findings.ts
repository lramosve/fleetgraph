import { pool } from '../../../db/client.js';
import type { FleetGraphStateType } from '../state.js';

/**
 * Fetches pending FleetGraph findings for the workspace.
 * Runs concurrently with fetch-document and fetch-workspace-stats.
 */
export async function fetchPendingFindings(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const { workspaceId } = state;

  const findings = await pool.query(
    `SELECT finding_type, severity, summary FROM fleetgraph_findings
     WHERE workspace_id = $1 AND status = 'pending'
     ORDER BY created_at DESC LIMIT 10`,
    [workspaceId]
  );

  if (findings.rows.length === 0) {
    return { pendingFindingsContext: '' };
  }

  const parts = ['Pending FleetGraph findings:'];
  for (const f of findings.rows) {
    parts.push(`  - [${f.severity}] ${f.finding_type}: ${f.summary}`);
  }

  return { pendingFindingsContext: parts.join('\n') };
}
