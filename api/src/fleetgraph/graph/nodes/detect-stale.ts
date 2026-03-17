import { getLLM } from '../../llm/client.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { FleetGraphStateType } from '../state.js';

export async function detectStale(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const { issues } = state;
  const now = Date.now();

  // Pre-filter: issues with no update in 48+ hours
  const candidates = issues
    .map(issue => {
      const updatedAt = new Date(issue.updated_at).getTime();
      const daysSinceUpdate = (now - updatedAt) / (1000 * 60 * 60 * 24);
      return { ...issue, daysSinceUpdate };
    })
    .filter(issue => issue.daysSinceUpdate >= 2);

  if (candidates.length === 0) {
    return { staleIssues: [], findings: [] };
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
    classifications = JSON.parse(content);
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

  const findings = classifications.map(c => {
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

  return { staleIssues, findings };
}
