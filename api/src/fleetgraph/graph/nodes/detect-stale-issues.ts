import { getLLM } from '../../llm/client.js';
import { getIssues } from '../../ship-client.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { FleetGraphStateType } from '../state.js';
import type { Finding } from '../state.js';

/**
 * Combined node: fetches in-progress issues via Ship REST API and detects stale ones via LLM.
 * Runs in parallel with other detection nodes in the proactive graph.
 */
export async function detectStaleIssues(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  try {
    return await _detectStaleIssues(state);
  } catch (err) {
    console.error('[FleetGraph] detect_stale_issues error:', err);
    return { issues: [], staleIssues: [], findings: [] };
  }
}

async function _detectStaleIssues(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const now = Date.now();

  // Fetch all in-progress issues via Ship REST API
  const apiIssues = await getIssues({ state: 'in_progress' });

  const issues = apiIssues.map(row => ({
    id: row.id,
    title: row.title,
    state: row.state || 'in_progress',
    assignee_id: (row.assignee_id || row.properties?.assignee_id as string) || null,
    updated_at: row.updated_at,
    properties: row.properties || {},
  }));

  // Pre-filter: issues with no update in 48+ hours
  const candidates = issues
    .map(issue => {
      const updatedAt = new Date(issue.updated_at).getTime();
      const daysSinceUpdate = (now - updatedAt) / (1000 * 60 * 60 * 24);
      return { ...issue, daysSinceUpdate };
    })
    .filter(issue => issue.daysSinceUpdate >= 2);

  if (candidates.length === 0) {
    return { issues, staleIssues: [], findings: [] };
  }

  // Use LLM to classify severity and generate summaries
  const llm = getLLM();
  const issueList = candidates
    .map(i => `- "${i.title}" (${i.daysSinceUpdate.toFixed(1)} days since update, assignee: ${i.assignee_id || 'unassigned'})`)
    .join('\n');

  const response = await llm.invoke([
    new SystemMessage(
      `You are FleetGraph, a project intelligence agent. Analyze these stale issues (in_progress with no activity for 48+ hours) and classify their severity.

For each issue, output a JSON array with objects containing:
- id: the issue id
- severity: "high" (5+ days stale), "medium" (3-5 days), or "low" (2-3 days)
- summary: a brief human-readable summary of the staleness concern
- proposed_action: what action to suggest (e.g., "Add a comment asking for status update")

Output ONLY valid JSON, no markdown fences.`
    ),
    new HumanMessage(`Stale issues:\n${issueList}\n\nIssue IDs: ${candidates.map(c => c.id).join(', ')}`)
  ]);

  let classifications: Array<{ id: string; severity: string; summary: string; proposed_action: string }> = [];
  try {
    const content = typeof response.content === 'string' ? response.content : '';
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) throw new Error('Expected array');
    classifications = parsed;
  } catch {
    // Fallback: classify by days
    classifications = candidates.map(c => ({
      id: c.id,
      severity: c.daysSinceUpdate >= 5 ? 'high' : c.daysSinceUpdate >= 3 ? 'medium' : 'low',
      summary: `Issue "${c.title}" has been in progress for ${c.daysSinceUpdate.toFixed(1)} days with no activity.`,
      proposed_action: 'Add a comment asking the assignee for a status update.',
    }));
  }

  const staleIssues = candidates.map(c => ({
    id: c.id,
    title: c.title,
    daysSinceUpdate: c.daysSinceUpdate,
    assignee_id: c.assignee_id,
  }));

  const findings: Finding[] = classifications.map(c => {
    const issue = candidates.find(i => i.id === c.id);
    return {
      finding_type: 'stale_issue',
      severity: c.severity,
      document_id: c.id,
      document_type: 'issue',
      summary: c.summary,
      details: { daysSinceUpdate: issue?.daysSinceUpdate, title: issue?.title },
      proposed_action: c.proposed_action,
    };
  });

  return { issues, staleIssues, findings };
}
