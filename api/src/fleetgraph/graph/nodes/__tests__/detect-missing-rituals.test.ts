import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../db/client.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from '../../../../db/client.js';
import { detectMissingRituals } from '../detect-missing-rituals.js';
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

describe('detectMissingRituals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty findings when workspace has no sprint_start_date', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await detectMissingRituals(makeState());
    expect(result.findings).toEqual([]);
  });

  it('returns empty findings when no weeks exist', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ sprint_start_date: '2026-01-05' }] })
      // Promise.all: weeks + rituals
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await detectMissingRituals(makeState());
    expect(result.findings).toEqual([]);
  });

  it('detects past weeks without retros as high severity', async () => {
    // Sprint start = Jan 5, current = Mar 18. Sprint 11 = Mar 16-22.
    // Sprint 10 = Mar 9-15 (past week, should have retro)
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ sprint_start_date: '2026-01-05' }] })
      // Promise.all: weeks + rituals
      .mockResolvedValueOnce({
        rows: [{
          id: 'week-10',
          title: 'Week 10',
          sprint_number: '10',
          owner_id: 'user-1',
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // no rituals at all

    const result = await detectMissingRituals(makeState());

    const retroFinding = result.findings!.find(
      f => f.details && (f.details as Record<string, unknown>).ritual_type === 'weekly_retro'
    );
    expect(retroFinding).toBeDefined();
    expect(retroFinding!.severity).toBe('high');
    expect(retroFinding!.finding_type).toBe('missing_ritual');
  });

  it('does not flag weeks with existing rituals that have content', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ sprint_start_date: '2026-01-05' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'week-10',
          title: 'Week 10',
          sprint_number: '10',
          owner_id: 'user-1',
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            parent_id: 'week-10',
            document_type: 'weekly_plan',
            content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'This is a real plan with substantial content for the week ahead' }] }] },
          },
          {
            parent_id: 'week-10',
            document_type: 'weekly_retro',
            content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'This is a real retro with substantial content reflecting on the week' }] }] },
          },
        ],
      });

    const result = await detectMissingRituals(makeState());
    expect(result.findings).toEqual([]);
  });

  it('runs weeks and rituals queries in parallel', async () => {
    let queryCount = 0;
    mockPool.query.mockImplementation(() => {
      queryCount++;
      return Promise.resolve({ rows: queryCount === 1 ? [{ sprint_start_date: '2026-01-05' }] : [] });
    });

    await detectMissingRituals(makeState());

    // 1 workspace query + 2 parallel queries (weeks + rituals) = 3
    expect(mockPool.query).toHaveBeenCalledTimes(3);
  });
});
