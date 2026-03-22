import { getWeeks } from '../../ship-client.js';
import type { FleetGraphStateType } from '../state.js';
import type { Finding } from '../state.js';

/**
 * Detects missing weekly rituals: weeks without plans or retros.
 * Uses Ship REST API: GET /api/weeks (returns has_plan, has_retro flags per week).
 * Runs in parallel with other detection nodes in the proactive graph.
 */
export async function detectMissingRituals(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  try {
    return await _detectMissingRituals(state);
  } catch (err) {
    console.error('[FleetGraph] detect_missing_rituals error:', err);
    return { findings: [] };
  }
}

async function _detectMissingRituals(_state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const weeksData = await getWeeks();
  if (!weeksData?.weeks?.length) return { findings: [] };

  const now = new Date();
  const currentNum = weeksData.currentSprintNumber;

  // Check current + 2 previous weeks
  const relevantWeeks = weeksData.weeks.filter(
    w => w.number >= currentNum - 2 && w.number <= currentNum
  );

  const findings: Finding[] = [];

  for (const week of relevantWeeks) {
    const weekEnd = new Date(week.endDate);
    const weekStart = new Date(week.startDate);
    const isPastWeek = weekEnd < now;
    const isCurrentWeek = weekStart <= now && now <= weekEnd;

    // Missing plan: flag if current week has started without a plan
    if (!week.has_plan && (isCurrentWeek || isPastWeek)) {
      findings.push({
        finding_type: 'missing_ritual',
        severity: isPastWeek ? 'high' : 'medium',
        document_id: week.id,
        document_type: 'sprint',
        summary: `Week "${week.title}" (Sprint ${week.number}) has no weekly plan.`,
        details: {
          week_title: week.title,
          sprint_number: week.number,
          ritual_type: 'weekly_plan',
          owner_id: week.properties?.owner_id,
        },
        proposed_action: `Remind the week owner to submit a weekly plan for "${week.title}".`,
      });
    }

    // Missing retro: flag only for past weeks
    if (!week.has_retro && isPastWeek) {
      findings.push({
        finding_type: 'missing_ritual',
        severity: 'high',
        document_id: week.id,
        document_type: 'sprint',
        summary: `Week "${week.title}" (Sprint ${week.number}) was completed without a retro.`,
        details: {
          week_title: week.title,
          sprint_number: week.number,
          ritual_type: 'weekly_retro',
          owner_id: week.properties?.owner_id,
        },
        proposed_action: `Follow up with the week owner about writing a retrospective for "${week.title}".`,
      });
    }
  }

  return { findings };
}
