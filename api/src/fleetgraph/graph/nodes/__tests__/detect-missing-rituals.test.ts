import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../ship-client.js', () => ({
  getWeeks: vi.fn(),
}));

import { getWeeks } from '../../../ship-client.js';
import { detectMissingRituals } from '../detect-missing-rituals.js';
import type { FleetGraphStateType } from '../../state.js';

const mockGetWeeks = getWeeks as ReturnType<typeof vi.fn>;

function makeState(overrides: Partial<FleetGraphStateType> = {}): FleetGraphStateType {
  return {
    mode: 'proactive', workspaceId: 'ws-1', activityFeed: [], hasChanges: true,
    issues: [], staleIssues: [], findings: [], userMessage: '', userId: '',
    documentId: null, documentType: null, documentContext: '', workspaceStats: '',
    pendingFindingsContext: '', contextData: '', response: '', ...overrides,
  };
}

describe('detectMissingRituals', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns empty findings when API fails', async () => {
    mockGetWeeks.mockRejectedValueOnce(new Error('API error'));
    const result = await detectMissingRituals(makeState());
    expect(result.findings).toEqual([]);
  });

  it('returns empty findings when no weeks exist', async () => {
    mockGetWeeks.mockResolvedValueOnce({ weeks: [], currentSprintNumber: 11 });
    const result = await detectMissingRituals(makeState());
    expect(result.findings).toEqual([]);
  });

  it('detects past weeks without retros as high severity', async () => {
    const pastWeekEnd = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
    const pastWeekStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

    mockGetWeeks.mockResolvedValueOnce({
      weeks: [{
        id: 'w10', number: 10, title: 'Week 10',
        startDate: pastWeekStart, endDate: pastWeekEnd,
        has_plan: true, has_retro: false, retro_id: null,
        properties: { owner_id: 'user-1' },
      }],
      currentSprintNumber: 11,
    });

    const result = await detectMissingRituals(makeState());
    const retroFinding = result.findings!.find(
      f => f.details && (f.details as Record<string, unknown>).ritual_type === 'weekly_retro'
    );
    expect(retroFinding).toBeDefined();
    expect(retroFinding!.severity).toBe('high');
    expect(retroFinding!.finding_type).toBe('missing_ritual');
  });

  it('does not flag weeks with existing rituals', async () => {
    const pastWeekEnd = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
    const pastWeekStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

    mockGetWeeks.mockResolvedValueOnce({
      weeks: [{
        id: 'w10', number: 10, title: 'Week 10',
        startDate: pastWeekStart, endDate: pastWeekEnd,
        has_plan: true, has_retro: true, retro_id: 'r1',
        properties: {},
      }],
      currentSprintNumber: 11,
    });

    const result = await detectMissingRituals(makeState());
    expect(result.findings).toEqual([]);
  });

  it('calls the weeks API', async () => {
    mockGetWeeks.mockResolvedValueOnce({ weeks: [], currentSprintNumber: 11 });
    await detectMissingRituals(makeState());
    expect(mockGetWeeks).toHaveBeenCalledTimes(1);
  });
});
