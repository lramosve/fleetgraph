import { pool } from '../../../db/client.js';
import { getIssues } from '../../ship-client.js';
import { createHash } from 'crypto';
import type { FleetGraphStateType } from '../state.js';

/**
 * Detects workspace activity changes by hashing current issue states.
 *
 * Uses Ship REST API (GET /api/issues) to fetch current issue state,
 * then compares a hash against the stored hash in FleetGraph's own poll_state table.
 * FleetGraph's own tables (fleetgraph_poll_state) are accessed via direct DB.
 */
export async function fetchActivity(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const { workspaceId } = state;

  // Fetch current issues via Ship REST API
  const issues = await getIssues();

  // Build activity snapshot: hash of issue IDs + updated_at timestamps
  const snapshot = issues
    .map(i => `${i.id}:${i.updated_at}`)
    .sort()
    .join(',');

  const currentHash = createHash('md5')
    .update(snapshot)
    .digest('hex');

  // Check stored hash (FleetGraph's own table — direct DB OK)
  const pollState = await pool.query(
    'SELECT activity_hash FROM fleetgraph_poll_state WHERE workspace_id = $1',
    [workspaceId]
  );

  const previousHash = pollState.rows[0]?.activity_hash;
  // Preserve hasChanges if already set (e.g., slow poll forces it true)
  const hasChanges = state.hasChanges || (issues.length > 0 && currentHash !== previousHash);

  // Update poll state (FleetGraph's own table)
  await pool.query(
    `INSERT INTO fleetgraph_poll_state (workspace_id, last_fast_poll, activity_hash, updated_at)
     VALUES ($1, NOW(), $2, NOW())
     ON CONFLICT (workspace_id) DO UPDATE SET
       last_fast_poll = NOW(),
       activity_hash = $2,
       updated_at = NOW()`,
    [workspaceId, currentHash]
  );

  const activityFeed = issues.slice(0, 100).map(i => ({
    id: i.id,
    document_id: i.id,
    action: i.state,
    changed_at: i.updated_at,
  }));

  return { activityFeed, hasChanges };
}
