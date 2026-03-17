import { pool } from '../../../db/client.js';

/**
 * Execute an approved finding's action (e.g., add a comment to the issue).
 * Called when a user approves a finding via the REST API.
 */
export async function executeAction(findingId: string, workspaceId: string): Promise<void> {
  const result = await pool.query(
    'SELECT * FROM fleetgraph_findings WHERE id = $1 AND workspace_id = $2',
    [findingId, workspaceId]
  );

  const finding = result.rows[0];
  if (!finding) throw new Error('Finding not found');

  if (finding.finding_type === 'stale_issue' && finding.document_id) {
    // Add a comment to the stale issue
    const commentContent = `**FleetGraph Alert:** ${finding.summary}\n\n*Suggested action:* ${finding.proposed_action}`;

    await pool.query(
      `INSERT INTO comments (id, workspace_id, document_id, comment_id, author_id, content)
       VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(),
         (SELECT id FROM users WHERE email = 'fleetgraph@system' LIMIT 1),
         $3)`,
      [workspaceId, finding.document_id, commentContent]
    );
  }

  // Mark finding as executed
  await pool.query(
    "UPDATE fleetgraph_findings SET status = 'executed', updated_at = NOW() WHERE id = $1",
    [findingId]
  );
}
