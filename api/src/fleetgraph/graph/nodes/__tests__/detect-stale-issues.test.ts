import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB pool
vi.mock('../../../../db/client.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

// Mock the LLM client
vi.mock('../../../llm/client.js', () => ({
  getLLM: vi.fn(),
}));

import { pool } from '../../../../db/client.js';
import { getLLM } from '../../../llm/client.js';
import { detectStaleIssues } from '../detect-stale-issues.js';
import type { FleetGraphStateType } from '../../state.js';

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };
const mockGetLLM = getLLM as ReturnType<typeof vi.fn>;

function makeState(overrides: Partial<FleetGraphStateType> = {}): FleetGraphStateType {
  return {
    mode: 'proactive',
    workspaceId: 'ws-1',
    activityFeed: [],
    hasChanges: true,
    issues: [],
    staleIssues: [],
    findings: [],
    userMessage: '',
    userId: '',
    documentId: null,
    documentType: null,
    documentContext: '',
    workspaceStats: '',
    pendingFindingsContext: '',
    contextData: '',
    response: '',
    ...overrides,
  };
}

describe('detectStaleIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty findings when no in-progress issues exist', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await detectStaleIssues(makeState());

    expect(result.findings).toEqual([]);
    expect(result.staleIssues).toEqual([]);
  });

  it('skips issues updated less than 48 hours ago', async () => {
    const recentDate = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(); // 12h ago
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'issue-1',
        title: 'Fresh issue',
        updated_at: recentDate,
        properties: { state: 'in_progress' },
      }],
    });

    const result = await detectStaleIssues(makeState());

    expect(result.findings).toEqual([]);
    expect(result.staleIssues).toEqual([]);
  });

  it('uses LLM fallback when response is invalid JSON', async () => {
    const staleDate = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(); // 4 days ago
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'issue-1',
        title: 'Stale issue',
        updated_at: staleDate,
        properties: { state: 'in_progress', assignee_id: 'user-1' },
      }],
    });

    // LLM returns invalid JSON
    mockGetLLM.mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: 'not valid json' }),
    });

    const result = await detectStaleIssues(makeState());

    expect(result.findings).toHaveLength(1);
    expect(result.findings![0].finding_type).toBe('stale_issue');
    expect(result.findings![0].severity).toBe('medium'); // 4 days = medium
    expect(result.staleIssues).toHaveLength(1);
  });

  it('classifies severity correctly in fallback mode', async () => {
    const fiveDaysAgo = new Date(Date.now() - 5.5 * 24 * 60 * 60 * 1000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3.5 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2.5 * 24 * 60 * 60 * 1000).toISOString();

    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'high', title: 'High', updated_at: fiveDaysAgo, properties: { state: 'in_progress' } },
        { id: 'med', title: 'Medium', updated_at: threeDaysAgo, properties: { state: 'in_progress' } },
        { id: 'low', title: 'Low', updated_at: twoDaysAgo, properties: { state: 'in_progress' } },
      ],
    });

    mockGetLLM.mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: '{}' }), // invalid array
    });

    const result = await detectStaleIssues(makeState());

    expect(result.findings).toHaveLength(3);
    const severities = result.findings!.map(f => ({ id: f.document_id, severity: f.severity }));
    expect(severities).toContainEqual({ id: 'high', severity: 'high' });
    expect(severities).toContainEqual({ id: 'med', severity: 'medium' });
    expect(severities).toContainEqual({ id: 'low', severity: 'low' });
  });

  it('uses LLM classifications when response is valid JSON', async () => {
    const staleDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'issue-1',
        title: 'Blocked task',
        updated_at: staleDate,
        properties: { state: 'in_progress', assignee_id: 'user-1' },
      }],
    });

    const llmResponse = JSON.stringify([{
      id: 'issue-1',
      severity: 'high',
      summary: 'This task appears blocked',
      proposed_action: 'Escalate to team lead',
    }]);

    mockGetLLM.mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: llmResponse }),
    });

    const result = await detectStaleIssues(makeState());

    expect(result.findings).toHaveLength(1);
    expect(result.findings![0].severity).toBe('high');
    expect(result.findings![0].summary).toBe('This task appears blocked');
    expect(result.findings![0].proposed_action).toBe('Escalate to team lead');
  });
});
