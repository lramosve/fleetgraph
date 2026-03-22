import { pool } from '../../../db/client.js';
import { addComment } from '../../ship-client.js';

/**
 * Execute an approved finding's action.
 * Uses Ship REST API for write operations (POST /api/documents/:id/comments).
 * Uses direct DB for FleetGraph's own tables (fleetgraph_findings status update).
 */
export async function executeAction(findingId: string, workspaceId: string): Promise<void> {
  // Read from FleetGraph's own table (direct DB is OK for FleetGraph tables)
  const result = await pool.query(
    'SELECT * FROM fleetgraph_findings WHERE id = $1 AND workspace_id = $2',
    [findingId, workspaceId]
  );

  const finding = result.rows[0];
  if (!finding) throw new Error('Finding not found');

  if (finding.finding_type === 'stale_issue' && finding.document_id) {
    // Write via Ship REST API
    const commentContent = `**FleetGraph Alert:** ${finding.summary}\n\n*Suggested action:* ${finding.proposed_action}`;
    await addComment(finding.document_id, commentContent);
  }

  // Update FleetGraph's own table
  await pool.query(
    "UPDATE fleetgraph_findings SET status = 'executed', updated_at = NOW() WHERE id = $1",
    [findingId]
  );
}
