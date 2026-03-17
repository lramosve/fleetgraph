import { pool } from '../../../db/client.js';
import type { FleetGraphStateType } from '../state.js';

export async function fetchContext(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const { workspaceId, documentId, documentType } = state;
  const parts: string[] = [];

  if (documentId && documentType) {
    // Fetch the specific document
    const doc = await pool.query(
      'SELECT id, title, document_type, properties, content, updated_at FROM documents WHERE id = $1 AND workspace_id = $2',
      [documentId, workspaceId]
    );
    if (doc.rows[0]) {
      const d = doc.rows[0];
      parts.push(`Current document: "${d.title}" (${d.document_type})`);
      parts.push(`Properties: ${JSON.stringify(d.properties)}`);
      if (d.content) parts.push(`Content preview: ${JSON.stringify(d.content).slice(0, 500)}`);
    }

    // If issue, fetch related history
    if (documentType === 'issue') {
      const history = await pool.query(
        `SELECT dh.field, dh.old_value, dh.new_value, dh.created_at, u.name as changed_by_name
         FROM document_history dh
         LEFT JOIN users u ON u.id = dh.changed_by
         WHERE dh.document_id = $1
         ORDER BY dh.created_at DESC LIMIT 10`,
        [documentId]
      );
      if (history.rows.length > 0) {
        parts.push('Recent history:');
        for (const h of history.rows) {
          parts.push(`  - ${h.field} changed by ${h.changed_by_name || 'system'} at ${h.created_at}`);
        }
      }
    }
  }

  // Fetch workspace-level summary
  const issueStats = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE properties->>'state' = 'in_progress') as in_progress,
       COUNT(*) FILTER (WHERE properties->>'state' = 'done') as done,
       COUNT(*) FILTER (WHERE properties->>'state' = 'todo') as todo
     FROM documents
     WHERE workspace_id = $1 AND document_type = 'issue' AND archived_at IS NULL`,
    [workspaceId]
  );

  if (issueStats.rows[0]) {
    const s = issueStats.rows[0];
    parts.push(`\nWorkspace issue stats: ${s.in_progress} in progress, ${s.todo} todo, ${s.done} done`);
  }

  // Fetch pending findings
  const findings = await pool.query(
    `SELECT finding_type, severity, summary FROM fleetgraph_findings
     WHERE workspace_id = $1 AND status = 'pending'
     ORDER BY created_at DESC LIMIT 10`,
    [workspaceId]
  );
  if (findings.rows.length > 0) {
    parts.push('\nPending FleetGraph findings:');
    for (const f of findings.rows) {
      parts.push(`  - [${f.severity}] ${f.finding_type}: ${f.summary}`);
    }
  }

  return { contextData: parts.join('\n') };
}
