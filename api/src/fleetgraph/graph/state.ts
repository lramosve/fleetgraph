import { Annotation } from '@langchain/langgraph';

export const FleetGraphState = Annotation.Root({
  // Mode
  mode: Annotation<'proactive' | 'on_demand'>({ reducer: (_, b) => b, default: () => 'proactive' }),

  // Workspace context
  workspaceId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),

  // Fetched data
  activityFeed: Annotation<Array<{ id: string; document_id: string; action: string; changed_at: string }>>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  hasChanges: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  issues: Annotation<Array<{ id: string; title: string; state: string; assignee_id: string | null; updated_at: string; properties: Record<string, unknown> }>>({
    reducer: (_, b) => b,
    default: () => [],
  }),

  // Stale issue detection
  staleIssues: Annotation<Array<{ id: string; title: string; daysSinceUpdate: number; assignee_id: string | null }>>({
    reducer: (_, b) => b,
    default: () => [],
  }),

  // Findings
  findings: Annotation<Array<{
    finding_type: string;
    severity: string;
    document_id: string;
    document_type: string;
    summary: string;
    details: Record<string, unknown>;
    proposed_action: string;
  }>>({
    reducer: (_, b) => b,
    default: () => [],
  }),

  // On-demand chat
  userMessage: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  userId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  documentId: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  documentType: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  contextData: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  response: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
});

export type FleetGraphStateType = typeof FleetGraphState.State;
