import { getPeople, getStandups } from '../../ship-client.js';
import type { FleetGraphStateType } from '../state.js';
import type { Finding } from '../state.js';

/**
 * Detects team members who have not posted a standup in the last 24 hours.
 * Uses Ship REST API: GET /api/team/people + GET /api/standups.
 * Runs in parallel with other detection nodes in the proactive graph.
 */
export async function detectMissingStandups(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  try {
    return await _detectMissingStandups(state);
  } catch (err) {
    console.error('[FleetGraph] detect_missing_standups error:', err);
    return { findings: [] };
  }
}

async function _detectMissingStandups(_state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const dateFrom = twoDaysAgo.toISOString().substring(0, 10);
  const dateTo = now.toISOString().substring(0, 10);

  // Fetch people and recent standups in parallel via Ship REST API
  const [people, standups] = await Promise.all([
    getPeople(),
    getStandups(dateFrom, dateTo),
  ]);

  // Build map: person_id → last standup timestamp
  const recentStandups = new Map<string, string>();
  for (const s of standups) {
    const authorId = s.properties?.author_id as string;
    if (!authorId) continue;
    const existing = recentStandups.get(authorId);
    if (!existing || s.created_at > existing) {
      recentStandups.set(authorId, s.created_at);
    }
  }

  const findings: Finding[] = [];

  for (const person of people) {
    const lastStandup = recentStandups.get(person.id) || recentStandups.get(person.user_id || '');
    if (!lastStandup) {
      // No standup in the last 48 hours
      findings.push({
        finding_type: 'missing_standup',
        severity: 'medium',
        document_id: person.id,
        document_type: 'person',
        summary: `${person.name} has not posted a standup in the last 48 hours.`,
        details: { person_name: person.name },
        proposed_action: 'Send a reminder to post a standup update.',
      });
    } else {
      const hoursSince = (now.getTime() - new Date(lastStandup).getTime()) / (1000 * 60 * 60);
      if (hoursSince > 24) {
        findings.push({
          finding_type: 'missing_standup',
          severity: 'low',
          document_id: person.id,
          document_type: 'person',
          summary: `${person.name} last posted a standup ${hoursSince.toFixed(0)} hours ago.`,
          details: { person_name: person.name, hours_since: hoursSince },
          proposed_action: 'Send a reminder to post a standup update.',
        });
      }
    }
  }

  return { findings };
}
