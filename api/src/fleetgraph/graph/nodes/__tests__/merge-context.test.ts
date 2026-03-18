import { describe, it, expect } from 'vitest';
import { mergeContext } from '../merge-context.js';
import type { FleetGraphStateType } from '../../state.js';

function makeState(overrides: Partial<FleetGraphStateType> = {}): FleetGraphStateType {
  return {
    mode: 'on_demand',
    workspaceId: 'ws-1',
    activityFeed: [],
    hasChanges: false,
    issues: [],
    staleIssues: [],
    findings: [],
    userMessage: 'test',
    userId: 'user-1',
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

describe('mergeContext', () => {
  it('combines all three context fields', async () => {
    const result = await mergeContext(makeState({
      documentContext: 'Current document: "My Issue" (issue)',
      workspaceStats: 'Workspace issue stats: 5 in progress, 3 todo, 2 done',
      pendingFindingsContext: 'Pending FleetGraph findings:\n  - [medium] stale_issue: Issue is stale',
    }));

    expect(result.contextData).toContain('My Issue');
    expect(result.contextData).toContain('5 in progress');
    expect(result.contextData).toContain('stale_issue');
  });

  it('filters out empty context fields', async () => {
    const result = await mergeContext(makeState({
      documentContext: '',
      workspaceStats: 'Workspace issue stats: 5 in progress',
      pendingFindingsContext: '',
    }));

    expect(result.contextData).toBe('Workspace issue stats: 5 in progress');
    expect(result.contextData).not.toContain('\n\n\n');
  });

  it('returns empty string when all fields are empty', async () => {
    const result = await mergeContext(makeState());
    expect(result.contextData).toBe('');
  });
});
