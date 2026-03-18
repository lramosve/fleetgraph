import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../db/client.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from '../../../../db/client.js';
import { detectScopeCreep } from '../detect-scope-creep.js';
import type { FleetGraphStateType } from '../../state.js';

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };

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

describe('detectScopeCreep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty findings when workspace has no sprint_start_date', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await detectScopeCreep(makeState());
    expect(result.findings).toEqual([]);
  });

  it('returns empty findings when no current week exists', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ sprint_start_date: '2026-01-05' }] })
      .mockResolvedValueOnce({ rows: [] }); // no week document

    const result = await detectScopeCreep(makeState());
    expect(result.findings).toEqual([]);
  });

  it('returns empty findings when no plan exists', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ sprint_start_date: '2026-01-05' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'week-1', title: 'Week 11' }] })
      .mockResolvedValueOnce({ rows: [] })  // no plan
      .mockResolvedValueOnce({ rows: [] }); // issues (empty due to Promise.all)

    const result = await detectScopeCreep(makeState());
    expect(result.findings).toEqual([]);
  });

  it('detects issues added after plan submission', async () => {
    const planTime = '2026-03-16T10:00:00Z';
    const afterPlan = '2026-03-17T08:00:00Z';
    const beforePlan = '2026-03-15T08:00:00Z';

    mockPool.query
      .mockResolvedValueOnce({ rows: [{ sprint_start_date: '2026-01-05' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'week-1', title: 'Week 11' }] })
      // Promise.all: plan + issues
      .mockResolvedValueOnce({ rows: [{ id: 'plan-1', updated_at: planTime, created_at: planTime }] })
      .mockResolvedValueOnce({
        rows: [
          { id: 'issue-1', title: 'Before plan', created_at: beforePlan },
          { id: 'issue-2', title: 'After plan', created_at: afterPlan },
          { id: 'issue-3', title: 'Also after', created_at: afterPlan },
        ],
      });

    const result = await detectScopeCreep(makeState());

    expect(result.findings).toHaveLength(1);
    expect(result.findings![0].finding_type).toBe('scope_creep');
    expect(result.findings![0].severity).toBe('low'); // 2 issues = low
    expect(result.findings![0].summary).toContain('2 issue(s)');
  });

  it('assigns severity based on count of added issues', async () => {
    const planTime = '2026-03-16T10:00:00Z';
    const afterPlan = '2026-03-17T08:00:00Z';

    mockPool.query
      .mockResolvedValueOnce({ rows: [{ sprint_start_date: '2026-01-05' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'week-1', title: 'Week 11' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'plan-1', updated_at: planTime, created_at: planTime }] })
      .mockResolvedValueOnce({
        rows: Array.from({ length: 6 }, (_, i) => ({
          id: `issue-${i}`,
          title: `Issue ${i}`,
          created_at: afterPlan,
        })),
      });

    const result = await detectScopeCreep(makeState());

    expect(result.findings![0].severity).toBe('high'); // 6 issues >= 5
  });
});
