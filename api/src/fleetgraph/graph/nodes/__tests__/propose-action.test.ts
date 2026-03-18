import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../db/client.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from '../../../../db/client.js';
import { proposeAction } from '../propose-action.js';
import type { FleetGraphStateType } from '../../state.js';
import type { Finding } from '../../state.js';

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };

const baseFinding: Finding = {
  finding_type: 'stale_issue',
  severity: 'medium',
  document_id: 'doc-1',
  document_type: 'issue',
  summary: 'Issue is stale',
  details: {},
  proposed_action: 'Follow up',
};

function makeState(findings: Finding[]): FleetGraphStateType {
  return {
    mode: 'proactive',
    workspaceId: 'ws-1',
    activityFeed: [],
    hasChanges: true,
    issues: [],
    staleIssues: [],
    findings,
    userMessage: '',
    userId: '',
    documentId: null,
    documentType: null,
    documentContext: '',
    workspaceStats: '',
    pendingFindingsContext: '',
    contextData: '',
    response: '',
  };
}

describe('proposeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips duplicate findings within 24 hours', async () => {
    // Duplicate check returns existing finding
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'existing' }] });

    await proposeAction(makeState([baseFinding]));

    // Only the duplicate check query should have been called (no insert)
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('skips suppressed (dismissed) findings', async () => {
    // No duplicate
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // Suppression check returns dismissed finding
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'dismissed' }] });

    await proposeAction(makeState([baseFinding]));

    // Duplicate check + suppression check, no insert
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });

  it('inserts new findings with pending status', async () => {
    // No duplicate
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // No suppression
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // Insert succeeds
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await proposeAction(makeState([baseFinding]));

    expect(mockPool.query).toHaveBeenCalledTimes(3);
    const insertCall = mockPool.query.mock.calls[2];
    expect(insertCall[0]).toContain('INSERT INTO fleetgraph_findings');
    // 'pending' is in the SQL template string, not in the params array
    expect(insertCall[0]).toContain("'pending'");
  });

  it('persists multiple findings in parallel', async () => {
    const findings: Finding[] = [
      { ...baseFinding, document_id: 'doc-1' },
      { ...baseFinding, document_id: 'doc-2' },
    ];

    // Each finding: no duplicate, no suppression, insert
    for (let i = 0; i < 2; i++) {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // dup check
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // suppress check
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // insert
    }

    await proposeAction(makeState(findings));

    // 3 queries per finding × 2 findings = 6
    expect(mockPool.query).toHaveBeenCalledTimes(6);
  });
});
