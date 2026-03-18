import type { FleetGraphStateType } from '../state.js';

/**
 * Merges parallel context-fetch outputs into a single contextData string.
 * Fan-in node after parallel fetch_document, fetch_workspace_stats, fetch_pending_findings.
 */
export async function mergeContext(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const parts = [
    state.documentContext,
    state.workspaceStats,
    state.pendingFindingsContext,
  ].filter(Boolean);

  return { contextData: parts.join('\n\n') };
}
