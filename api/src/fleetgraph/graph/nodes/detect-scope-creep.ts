import { pool } from '../../../db/client.js';
import type { FleetGraphStateType } from '../state.js';
import type { Finding } from '../state.js';

/**
 * Detects scope creep: issues added to the current week after the weekly plan was submitted.
 * Runs in parallel with other detection nodes in the proactive graph.
 */
export async function detectScopeCreep(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const { workspaceId } = state;

  // Get workspace sprint start date and compute current week
  const wsResult = await pool.query(
    'SELECT sprint_start_date FROM workspaces WHERE id = $1',
    [workspaceId]
  );
  if (wsResult.rows.length === 0) return { findings: [] };

  const sprintStartDate = new Date(wsResult.rows[0].sprint_start_date);
  const now = new Date();
  const daysSinceStart = Math.floor(
    (now.getTime() - sprintStartDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const currentSprintNumber = Math.floor(daysSinceStart / 7) + 1;

  // Find the current week document
  const weekResult = await pool.query(
    `SELECT id, title FROM documents
     WHERE workspace_id = $1
       AND document_type = 'sprint'
       AND (properties->>'sprint_number')::int = $2
       AND archived_at IS NULL`,
    [workspaceId, currentSprintNumber]
  );
  if (weekResult.rows.length === 0) return { findings: [] };

  const weekId = weekResult.rows[0].id;
  const weekTitle = weekResult.rows[0].title;

  // Find the weekly plan submission time and issues added after it — in parallel
  const [planResult, issuesResult] = await Promise.all([
    pool.query(
      `SELECT id, updated_at, created_at FROM documents
       WHERE parent_id = $1
         AND document_type = 'weekly_plan'
       ORDER BY updated_at DESC LIMIT 1`,
      [weekId]
    ),
    pool.query(
      `SELECT i.id, i.title, i.created_at
       FROM documents i
       JOIN document_associations da ON da.document_id = i.id
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND da.relationship_type = 'sprint'
         AND da.related_id = $2
       ORDER BY i.created_at ASC`,
      [workspaceId, weekId]
    ),
  ]);

  if (planResult.rows.length === 0 || issuesResult.rows.length === 0) {
    return { findings: [] };
  }

  const planSubmittedAt = new Date(planResult.rows[0].updated_at);
  const addedAfterPlan = issuesResult.rows.filter(
    (i: { created_at: string }) => new Date(i.created_at) > planSubmittedAt
  );

  if (addedAfterPlan.length === 0) return { findings: [] };

  const findings: Finding[] = [{
    finding_type: 'scope_creep',
    severity: addedAfterPlan.length >= 5 ? 'high' : addedAfterPlan.length >= 3 ? 'medium' : 'low',
    document_id: weekId,
    document_type: 'sprint',
    summary: `${addedAfterPlan.length} issue(s) added to "${weekTitle}" after plan was submitted.`,
    details: {
      week_title: weekTitle,
      plan_submitted_at: planSubmittedAt.toISOString(),
      added_issues: addedAfterPlan.map((i: { id: string; title: string; created_at: string }) => ({
        id: i.id,
        title: i.title,
        created_at: i.created_at,
      })),
    },
    proposed_action: `Review the ${addedAfterPlan.length} new issue(s) and decide whether to defer or accept the scope increase.`,
  }];

  return { findings };
}
