import { pool } from '../../db/client.js';
import { buildProactiveGraph } from '../graph/proactive.js';

let fastPollInterval: ReturnType<typeof setInterval> | null = null;
let slowPollInterval: ReturnType<typeof setInterval> | null = null;

const FAST_POLL_MS = 3 * 60 * 1000;  // 3 minutes
const SLOW_POLL_MS = 30 * 60 * 1000; // 30 minutes

async function getWorkspaceIds(): Promise<string[]> {
  const result = await pool.query(
    'SELECT id FROM workspaces WHERE archived_at IS NULL'
  );
  return result.rows.map(r => r.id);
}

async function runProactiveScan(workspaceId: string): Promise<void> {
  try {
    const graph = buildProactiveGraph();
    await graph.invoke({
      mode: 'proactive',
      workspaceId,
    });
  } catch (err) {
    console.error(`[FleetGraph] Proactive scan error for workspace ${workspaceId}:`, err);
  }
}

async function fastPoll(): Promise<void> {
  const workspaceIds = await getWorkspaceIds();
  for (const wsId of workspaceIds) {
    await runProactiveScan(wsId);
  }
}

async function slowPoll(): Promise<void> {
  // Slow poll: run full scan for absence-based conditions
  // For MVP, this triggers the same proactive graph but we force hasChanges=true
  const workspaceIds = await getWorkspaceIds();
  for (const wsId of workspaceIds) {
    try {
      const graph = buildProactiveGraph();
      // Override hasChanges to force deep scan on slow poll
      await graph.invoke({
        mode: 'proactive',
        workspaceId: wsId,
        hasChanges: true,
      });
    } catch (err) {
      console.error(`[FleetGraph] Slow poll error for workspace ${wsId}:`, err);
    }
  }
}

export function startPolling(): void {
  console.log('[FleetGraph] Starting polling scheduler');
  console.log(`[FleetGraph] Fast poll: every ${FAST_POLL_MS / 1000}s, Slow poll: every ${SLOW_POLL_MS / 1000}s`);

  // Run initial scan after a short delay
  setTimeout(() => {
    fastPoll().catch(err => console.error('[FleetGraph] Initial fast poll error:', err));
  }, 5000);

  fastPollInterval = setInterval(() => {
    fastPoll().catch(err => console.error('[FleetGraph] Fast poll error:', err));
  }, FAST_POLL_MS);

  slowPollInterval = setInterval(() => {
    slowPoll().catch(err => console.error('[FleetGraph] Slow poll error:', err));
  }, SLOW_POLL_MS);
}

export function stopPolling(): void {
  if (fastPollInterval) clearInterval(fastPollInterval);
  if (slowPollInterval) clearInterval(slowPollInterval);
  fastPollInterval = null;
  slowPollInterval = null;
  console.log('[FleetGraph] Polling stopped');
}
