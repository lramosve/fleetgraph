import { pool } from '../../../db/client.js';
import type { FleetGraphStateType } from '../state.js';

export async function fetchIssues(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const { workspaceId } = state;

  // Get all in_progress issues that may be stale
  const result = await pool.query(
    `SELECT d.id, d.title, d.updated_at, d.properties
     FROM documents d
     WHERE d.workspace_id = $1
       AND d.document_type = 'issue'
       AND d.properties->>'state' = 'in_progress'
       AND d.archived_at IS NULL
     ORDER BY d.updated_at ASC`,
    [workspaceId]
  );

  const issues = result.rows.map(row => ({
    id: row.id,
    title: row.title,
    state: row.properties?.state || 'in_progress',
    assignee_id: row.properties?.assignee_id || null,
    updated_at: row.updated_at,
    properties: row.properties || {},
  }));

  return { issues };
}
