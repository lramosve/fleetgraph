import { pool } from '../../../db/client.js';
import type { FleetGraphStateType } from '../state.js';
import type { Finding } from '../state.js';

async function persistFinding(finding: Finding, workspaceId: string): Promise<void> {
  // Check for duplicate (same type + document within last 24h)
  const existing = await pool.query(
    `SELECT id FROM fleetgraph_findings
     WHERE workspace_id = $1
       AND finding_type = $2
       AND document_id = $3
       AND created_at > NOW() - INTERVAL '24 hours'
       AND status != 'dismissed'`,
    [workspaceId, finding.finding_type, finding.document_id]
  );

  if (existing.rows.length > 0) return;

  // Check dismissed_until suppression
  const suppressed = await pool.query(
    `SELECT id FROM fleetgraph_findings
     WHERE workspace_id = $1
       AND finding_type = $2
       AND document_id = $3
       AND status = 'dismissed'
       AND dismissed_until > NOW()`,
    [workspaceId, finding.finding_type, finding.document_id]
  );

  if (suppressed.rows.length > 0) return;

  await pool.query(
    `INSERT INTO fleetgraph_findings (workspace_id, finding_type, severity, document_id, document_type, summary, details, proposed_action, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
    [
      workspaceId,
      finding.finding_type,
      finding.severity,
      finding.document_id,
      finding.document_type,
      finding.summary,
      JSON.stringify(finding.details),
      finding.proposed_action,
    ]
  );
}

export async function proposeAction(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const { findings, workspaceId } = state;

  // Persist all findings in parallel (human-in-the-loop gate: status='pending')
  await Promise.all(findings.map(finding => persistFinding(finding, workspaceId)));

  return {};
}
