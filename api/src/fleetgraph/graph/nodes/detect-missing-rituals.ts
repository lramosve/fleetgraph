import { pool } from '../../../db/client.js';
import type { FleetGraphStateType } from '../state.js';
import type { Finding } from '../state.js';

/**
 * Detects missing weekly rituals: weeks without plans or retros.
 * Runs in parallel with other detection nodes in the proactive graph.
 */
export async function detectMissingRituals(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const { workspaceId } = state;

  // Get workspace sprint start date
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

  // Check the last 3 weeks (current + 2 previous) for missing plans/retros
  const sprintNumbers = [currentSprintNumber, currentSprintNumber - 1, currentSprintNumber - 2]
    .filter(n => n > 0);

  // Fetch weeks and their child ritual documents in parallel
  const [weeksResult, ritualsResult] = await Promise.all([
    pool.query(
      `SELECT id, title, properties->>'sprint_number' as sprint_number, properties->>'owner_id' as owner_id
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'sprint'
         AND (properties->>'sprint_number')::int = ANY($2::int[])
         AND archived_at IS NULL`,
      [workspaceId, sprintNumbers]
    ),
    pool.query(
      `SELECT d.parent_id, d.document_type, d.content
       FROM documents d
       JOIN documents week ON week.id = d.parent_id
       WHERE week.workspace_id = $1
         AND week.document_type = 'sprint'
         AND (week.properties->>'sprint_number')::int = ANY($2::int[])
         AND d.document_type IN ('weekly_plan', 'weekly_retro')
         AND d.archived_at IS NULL`,
      [workspaceId, sprintNumbers]
    ),
  ]);

  // Build a map of week_id → { hasPlan, hasRetro }
  const ritualMap = new Map<string, { hasPlan: boolean; hasRetro: boolean }>();
  for (const week of weeksResult.rows) {
    ritualMap.set(week.id, { hasPlan: false, hasRetro: false });
  }
  for (const ritual of ritualsResult.rows) {
    const entry = ritualMap.get(ritual.parent_id);
    if (!entry) continue;
    const hasContent = ritual.content && JSON.stringify(ritual.content).length > 100;
    if (ritual.document_type === 'weekly_plan' && hasContent) entry.hasPlan = true;
    if (ritual.document_type === 'weekly_retro' && hasContent) entry.hasRetro = true;
  }

  const findings: Finding[] = [];

  for (const week of weeksResult.rows) {
    const sprintNum = parseInt(week.sprint_number, 10);
    const entry = ritualMap.get(week.id);
    if (!entry) continue;

    // Compute week start/end dates
    const weekStart = new Date(sprintStartDate);
    weekStart.setUTCDate(weekStart.getUTCDate() + (sprintNum - 1) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

    const isPastWeek = weekEnd < now;
    const isCurrentWeek = weekStart <= now && now <= weekEnd;

    // Missing plan: flag if current week has started without a plan
    if (!entry.hasPlan && (isCurrentWeek || isPastWeek)) {
      findings.push({
        finding_type: 'missing_ritual',
        severity: isPastWeek ? 'high' : 'medium',
        document_id: week.id,
        document_type: 'sprint',
        summary: `Week "${week.title}" (Sprint ${sprintNum}) has no weekly plan.`,
        details: {
          week_title: week.title,
          sprint_number: sprintNum,
          ritual_type: 'weekly_plan',
          owner_id: week.owner_id,
        },
        proposed_action: `Remind the week owner to submit a weekly plan for "${week.title}".`,
      });
    }

    // Missing retro: flag only for past weeks
    if (!entry.hasRetro && isPastWeek) {
      findings.push({
        finding_type: 'missing_ritual',
        severity: 'high',
        document_id: week.id,
        document_type: 'sprint',
        summary: `Week "${week.title}" (Sprint ${sprintNum}) was completed without a retro.`,
        details: {
          week_title: week.title,
          sprint_number: sprintNum,
          ritual_type: 'weekly_retro',
          owner_id: week.owner_id,
        },
        proposed_action: `Follow up with the week owner about writing a retrospective for "${week.title}".`,
      });
    }
  }

  return { findings };
}
