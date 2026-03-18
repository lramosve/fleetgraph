import { pool } from '../../../db/client.js';
import type { FleetGraphStateType } from '../state.js';

/**
 * Fetches the current document and its history in parallel.
 * Runs concurrently with fetch-workspace-stats and fetch-pending-findings.
 */
export async function fetchDocument(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const { workspaceId, documentId, documentType } = state;
  const parts: string[] = [];

  if (!documentId || !documentType) {
    return { documentContext: '' };
  }

  // Fetch document and history in parallel (history only for issues)
  const docPromise = pool.query(
    'SELECT id, title, document_type, properties, content, updated_at FROM documents WHERE id = $1 AND workspace_id = $2',
    [documentId, workspaceId]
  );

  const historyPromise = documentType === 'issue'
    ? pool.query(
        `SELECT dh.field, dh.old_value, dh.new_value, dh.created_at, u.name as changed_by_name
         FROM document_history dh
         LEFT JOIN users u ON u.id = dh.changed_by
         WHERE dh.document_id = $1
         ORDER BY dh.created_at DESC LIMIT 10`,
        [documentId]
      )
    : Promise.resolve({ rows: [] });

  const [doc, history] = await Promise.all([docPromise, historyPromise]);

  if (doc.rows[0]) {
    const d = doc.rows[0];
    parts.push(`Current document: "${d.title}" (${d.document_type})`);
    parts.push(`Properties: ${JSON.stringify(d.properties)}`);
    if (d.content) parts.push(`Content preview: ${JSON.stringify(d.content).slice(0, 500)}`);
  }

  if (history.rows.length > 0) {
    parts.push('Recent history:');
    for (const h of history.rows) {
      parts.push(`  - ${h.field} changed by ${h.changed_by_name || 'system'} at ${h.created_at}`);
    }
  }

  return { documentContext: parts.join('\n') };
}
