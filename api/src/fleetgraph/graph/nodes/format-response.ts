import type { FleetGraphStateType } from '../state.js';

export async function formatResponse(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  // Response is already formatted by answer-query; this node is a pass-through
  // that could be extended with formatting logic (markdown, links, etc.)
  return { response: state.response };
}
