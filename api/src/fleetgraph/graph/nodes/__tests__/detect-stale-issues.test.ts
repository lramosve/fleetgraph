import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Ship API client
vi.mock('../../../ship-client.js', () => ({
  getIssues: vi.fn(),
}));

// Mock the LLM client
vi.mock('../../../llm/client.js', () => ({
  getLLM: vi.fn(),
}));

import { getIssues } from '../../../ship-client.js';
import { getLLM } from '../../../llm/client.js';
import { detectStaleIssues } from '../detect-stale-issues.js';
import type { FleetGraphStateType } from '../../state.js';

const mockGetIssues = getIssues as ReturnType<typeof vi.fn>;
const mockGetLLM = getLLM as ReturnType<typeof vi.fn>;

function makeState(overrides: Partial<FleetGraphStateType> = {}): FleetGraphStateType {
  return {
    mode: 'proactive', workspaceId: 'ws-1', activityFeed: [], hasChanges: true,
    issues: [], staleIssues: [], findings: [], userMessage: '', userId: '',
    documentId: null, documentType: null, documentContext: '', workspaceStats: '',
    pendingFindingsContext: '', contextData: '', response: '', ...overrides,
  };
}

describe('detectStaleIssues', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns empty findings when no in-progress issues exist', async () => {
    mockGetIssues.mockResolvedValueOnce([]);
    const result = await detectStaleIssues(makeState());
    expect(result.findings).toEqual([]);
    expect(result.staleIssues).toEqual([]);
  });

  it('skips issues updated less than 48 hours ago', async () => {
    const recentDate = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    mockGetIssues.mockResolvedValueOnce([
      { id: 'issue-1', title: 'Fresh issue', state: 'in_progress', updated_at: recentDate, properties: {} },
    ]);
    const result = await detectStaleIssues(makeState());
    expect(result.findings).toEqual([]);
  });

  it('uses LLM fallback when response is invalid JSON', async () => {
    const staleDate = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    mockGetIssues.mockResolvedValueOnce([
      { id: 'issue-1', title: 'Stale issue', state: 'in_progress', assignee_id: 'user-1', updated_at: staleDate, properties: { assignee_id: 'user-1' } },
    ]);
    mockGetLLM.mockReturnValue({ invoke: vi.fn().mockResolvedValue({ content: 'not valid json' }) });

    const result = await detectStaleIssues(makeState());
    expect(result.findings).toHaveLength(1);
    expect(result.findings![0].finding_type).toBe('stale_issue');
    expect(result.findings![0].severity).toBe('medium');
  });

  it('classifies severity correctly in fallback mode', async () => {
    const fiveDaysAgo = new Date(Date.now() - 5.5 * 24 * 60 * 60 * 1000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3.5 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2.5 * 24 * 60 * 60 * 1000).toISOString();

    mockGetIssues.mockResolvedValueOnce([
      { id: 'high', title: 'High', state: 'in_progress', updated_at: fiveDaysAgo, properties: {} },
      { id: 'med', title: 'Medium', state: 'in_progress', updated_at: threeDaysAgo, properties: {} },
      { id: 'low', title: 'Low', state: 'in_progress', updated_at: twoDaysAgo, properties: {} },
    ]);
    mockGetLLM.mockReturnValue({ invoke: vi.fn().mockResolvedValue({ content: '{}' }) });

    const result = await detectStaleIssues(makeState());
    expect(result.findings).toHaveLength(3);
    const severities = result.findings!.map(f => ({ id: f.document_id, severity: f.severity }));
    expect(severities).toContainEqual({ id: 'high', severity: 'high' });
    expect(severities).toContainEqual({ id: 'med', severity: 'medium' });
    expect(severities).toContainEqual({ id: 'low', severity: 'low' });
  });

  it('uses LLM classifications when response is valid JSON', async () => {
    const staleDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    mockGetIssues.mockResolvedValueOnce([
      { id: 'issue-1', title: 'Blocked task', state: 'in_progress', assignee_id: 'user-1', updated_at: staleDate, properties: {} },
    ]);
    const llmResponse = JSON.stringify([{
      id: 'issue-1', severity: 'high', summary: 'This task appears blocked', proposed_action: 'Escalate to team lead',
    }]);
    mockGetLLM.mockReturnValue({ invoke: vi.fn().mockResolvedValue({ content: llmResponse }) });

    const result = await detectStaleIssues(makeState());
    expect(result.findings).toHaveLength(1);
    expect(result.findings![0].severity).toBe('high');
    expect(result.findings![0].summary).toBe('This task appears blocked');
  });
});
