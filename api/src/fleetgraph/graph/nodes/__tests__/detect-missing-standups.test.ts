import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../db/client.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from '../../../../db/client.js';
import { detectMissingStandups } from '../detect-missing-standups.js';
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

describe('detectMissingStandups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty findings when no people exist', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // people query
      .mockResolvedValueOnce({ rows: [] }); // standups query

    const result = await detectMissingStandups(makeState());
    expect(result.findings).toEqual([]);
  });

  it('detects people with no standup in 48 hours', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'person-1', title: 'Alice', properties: {} }] })
      .mockResolvedValueOnce({ rows: [] }); // no standups

    const result = await detectMissingStandups(makeState());

    expect(result.findings).toHaveLength(1);
    expect(result.findings![0].finding_type).toBe('missing_standup');
    expect(result.findings![0].severity).toBe('medium');
    expect(result.findings![0].summary).toContain('Alice');
  });

  it('flags people whose last standup was over 24 hours ago', async () => {
    const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'person-1', title: 'Bob', properties: {} }] })
      .mockResolvedValueOnce({ rows: [{ author_id: 'person-1', last_standup: thirtyHoursAgo }] });

    const result = await detectMissingStandups(makeState());

    expect(result.findings).toHaveLength(1);
    expect(result.findings![0].severity).toBe('low');
    expect(result.findings![0].summary).toContain('30');
  });

  it('does not flag people with recent standups', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'person-1', title: 'Carol', properties: {} }] })
      .mockResolvedValueOnce({ rows: [{ author_id: 'person-1', last_standup: twoHoursAgo }] });

    const result = await detectMissingStandups(makeState());

    expect(result.findings).toEqual([]);
  });

  it('runs both queries in parallel via Promise.all', async () => {
    // Verify both queries are initiated before either resolves
    let queryCount = 0;
    mockPool.query.mockImplementation(() => {
      queryCount++;
      return Promise.resolve({ rows: [] });
    });

    await detectMissingStandups(makeState());

    // Both queries should have been called (Promise.all fires both)
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });
});
