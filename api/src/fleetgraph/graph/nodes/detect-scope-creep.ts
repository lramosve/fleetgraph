import { getCurrentWorkspace, getWeeks, getWeekIssues, getWeekPlan } from '../../ship-client.js';
import type { FleetGraphStateType } from '../state.js';
import type { Finding } from '../state.js';

/**
 * Detects scope creep: issues added to the current week after the weekly plan was submitted.
 * Uses Ship REST API: GET /api/workspaces/current, GET /api/weeks, GET /api/weeks/:id/issues, GET /api/weeks/:id/plan.
 * Runs in parallel with other detection nodes in the proactive graph.
 */
export async function detectScopeCreep(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  try {
    return await _detectScopeCreep(state);
  } catch (err) {
    console.error('[FleetGraph] detect_scope_creep error:', err);
    return { findings: [] };
  }
}

async function _detectScopeCreep(_state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  // Get current workspace and weeks via Ship REST API
  const [workspace, weeksData] = await Promise.all([
    getCurrentWorkspace(),
    getWeeks(),
  ]);

  if (!workspace?.sprintStartDate || !weeksData?.weeks?.length) return { findings: [] };

  const currentWeek = weeksData.weeks.find(w => w.number === weeksData.currentSprintNumber);
  if (!currentWeek) return { findings: [] };

  // Fetch plan and issues for current week in parallel
  const [plan, issues] = await Promise.all([
    getWeekPlan(currentWeek.id),
    getWeekIssues(currentWeek.id),
  ]);

  if (!plan || !issues.length) return { findings: [] };

  const planSubmittedAt = new Date(plan.updated_at);
  const addedAfterPlan = issues.filter(i => new Date(i.created_at) > planSubmittedAt);

  if (addedAfterPlan.length === 0) return { findings: [] };

  const findings: Finding[] = [{
    finding_type: 'scope_creep',
    severity: addedAfterPlan.length >= 5 ? 'high' : addedAfterPlan.length >= 3 ? 'medium' : 'low',
    document_id: currentWeek.id,
    document_type: 'sprint',
    summary: `${addedAfterPlan.length} issue(s) added to "${currentWeek.title}" after plan was submitted.`,
    details: {
      week_title: currentWeek.title,
      plan_submitted_at: planSubmittedAt.toISOString(),
      added_issues: addedAfterPlan.map(i => ({
        id: i.id,
        title: i.title,
        created_at: i.created_at,
      })),
    },
    proposed_action: `Review the ${addedAfterPlan.length} new issue(s) and decide whether to defer or accept the scope increase.`,
  }];

  return { findings };
}
