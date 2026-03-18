import { pool } from '../../../db/client.js';
import type { FleetGraphStateType } from '../state.js';

/**
 * Fetches workspace-level issue statistics.
 * Runs concurrently with fetch-document and fetch-pending-findings.
 */
export async function fetchWorkspaceStats(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const { workspaceId } = state;

  const issueStats = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE properties->>'state' = 'in_progress') as in_progress,
       COUNT(*) FILTER (WHERE properties->>'state' = 'done') as done,
       COUNT(*) FILTER (WHERE properties->>'state' = 'todo') as todo
     FROM documents
     WHERE workspace_id = $1 AND document_type = 'issue' AND archived_at IS NULL`,
    [workspaceId]
  );

  if (issueStats.rows[0]) {
    const s = issueStats.rows[0];
    return { workspaceStats: `Workspace issue stats: ${s.in_progress} in progress, ${s.todo} todo, ${s.done} done` };
  }

  return { workspaceStats: '' };
}
