import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../ship-client.js', () => ({
  getCurrentWorkspace: vi.fn(),
  getWeeks: vi.fn(),
  getWeekIssues: vi.fn(),
  getWeekPlan: vi.fn(),
}));

import { getCurrentWorkspace, getWeeks, getWeekIssues, getWeekPlan } from '../../../ship-client.js';
import { detectScopeCreep } from '../detect-scope-creep.js';
import type { FleetGraphStateType } from '../../state.js';

const mockGetCurrentWorkspace = getCurrentWorkspace as ReturnType<typeof vi.fn>;
const mockGetWeeks = getWeeks as ReturnType<typeof vi.fn>;
const mockGetWeekIssues = getWeekIssues as ReturnType<typeof vi.fn>;
const mockGetWeekPlan = getWeekPlan as ReturnType<typeof vi.fn>;

function makeState(overrides: Partial<FleetGraphStateType> = {}): FleetGraphStateType {
  return {
    mode: 'proactive', workspaceId: 'ws-1', activityFeed: [], hasChanges: true,
    issues: [], staleIssues: [], findings: [], userMessage: '', userId: '',
    documentId: null, documentType: null, documentContext: '', workspaceStats: '',
    pendingFindingsContext: '', contextData: '', response: '', ...overrides,
  };
}

describe('detectScopeCreep', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns empty findings when workspace has no data', async () => {
    mockGetCurrentWorkspace.mockRejectedValueOnce(new Error('not found'));
    const result = await detectScopeCreep(makeState());
    expect(result.findings).toEqual([]);
  });

  it('returns empty findings when no current week exists', async () => {
    mockGetCurrentWorkspace.mockResolvedValueOnce({ id: 'ws-1', sprintStartDate: '2026-01-05' });
    mockGetWeeks.mockResolvedValueOnce({ weeks: [], currentSprintNumber: 11 });
    const result = await detectScopeCreep(makeState());
    expect(result.findings).toEqual([]);
  });

  it('returns empty findings when no plan exists', async () => {
    mockGetCurrentWorkspace.mockResolvedValueOnce({ id: 'ws-1', sprintStartDate: '2026-01-05' });
    mockGetWeeks.mockResolvedValueOnce({ weeks: [{ id: 'w1', number: 11, title: 'Week 11' }], currentSprintNumber: 11 });
    mockGetWeekPlan.mockResolvedValueOnce(null);
    mockGetWeekIssues.mockResolvedValueOnce([]);
    const result = await detectScopeCreep(makeState());
    expect(result.findings).toEqual([]);
  });

  it('detects issues added after plan submission', async () => {
    const planTime = '2026-03-16T10:00:00Z';
    const afterPlan = '2026-03-17T08:00:00Z';
    const beforePlan = '2026-03-15T08:00:00Z';

    mockGetCurrentWorkspace.mockResolvedValueOnce({ id: 'ws-1', sprintStartDate: '2026-01-05' });
    mockGetWeeks.mockResolvedValueOnce({ weeks: [{ id: 'w1', number: 11, title: 'Week 11' }], currentSprintNumber: 11 });
    mockGetWeekPlan.mockResolvedValueOnce({ id: 'p1', updated_at: planTime, created_at: planTime });
    mockGetWeekIssues.mockResolvedValueOnce([
      { id: 'i1', title: 'Before plan', created_at: beforePlan },
      { id: 'i2', title: 'After plan', created_at: afterPlan },
      { id: 'i3', title: 'Also after', created_at: afterPlan },
    ]);

    const result = await detectScopeCreep(makeState());
    expect(result.findings).toHaveLength(1);
    expect(result.findings![0].finding_type).toBe('scope_creep');
    expect(result.findings![0].severity).toBe('low');
    expect(result.findings![0].summary).toContain('2 issue(s)');
  });

  it('assigns high severity for 5+ added issues', async () => {
    const planTime = '2026-03-16T10:00:00Z';
    const afterPlan = '2026-03-17T08:00:00Z';

    mockGetCurrentWorkspace.mockResolvedValueOnce({ id: 'ws-1', sprintStartDate: '2026-01-05' });
    mockGetWeeks.mockResolvedValueOnce({ weeks: [{ id: 'w1', number: 11, title: 'Week 11' }], currentSprintNumber: 11 });
    mockGetWeekPlan.mockResolvedValueOnce({ id: 'p1', updated_at: planTime, created_at: planTime });
    mockGetWeekIssues.mockResolvedValueOnce(
      Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, title: `Issue ${i}`, created_at: afterPlan }))
    );

    const result = await detectScopeCreep(makeState());
    expect(result.findings![0].severity).toBe('high');
  });
});
