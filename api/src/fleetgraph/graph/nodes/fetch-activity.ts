import { pool } from '../../../db/client.js';
import { createHash } from 'crypto';
import type { FleetGraphStateType } from '../state.js';

export async function fetchActivity(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const { workspaceId } = state;

  // Get recent activity (last 5 minutes for fast poll)
  // document_history doesn't have workspace_id, so join through documents
  const result = await pool.query(
    `SELECT dh.id, dh.document_id, dh.field, dh.created_at
     FROM document_history dh
     JOIN documents d ON d.id = dh.document_id
     WHERE d.workspace_id = $1
       AND dh.created_at > NOW() - INTERVAL '5 minutes'
     ORDER BY dh.created_at DESC
     LIMIT 100`,
    [workspaceId]
  );

  const activityFeed = result.rows.map(r => ({
    id: r.id,
    document_id: r.document_id,
    action: r.field,
    changed_at: r.created_at,
  }));

  // Check if anything changed since last poll
  const currentHash = createHash('md5')
    .update(JSON.stringify(activityFeed.map(a => a.id)))
    .digest('hex');

  // Check stored hash
  const pollState = await pool.query(
    'SELECT activity_hash FROM fleetgraph_poll_state WHERE workspace_id = $1',
    [workspaceId]
  );

  const previousHash = pollState.rows[0]?.activity_hash;
  // Preserve hasChanges if already set (e.g., slow poll forces it true)
  const hasChanges = state.hasChanges || (activityFeed.length > 0 && currentHash !== previousHash);

  // Update poll state
  await pool.query(
    `INSERT INTO fleetgraph_poll_state (workspace_id, last_fast_poll, activity_hash, updated_at)
     VALUES ($1, NOW(), $2, NOW())
     ON CONFLICT (workspace_id) DO UPDATE SET
       last_fast_poll = NOW(),
       activity_hash = $2,
       updated_at = NOW()`,
    [workspaceId, currentHash]
  );

  return { activityFeed, hasChanges };
}
