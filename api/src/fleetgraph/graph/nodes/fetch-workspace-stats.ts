import { getIssueStats } from '../../ship-client.js';
import type { FleetGraphStateType } from '../state.js';

/**
 * Fetches workspace-level issue statistics via Ship REST API.
 * Uses: GET /api/issues (3 calls with state filters, in parallel).
 * Runs concurrently with fetch-document and fetch-pending-findings.
 */
export async function fetchWorkspaceStats(_state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const stats = await getIssueStats();

  return {
    workspaceStats: `Workspace issue stats: ${stats.in_progress} in progress, ${stats.todo} todo, ${stats.done} done`,
  };
}
