import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../ship-client.js', () => ({
  getPeople: vi.fn(),
  getStandups: vi.fn(),
}));

import { getPeople, getStandups } from '../../../ship-client.js';
import { detectMissingStandups } from '../detect-missing-standups.js';
import type { FleetGraphStateType } from '../../state.js';

const mockGetPeople = getPeople as ReturnType<typeof vi.fn>;
const mockGetStandups = getStandups as ReturnType<typeof vi.fn>;

function makeState(overrides: Partial<FleetGraphStateType> = {}): FleetGraphStateType {
  return {
    mode: 'proactive', workspaceId: 'ws-1', activityFeed: [], hasChanges: true,
    issues: [], staleIssues: [], findings: [], userMessage: '', userId: '',
    documentId: null, documentType: null, documentContext: '', workspaceStats: '',
    pendingFindingsContext: '', contextData: '', response: '', ...overrides,
  };
}

describe('detectMissingStandups', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns empty findings when no people exist', async () => {
    mockGetPeople.mockResolvedValueOnce([]);
    mockGetStandups.mockResolvedValueOnce([]);
    const result = await detectMissingStandups(makeState());
    expect(result.findings).toEqual([]);
  });

  it('detects people with no standup in 48 hours', async () => {
    mockGetPeople.mockResolvedValueOnce([{ id: 'person-1', user_id: 'user-1', name: 'Alice', email: 'alice@test.com' }]);
    mockGetStandups.mockResolvedValueOnce([]);
    const result = await detectMissingStandups(makeState());
    expect(result.findings).toHaveLength(1);
    expect(result.findings![0].finding_type).toBe('missing_standup');
    expect(result.findings![0].severity).toBe('medium');
    expect(result.findings![0].summary).toContain('Alice');
  });

  it('flags people whose last standup was over 24 hours ago', async () => {
    const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    mockGetPeople.mockResolvedValueOnce([{ id: 'person-1', user_id: 'user-1', name: 'Bob', email: 'bob@test.com' }]);
    mockGetStandups.mockResolvedValueOnce([{ id: 's1', properties: { author_id: 'person-1' }, created_at: thirtyHoursAgo }]);
    const result = await detectMissingStandups(makeState());
    expect(result.findings).toHaveLength(1);
    expect(result.findings![0].severity).toBe('low');
    expect(result.findings![0].summary).toContain('30');
  });

  it('does not flag people with recent standups', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mockGetPeople.mockResolvedValueOnce([{ id: 'person-1', user_id: 'user-1', name: 'Carol', email: 'carol@test.com' }]);
    mockGetStandups.mockResolvedValueOnce([{ id: 's1', properties: { author_id: 'person-1' }, created_at: twoHoursAgo }]);
    const result = await detectMissingStandups(makeState());
    expect(result.findings).toEqual([]);
  });

  it('calls both API endpoints', async () => {
    mockGetPeople.mockResolvedValueOnce([]);
    mockGetStandups.mockResolvedValueOnce([]);
    await detectMissingStandups(makeState());
    expect(mockGetPeople).toHaveBeenCalledTimes(1);
    expect(mockGetStandups).toHaveBeenCalledTimes(1);
  });
});
