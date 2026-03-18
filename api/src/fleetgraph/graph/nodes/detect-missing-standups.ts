import { pool } from '../../../db/client.js';
import type { FleetGraphStateType } from '../state.js';
import type { Finding } from '../state.js';

/**
 * Detects team members who have not posted a standup in the last 24 hours.
 * Runs in parallel with detect-stale-issues in the proactive graph.
 */
export async function detectMissingStandups(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const { workspaceId } = state;

  // Fetch people and their recent standups in parallel
  const [peopleResult, standupsResult] = await Promise.all([
    pool.query(
      `SELECT d.id, d.title, d.properties
       FROM documents d
       WHERE d.workspace_id = $1
         AND d.document_type = 'person'
         AND d.archived_at IS NULL`,
      [workspaceId]
    ),
    pool.query(
      `SELECT d.properties->>'author_id' as author_id, MAX(d.created_at) as last_standup
       FROM documents d
       WHERE d.workspace_id = $1
         AND d.document_type = 'standup'
         AND d.created_at > NOW() - INTERVAL '48 hours'
       GROUP BY d.properties->>'author_id'`,
      [workspaceId]
    ),
  ]);

  const people = peopleResult.rows;
  const recentStandups = new Map(
    standupsResult.rows.map((r: { author_id: string; last_standup: string }) => [r.author_id, r.last_standup])
  );

  const findings: Finding[] = [];
  const now = Date.now();

  for (const person of people) {
    const lastStandup = recentStandups.get(person.id);
    if (!lastStandup) {
      // No standup in the last 48 hours
      findings.push({
        finding_type: 'missing_standup',
        severity: 'medium',
        document_id: person.id,
        document_type: 'person',
        summary: `${person.title} has not posted a standup in the last 48 hours.`,
        details: { person_name: person.title },
        proposed_action: 'Send a reminder to post a standup update.',
      });
    } else {
      const hoursSince = (now - new Date(lastStandup).getTime()) / (1000 * 60 * 60);
      if (hoursSince > 24) {
        findings.push({
          finding_type: 'missing_standup',
          severity: 'low',
          document_id: person.id,
          document_type: 'person',
          summary: `${person.title} last posted a standup ${hoursSince.toFixed(0)} hours ago.`,
          details: { person_name: person.title, hours_since: hoursSince },
          proposed_action: 'Send a reminder to post a standup update.',
        });
      }
    }
  }

  return { findings };
}
