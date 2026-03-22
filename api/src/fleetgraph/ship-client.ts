/**
 * Ship REST API client for FleetGraph.
 *
 * All Ship data access goes through this client, not direct DB queries.
 * Uses the local API with an API token for proactive mode authentication.
 */

const BASE_URL = process.env.FLEETGRAPH_API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const API_TOKEN = process.env.FLEETGRAPH_API_TOKEN || '';

interface FetchOptions {
  method?: string;
  body?: unknown;
}

async function shipFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(API_TOKEN ? { 'Authorization': `Bearer ${API_TOKEN}` } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (!res.ok) {
    throw new Error(`Ship API ${opts.method || 'GET'} ${path} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// --- Types ---

export interface ShipIssue {
  id: string;
  title: string;
  state: string;
  priority: string;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
  properties: Record<string, unknown>;
}

export interface ShipPerson {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
}

export interface ShipWeek {
  id: string;
  number: number;
  name: string;
  title: string;
  startDate: string;
  endDate: string;
  has_plan: boolean;
  has_retro: boolean;
  retro_id: string | null;
  properties: Record<string, unknown>;
}

export interface ShipDocument {
  id: string;
  title: string;
  document_type: string;
  properties: Record<string, unknown>;
  content: unknown;
  updated_at: string;
  created_at: string;
}

export interface ShipHistoryEntry {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  changed_by: { id: string; name: string } | null;
}

// --- API Methods ---

/** List issues, optionally filtered by state */
export async function getIssues(params?: { state?: string }): Promise<ShipIssue[]> {
  const qs = params?.state ? `?state=${params.state}` : '';
  return shipFetch<ShipIssue[]>(`/api/issues${qs}`);
}

/** Get a single document by ID */
export async function getDocument(id: string): Promise<ShipDocument> {
  return shipFetch<ShipDocument>(`/api/documents/${id}`);
}

/** Get issue history */
export async function getIssueHistory(issueId: string): Promise<ShipHistoryEntry[]> {
  return shipFetch<ShipHistoryEntry[]>(`/api/issues/${issueId}/history`);
}

/** List people in the workspace */
export async function getPeople(): Promise<ShipPerson[]> {
  return shipFetch<ShipPerson[]>(`/api/team/people`);
}

/** Get current workspace info */
export async function getCurrentWorkspace(): Promise<{ id: string; sprintStartDate: string }> {
  const res = await shipFetch<{ success: boolean; data: { workspace: { id: string; sprintStartDate: string } } }>('/api/workspaces/current');
  return res.data.workspace;
}

/** List weeks/sprints */
export async function getWeeks(params?: { fromSprint?: number; toSprint?: number }): Promise<{ weeks: ShipWeek[]; currentSprintNumber: number }> {
  const qs = new URLSearchParams();
  if (params?.fromSprint) qs.set('fromSprint', String(params.fromSprint));
  if (params?.toSprint) qs.set('toSprint', String(params.toSprint));
  const qsStr = qs.toString() ? `?${qs.toString()}` : '';
  return shipFetch<{ weeks: ShipWeek[]; currentSprintNumber: number }>(`/api/weeks${qsStr}`);
}

/** Get issues for a specific sprint */
export async function getWeekIssues(weekId: string): Promise<ShipIssue[]> {
  return shipFetch<ShipIssue[]>(`/api/weeks/${weekId}/issues`);
}

/** Get standups for a date range */
export async function getStandups(dateFrom: string, dateTo: string): Promise<Array<{ id: string; properties: Record<string, unknown>; created_at: string }>> {
  return shipFetch(`/api/standups?date_from=${dateFrom}&date_to=${dateTo}`);
}

/** Get a week's plan document */
export async function getWeekPlan(weekId: string): Promise<{ id: string; content: unknown; updated_at: string; created_at: string } | null> {
  try {
    return await shipFetch(`/api/weeks/${weekId}/plan`);
  } catch {
    return null; // No plan exists
  }
}

/** Add a comment to a document */
export async function addComment(documentId: string, content: string): Promise<void> {
  await shipFetch(`/api/documents/${documentId}/comments`, {
    method: 'POST',
    body: {
      comment_id: crypto.randomUUID(),
      content,
    },
  });
}

/** Get issue count stats by state (uses issues endpoint with filtering) */
export async function getIssueStats(): Promise<{ in_progress: number; todo: number; done: number }> {
  const [inProgress, todo, done] = await Promise.all([
    getIssues({ state: 'in_progress' }),
    getIssues({ state: 'todo' }),
    getIssues({ state: 'done' }),
  ]);
  return {
    in_progress: inProgress.length,
    todo: todo.length,
    done: done.length,
  };
}
