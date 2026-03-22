import { getDocument, getIssueHistory } from '../../ship-client.js';
import type { FleetGraphStateType } from '../state.js';

/**
 * Fetches the current document and its history via Ship REST API in parallel.
 * Uses: GET /api/documents/:id + GET /api/issues/:id/history.
 * Runs concurrently with fetch-workspace-stats and fetch-pending-findings.
 */
export async function fetchDocument(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const { documentId, documentType } = state;
  const parts: string[] = [];

  if (!documentId || !documentType) {
    return { documentContext: '' };
  }

  // Fetch document and history in parallel (history only for issues)
  const docPromise = getDocument(documentId);
  const historyPromise = documentType === 'issue'
    ? getIssueHistory(documentId)
    : Promise.resolve([]);

  const [doc, history] = await Promise.all([docPromise, historyPromise]);

  if (doc) {
    parts.push(`Current document: "${doc.title}" (${doc.document_type})`);
    parts.push(`Properties: ${JSON.stringify(doc.properties)}`);
    if (doc.content) parts.push(`Content preview: ${JSON.stringify(doc.content).slice(0, 500)}`);
  }

  if (history.length > 0) {
    parts.push('Recent history:');
    for (const h of history.slice(0, 10)) {
      parts.push(`  - ${h.field} changed by ${h.changed_by?.name || 'system'} at ${h.created_at}`);
    }
  }

  return { documentContext: parts.join('\n') };
}
