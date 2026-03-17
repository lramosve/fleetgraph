# PRESEARCH.md

*Completed before writing any code. AI conversation saved as `docs/presearch-conversation.md`.*

The goal of this document is to make informed decisions about FleetGraph's responsibilities and architecture. The thought process matters more than being right on every call.

---

## Phase 1: Define Your Agent

### 1. Agent Responsibility Scoping

**What events in Ship should the agent monitor proactively?**

Ship's data model centers on the weekly cadence: plans are declared, issues are assigned to weeks, standups are logged (or not), and retros capture learnings. The agent should monitor:

- **Stale issues** - Issues in `in_progress` state with no `document_history` updates for >48 hours. This signals a blocked or abandoned task.
- **Missing standups** - Team members assigned to active-week issues who haven't posted a standup by end-of-day. Standups are Ship's primary pulse-check; silence is a signal.
- **Sprint scope creep** - Issues added to an active week after the plan was submitted. Ship tracks scope changes explicitly; the agent should surface the delta and assess impact on the week's hypothesis.
- **Unplanned weeks** - Active weeks with no `weekly_plan` document or an empty plan. A week without a plan is a week without intent.
- **Overloaded assignees** - Users assigned to more `estimate_hours` than their `capacity_hours` (from their person document) in the current week.
- **Blocked issues** - Issues with blocker-related content in standups or comments that haven't been resolved.
- **Retro gaps** - Completed weeks with no retrospective, or retros that don't reference the original plan hypothesis.
- **Issue state drift** - Issues marked `done` without any associated commits/activity, or issues stuck in `todo` for an entire week without transitioning.
- **Project health decay** - Projects where ICE scores have dropped, target dates have passed, or no issues have moved in the last sprint.

**What constitutes a condition worth surfacing?**

A condition is worth surfacing when it represents **information asymmetry** - someone on the team should know about this but probably doesn't because they haven't looked at the right screen at the right time. The threshold is:

1. **Actionable** - The recipient can do something about it right now.
2. **Time-sensitive** - Waiting another polling cycle would make the situation materially worse.
3. **Not obvious** - The condition requires correlating data across multiple documents/entities that a human wouldn't naturally view together.

The agent should stay quiet when:
- The condition is already visible on the user's current screen.
- The issue is <24 hours old (give people a chance to self-correct).
- The same condition was surfaced in the last 24 hours and hasn't changed.

**What is the agent allowed to do without human approval?**

- Read any workspace-visible data via the Ship API.
- Compute derived metrics (velocity, capacity utilization, scope delta).
- Generate summaries, risk assessments, and recommendations.
- Add informational comments to documents (e.g., "FleetGraph noticed this issue has been in progress for 5 days with no standup updates").
- Create draft standup content based on recent issue activity.
- Update issue metadata that is purely informational (e.g., adding a label/tag for "at risk").

**What must always require confirmation?**

- Changing issue state (e.g., moving to `done`, `cancelled`).
- Reassigning issues to a different person.
- Modifying week plans or retros.
- Creating new issues or documents.
- Sending notifications to team members (the first time for a given condition).
- Any action that changes another user's workload.

**How does the agent know who is on a project?**

Ship's data model provides this through `document_associations`:
1. **Program -> Project** associations identify which projects belong to which program.
2. **Project -> Issue** associations identify work items.
3. **Issue -> Assignee** (`properties.assignee_id`) identifies who is working on what.
4. **Week -> Owner** (`properties.owner_id`) identifies who owns each week.
5. **Person documents** (`document_type: 'person'`) with `properties.user_id` map to `users` for profile data.

The agent builds a project roster by traversing: Program -> Projects -> Issues -> Assignees, and Program -> Weeks -> Owners.

**How does the agent know who to notify?**

Notification routing follows role inference:
- **Week owners** get notified about issues in their week (scope changes, stale issues, missing standups from their team).
- **Issue assignees** get notified about their own stale or blocked issues.
- **Project owners** (from `properties.owner_id` on project documents) get notified about cross-week trends affecting their project.
- **Workspace admins** get notified about systemic issues (multiple overloaded team members, consistently missing retros).

Since Ship only has `admin`/`member` roles at the workspace level, the agent infers functional roles from ownership and assignment patterns rather than explicit role fields.

**How does the on-demand mode use context from the current view?**

The chat interface receives context about what the user is currently viewing:
- **On an issue page**: The agent receives `document_id`, `document_type: 'issue'`, and fetches the issue's full state, its parent project, its assigned week, the assignee's other work, and recent history. Questions like "Why is this blocked?" trigger reasoning across standup entries and related issues.
- **On a week page**: The agent receives the sprint context and fetches all issues for that week, the plan, scope changes, standup history, and team capacity. Questions like "Are we on track?" trigger velocity analysis and risk assessment.
- **On a project page**: The agent gets project + all associated weeks + all issues across sprints. Questions like "What's the biggest risk?" trigger cross-sprint pattern analysis.
- **On the dashboard**: The agent gets a workspace-wide view and can reason about cross-project resource conflicts, systemic patterns, and organizational health.

The context object passed to the graph includes: `{ userId, workspaceId, documentId, documentType, viewContext }`.

---

### 2. Use Case Discovery (minimum 5)

Pain points were discovered by analyzing Ship's data model and identifying where **information decay** happens - places where the system has the data but no one is connecting the dots.

| # | Role | Trigger | Agent Detects / Produces | Human Decides |
|---|------|---------|--------------------------|---------------|
| 1 | **Week Owner (PM-like)** | Proactive: daily scan of active weeks | **Scope creep alert** - Issues added after plan submission. Agent computes delta between planned vs. current issue set, estimates impact on hypothesis, and surfaces: "3 issues were added to Week 12 after the plan was locked. Estimated +14h of work against 8h remaining capacity." | Whether to defer new issues to next week, adjust the plan, or accept the scope increase. |
| 2 | **Issue Assignee (Engineer)** | Proactive: 48h no-activity scan | **Stale issue detection** - Issue has been `in_progress` for 48+ hours with no standup mentions, no comments, no history updates. Agent surfaces: "Issue #47 'Fix auth timeout' has had no activity for 3 days. Last standup mentioning it was Monday." | Whether to update status, log a blocker, request help, or deprioritize. |
| 3 | **Project Owner (PM/Director)** | On-demand: user asks "How is this project doing?" from project page | **Project health report** - Agent correlates across all weeks: velocity trend, hypothesis validation rate, ICE score trajectory, % of issues completed vs. planned per week, recurring blockers. Produces a structured health assessment with risk indicators. | Whether to escalate, adjust scope, reallocate resources, or continue as-is. |
| 4 | **Workspace Admin (Director)** | Proactive: weekly scan (Sunday evening or Monday morning) | **Missing retro / unplanned week detection** - Completed weeks with no retro, or new weeks with no plan. Agent surfaces: "4 team members completed their week without filing a retro. 2 new weeks have no plan." | Whether to follow up with specific people, adjust accountability expectations, or accept the gap. |
| 5 | **Any team member** | On-demand: user asks from week view "What should I focus on today?" | **Daily priority synthesis** - Agent analyzes the user's assigned issues for the current week, cross-references with standup history (what was done yesterday, what was planned), identifies the highest-impact next action considering deadlines, dependencies, and blockers. | Whether to follow the recommendation or reprioritize based on context the agent doesn't have. |
| 6 | **Week Owner** | On-demand: user asks from week view "Draft my standup" | **Standup draft generation** - Agent reviews issue activity since last standup (state changes, comments, history entries), drafts a standup entry with: what was accomplished, what's planned next, and any detected blockers. | Whether to post as-is, edit, or discard. |
| 7 | **Project Owner** | Proactive: triggered when a week associated with the project completes | **Sprint-over-sprint trend analysis** - Agent compares the just-completed week to previous weeks on the same project: velocity delta, scope change frequency, hypothesis validation rate. Surfaces: "Week 12 completed 60% of planned issues vs. 85% in Week 11. Scope increased by 40% mid-week." | Whether to adjust planning approach, escalate capacity issues, or investigate root cause. |
| 8 | **Workspace Admin** | On-demand: from team directory or dashboard | **Workload balance analysis** - Agent computes capacity utilization across all team members for the current week: who is overloaded, who has slack, which projects are under-resourced. | Whether to rebalance assignments, defer work, or bring in additional capacity. |

---

### 3. Trigger Model Decision

**Decision: Hybrid (scheduled polling + event-driven hooks)**

**Primary mechanism: Scheduled polling every 3 minutes.**

Rationale:
- Ship has **no webhook/event system** today. There's no pub/sub, no event queue, no outbound notification mechanism. Building a webhook system into Ship is out of scope for a one-week sprint.
- The Ship REST API is the only data source (per PRD constraints).
- The <5 minute detection latency requirement means polling must happen at least every 5 minutes. A 3-minute interval gives margin for API response time and graph execution.

**Secondary mechanism: On-save hooks (future enhancement).**

If Ship adds a webhook or event system later, the agent can register for document-change events and run the graph reactively instead of on a timer. The graph architecture is identical - only the trigger changes.

**Polling strategy:**

The agent does NOT poll every endpoint every cycle. Instead:

1. **Fast poll (every 3 min)**: Hit the activity endpoint (`GET /api/activity`) to get recent document changes. This is a single API call that returns a feed of recent modifications. If nothing changed, the graph short-circuits and no LLM calls are made.
2. **Selective deep scan**: Only when the activity feed shows changes to active weeks, in-progress issues, or new documents does the graph fetch full details and run reasoning nodes.
3. **Slow poll (every 30 min)**: Full scan for time-based conditions (stale issues, missing standups) that wouldn't show up in the activity feed because the trigger is *absence* of activity.

**Cost at scale:**

| Scale | Fast polls/day | Deep scans/day (est. 20% trigger) | Slow polls/day | API calls/day |
|-------|---------------|-----------------------------------|----------------|---------------|
| 1 project | 480 | 96 | 48 | ~624 |
| 100 projects | 48,000 | 9,600 | 4,800 | ~62,400 |
| 1,000 projects | 480,000 | 96,000 | 48,000 | ~624,000 |

At 1,000 projects, the fast polls are lightweight (single endpoint), but deep scans involve 3-5 API calls each + LLM reasoning. This is where cost optimization matters - the activity-based gating ensures LLM calls only happen when something actually changed.

**What does "too stale" mean?**

- For blockers and stale issues: >5 minutes is acceptable (these are conditions that develop over hours/days).
- For scope changes: <5 minutes is the target (someone adding issues to an active sprint is an immediate signal).
- For missing standups/retros: hourly is sufficient (these are daily/weekly cadence items).

The 3-minute fast poll with activity-gated deep scans balances detection latency against API and LLM cost.

---

## Phase 2: Graph Architecture

### 4. Node Design

**Context Nodes:**

| Node | Purpose | Input | Output |
|------|---------|-------|--------|
| `resolve_trigger` | Determine if this is a proactive run or on-demand invocation | Trigger event (timer/user request) | `{ mode: 'proactive' \| 'on_demand', context }` |
| `resolve_user_context` | (On-demand only) Establish who is asking, what they're looking at, their role | User session + current view | `{ userId, role, documentId, documentType, viewScope }` |
| `resolve_workspace_context` | Load workspace config (sprint start date, members, programs) | workspaceId | `{ workspace, members, programs, activeWeeks }` |

**Fetch Nodes (parallel where possible):**

| Node | Purpose | Parallel Group |
|------|---------|---------------|
| `fetch_activity_feed` | Recent changes across workspace | Group A (proactive fast-poll) |
| `fetch_active_weeks` | All weeks in active status | Group B (deep scan) |
| `fetch_week_issues` | Issues for each active week | Group B (parallel per week) |
| `fetch_standups` | Recent standups for active weeks | Group B (parallel per week) |
| `fetch_team_capacity` | Person documents with capacity data | Group B |
| `fetch_project_details` | Project + ICE scores + associations | Group C (on-demand, project context) |
| `fetch_issue_history` | Full history for a specific issue | Group C (on-demand, issue context) |

Group B nodes run in parallel. Group C nodes run in parallel when on-demand context requires them.

**Reasoning Nodes:**

| Node | Purpose | Conditional Entry |
|------|---------|-------------------|
| `detect_stale_issues` | Identify issues with no recent activity | Always runs in proactive deep scan |
| `detect_scope_creep` | Compare current week issues to plan snapshot | Runs when week issues changed |
| `detect_missing_rituals` | Find missing standups, plans, retros | Runs on slow poll cycle |
| `assess_workload` | Calculate capacity utilization per person | Runs when issue assignments change |
| `synthesize_project_health` | Cross-week trend analysis for a project | On-demand from project view |
| `answer_user_query` | Free-form reasoning about user's question with full context | On-demand only |
| `prioritize_findings` | Rank detected issues by severity and actionability | After any detection node produces findings |

**Conditional Edges:**

```
detect_stale_issues -->
  [findings.length > 0] --> prioritize_findings
  [findings.length == 0] --> END (clean run, no action)

detect_scope_creep -->
  [scope_delta > threshold] --> prioritize_findings
  [scope_delta <= threshold] --> END

prioritize_findings -->
  [severity == 'high'] --> propose_action --> human_gate --> execute_action
  [severity == 'medium'] --> notify_stakeholder
  [severity == 'low'] --> log_finding (silent, no notification)

answer_user_query -->
  [requires_action] --> propose_action --> human_gate --> execute_action
  [informational_only] --> format_response --> END
```

**Action Nodes:**

| Node | Purpose |
|------|---------|
| `propose_action` | Generate a specific proposed action (e.g., "Add comment to issue #47 about staleness") |
| `execute_action` | Execute the approved action via Ship API |
| `notify_stakeholder` | Deliver finding to the relevant person (via in-app mechanism) |
| `format_response` | Format reasoning output for the chat interface |
| `log_finding` | Record finding for trend analysis without notifying anyone |

**Human-in-the-Loop Gate:**

| Node | Purpose |
|------|---------|
| `human_gate` | Pause execution, present proposed action to user, wait for approve/reject/modify |

**Error/Fallback Nodes:**

| Node | Purpose |
|------|---------|
| `handle_api_error` | Catch Ship API failures, retry with backoff, or degrade gracefully |
| `handle_llm_error` | Catch Claude API failures, fall back to rule-based detection |
| `handle_timeout` | Kill long-running graph executions after 30 seconds |

---

### 5. State Management

**State carried across a single graph session:**

```typescript
interface FleetGraphState {
  // Trigger context
  mode: 'proactive' | 'on_demand';
  trigger: { type: 'timer' | 'user_request'; timestamp: string };

  // User context (on-demand only)
  user?: { id: string; name: string; role: 'admin' | 'member' };
  viewContext?: { documentId: string; documentType: string };

  // Workspace context
  workspace: { id: string; sprintStartDate: string };
  members: Person[];
  activeWeeks: Week[];

  // Fetched data
  activityFeed: ActivityEntry[];
  weekIssues: Map<string, Issue[]>;
  standups: Map<string, Standup[]>;
  capacityMap: Map<string, { assigned: number; capacity: number }>;

  // Reasoning outputs
  findings: Finding[];
  proposedActions: Action[];

  // Human-in-the-loop
  pendingApprovals: Action[];
  approvedActions: Action[];
  rejectedActions: Action[];

  // Error state
  errors: GraphError[];
  degradedMode: boolean;
}
```

**State that persists between proactive runs:**

Stored in a lightweight persistence layer (database table or Redis):

- `last_poll_timestamp` - To avoid re-processing already-seen activity.
- `last_deep_scan_timestamp` - To schedule the 30-minute slow poll.
- `surfaced_findings` - Set of `{ findingType, documentId, timestamp }` to avoid re-notifying about the same condition within 24 hours (deduplication).
- `activity_snapshot` - Hash of the last activity feed response to detect "nothing changed" fast.

**Avoiding redundant API calls:**

1. **Activity-gated fetching**: The fast poll hits only the activity endpoint. If the hash matches the previous snapshot, no further API calls are made.
2. **Incremental fetching**: Fetch nodes use `updated_after` query parameters where Ship's API supports them, pulling only changed data.
3. **Response caching**: Fetch results are cached for the duration of a single graph run (no cross-run caching to avoid stale data).
4. **Parallel fetching**: Group B fetch nodes run concurrently to minimize wall-clock time.

---

### 6. Human-in-the-Loop Design

**Which actions require confirmation?**

All write operations:
- Adding comments to documents
- Changing issue state
- Reassigning issues
- Creating new documents (standup drafts, issue suggestions)
- Sending notifications to other users

Read-only operations and informational responses never require confirmation.

**What does the confirmation experience look like in Ship?**

In on-demand mode (chat interface):
- The agent presents its proposed action in the chat panel: "I'd like to add a comment to Issue #47 noting it's been stale for 3 days. [Approve] [Edit] [Dismiss]"
- The user clicks Approve to execute, Edit to modify the proposed text, or Dismiss to cancel.

In proactive mode:
- The agent creates an "insight card" in the Ship dashboard or as a notification badge on the relevant document.
- The insight card contains: what was detected, why it matters, and a proposed action with Approve/Dismiss buttons.
- If the Ship UI doesn't support custom notification components yet, the agent falls back to creating a comment on the relevant document with the finding and proposed action.

**What happens if the human dismisses or snoozes?**

- **Dismiss**: The finding is recorded as dismissed in `surfaced_findings` with a 7-day suppression window. The agent won't re-surface the same finding for the same document for 7 days unless the condition significantly worsens.
- **Snooze** (if implemented): The finding is re-queued for a user-specified delay (1h, 4h, tomorrow). After the delay, the agent re-evaluates the condition and surfaces it again only if it's still present.
- **No response within 24h**: The finding expires silently. The agent treats absence of response as implicit dismissal for that specific instance.

---

### 7. Error and Failure Handling

**What does the agent do when Ship API is down?**

1. **Detection**: The `handle_api_error` node catches HTTP 5xx responses or connection timeouts.
2. **Retry**: Exponential backoff with 3 retries (1s, 4s, 16s).
3. **Degrade**: If all retries fail, the graph sets `degradedMode: true` and:
   - Proactive mode: Logs the failure, skips this polling cycle, and tries again on the next cycle. No findings are surfaced (can't trust partial data).
   - On-demand mode: Returns a message to the user: "I can't reach the Ship API right now. I'll try again shortly."
4. **Alert**: If 3 consecutive polling cycles fail, the agent logs a system alert for the workspace admin.

**How does it degrade gracefully?**

- If only some fetch nodes fail, the agent runs reasoning only on the data it has and marks findings as "partial confidence" in the output.
- If the Claude API fails, the agent falls back to rule-based detection (no LLM reasoning, just threshold checks like "issue stale > 48h"). This produces less nuanced findings but maintains basic monitoring.
- Cached `workspace_context` from the last successful run is used for member/program data if those endpoints fail.

**What gets cached and for how long?**

| Data | Cache Duration | Reason |
|------|---------------|--------|
| Workspace config (members, programs) | 30 minutes | Changes infrequently |
| Person documents (capacity) | 30 minutes | Changes infrequently |
| Active weeks list | 5 minutes | Changes when weeks transition |
| Issue details | Not cached cross-run | Must be fresh for accurate detection |
| Activity feed | Not cached | This IS the freshness check |
| LLM reasoning outputs | Not cached | Context-dependent, not reusable |

---

## Phase 3: Stack and Deployment

### 8. Deployment Model

**Where does the proactive agent run when no user is present?**

The agent runs **inside the Ship API process** on Railway. FleetGraph is not a separate service — it starts as part of the Express server boot sequence via `startFleetGraph()` in `index.ts`. The polling scheduler uses `setInterval` for proactive scans.

**Deployment platform: Railway**

Ship is deployed to Railway as a Docker container: https://fleetgraph-production-614c.up.railway.app/

- **Dockerfile**: Uses `node:20-slim`, installs production deps via pnpm, copies pre-built `dist/` directories, runs migrations on startup.
- **Database**: Railway-managed PostgreSQL (internal networking via `postgres.railway.internal`).
- **Environment variables**: Set directly in Railway's service configuration (no AWS SSM — SSM loading is skipped when `RAILWAY_ENVIRONMENT` is detected).
- **FleetGraph env vars**: `FLEETGRAPH_ENABLED=true`, `ANTHROPIC_API_KEY`, `LANGCHAIN_TRACING_V2=true`, `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT=fleetgraph`.

**How is it kept alive?**

- In development: `tsx watch` restarts on crash.
- In production: Railway automatically restarts failed containers. The `/health` endpoint confirms the server and polling loop are running.
- Graceful shutdown: The process catches `SIGTERM`, stops the polling scheduler, and exits cleanly.

**How does it authenticate with Ship without a user session?**

The proactive agent runs **in-process** with the Ship API — it queries PostgreSQL directly using the shared `pool` from `db/client.ts`. No HTTP API calls or authentication tokens are needed for proactive scans.

For on-demand mode, the user's existing session cookie authenticates their chat requests through the standard `authMiddleware`.

---

### 9. Performance

**How does your trigger model achieve the <5 minute detection latency goal?**

- Fast poll every 3 minutes means worst-case detection latency is 3 minutes (event happens just after a poll) + graph execution time.
- Graph execution budget: 30 seconds max (enforced by timeout node).
- Total worst-case: ~3.5 minutes, well within the 5-minute requirement.
- Best case (event happens just before a poll): ~30 seconds.
- Average: ~1.75 minutes.

**What is your token budget per invocation?**

| Invocation Type | Input Tokens (est.) | Output Tokens (est.) | Cost (Claude Sonnet) |
|----------------|--------------------|--------------------|---------------------|
| Proactive fast poll (no findings) | 0 (no LLM call) | 0 | $0.00 |
| Proactive deep scan (with findings) | ~4,000 | ~800 | ~$0.016 |
| On-demand simple query | ~6,000 | ~1,200 | ~$0.026 |
| On-demand complex analysis | ~12,000 | ~2,500 | ~$0.055 |

Using Claude API (Anthropic SDK) as required by the spec. Starting with Claude 3.5 Sonnet for cost efficiency; can upgrade to Opus for complex reasoning if needed.

**Note on LLM provider strategy**: The spec requires Claude API (Anthropic SDK) integration. Since Ship is a US Government application and may prefer OpenAI in a later stage, the LLM integration layer will be abstracted behind a provider interface. This allows swapping Claude for OpenAI (or running both) without changing the graph architecture. The Anthropic SDK is the day-one implementation; an OpenAI adapter can be added later.

**Where are the cost cliffs in your architecture?**

1. **Many active projects with high churn**: If every 3-minute poll triggers a deep scan (high activity workspace), LLM costs scale linearly with activity volume. Mitigation: batch findings across projects into fewer LLM calls.
2. **On-demand abuse**: A user repeatedly asking complex questions could generate significant token usage. Mitigation: rate limiting (aligned with Ship's existing 10 req/hr AI rate limit).
3. **Large workspaces**: Fetching all issues for all active weeks in a 50-person workspace could produce large context windows. Mitigation: summarize issue lists before passing to LLM, only send full details for flagged items.

---

## Architecture Constraint Notes

### LLM Provider Strategy

**Day 1: Claude API (Anthropic SDK)** - Required by the PRD. The FleetGraph reasoning nodes will call the Anthropic SDK directly. LangGraph nodes will wrap Anthropic SDK calls with LangSmith tracing instrumentation.

**Future: OpenAI compatibility** - Ship is a US Government application (US Department of the Treasury). The government client may prefer OpenAI. The LLM integration will be abstracted behind a simple interface:

```typescript
interface LLMProvider {
  reason(prompt: string, context: object): Promise<ReasoningOutput>;
  classify(input: string, categories: string[]): Promise<string>;
}
```

Day 1 implements `AnthropicProvider`. A future `OpenAIProvider` can be added without touching graph logic.

### Framework Choice

**LangGraph (Python) vs. Custom TypeScript Graph**

Ship is 100% TypeScript. LangGraph is Python-native. Options:

1. **LangGraph JS** - LangGraph has a JS/TS SDK (`@langchain/langgraph`). This keeps the stack unified and provides native LangSmith tracing. **This is the recommended path.**
2. **LangGraph Python** - Would require a separate Python service. Adds operational complexity but gives access to the more mature LangGraph ecosystem.
3. **Custom TS graph** - Maximum control, zero dependency, but requires manual LangSmith instrumentation.

**Decision: LangGraph JS (`@langchain/langgraph`)** with the Anthropic SDK as the LLM provider. This gives us:
- Native LangSmith tracing (required by spec)
- TypeScript consistency with Ship
- Conditional edges, parallel nodes, and state management out of the box
- The Anthropic SDK for LLM calls (via `@langchain/anthropic` or direct Anthropic SDK)
