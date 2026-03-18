# FLEETGRAPH.md

## Agent Responsibility

FleetGraph is a **project intelligence agent** for Ship that monitors project state, reasons about what it finds, and surfaces actionable insights. It operates in two modes:

**Proactive Mode** - Runs on a schedule (3-min fast poll, 30-min slow poll), detects problems (stale issues, scope creep, missing standups), and surfaces findings with proposed actions. Findings require human approval before any write action is taken.

**On-Demand Mode** - User invokes from the Ship UI via a context-aware chat panel. FleetGraph fetches relevant workspace/document data and answers questions about project health, risks, priorities, and status.

**What the agent can do without approval:**
- Read any workspace-visible data
- Compute derived metrics (velocity, capacity utilization, scope delta)
- Generate summaries, risk assessments, and recommendations

**What requires human approval (human-in-the-loop gate):**
- Adding comments to documents
- Changing issue state or assignments
- Creating new documents
- Any action that modifies another user's workload

---

## Graph Architecture

### Proactive Graph (Parallel Detection)

```mermaid
graph TD
    START([Start]) --> fetch_activity
    fetch_activity{Has Changes?}
    fetch_activity -->|No changes| END_CLEAN([END - Clean Run])
    fetch_activity -->|Changes detected| detect_stale_issues
    fetch_activity -->|Changes detected| detect_missing_standups
    fetch_activity -->|Changes detected| detect_scope_creep
    fetch_activity -->|Changes detected| detect_missing_rituals
    detect_stale_issues --> propose_action
    detect_missing_standups --> propose_action
    detect_scope_creep --> propose_action
    detect_missing_rituals --> propose_action
    propose_action --> END_SAVED([END - Findings Saved])

    style detect_stale_issues fill:#e1f5fe
    style detect_missing_standups fill:#e1f5fe
    style detect_scope_creep fill:#e1f5fe
    style detect_missing_rituals fill:#e1f5fe
```

**Parallel fan-out:** After `fetch_activity` detects changes, four detection nodes run **concurrently**:
- `detect_stale_issues` — In-progress issues with no activity for 48+ hours (LLM classification)
- `detect_missing_standups` — Team members without recent standup posts
- `detect_scope_creep` — Issues added to the current week after plan submission
- `detect_missing_rituals` — Weeks without plans or retrospectives

All four write to the shared `findings` array via a merge reducer. `propose_action` waits for all to complete (fan-in), then persists findings with deduplication.

**Path A** - Findings detected: `fetch_activity → [detect_stale_issues ‖ detect_missing_standups ‖ detect_scope_creep ‖ detect_missing_rituals] → propose_action → END`
**Path C** - Clean run (no changes): `fetch_activity → END`

### On-Demand Graph (Parallel Context Fetching)

```mermaid
graph TD
    START([Start]) --> fetch_document
    START --> fetch_workspace_stats
    START --> fetch_pending_findings
    fetch_document --> merge_context
    fetch_workspace_stats --> merge_context
    fetch_pending_findings --> merge_context
    merge_context --> answer_query
    answer_query --> format_response
    format_response --> END([END])

    style fetch_document fill:#e1f5fe
    style fetch_workspace_stats fill:#e1f5fe
    style fetch_pending_findings fill:#e1f5fe
```

**Parallel fan-out:** Three context-fetch nodes run **concurrently** from start:
- `fetch_document` — Loads the current document + history (uses `Promise.all` internally)
- `fetch_workspace_stats` — Workspace-level issue counts
- `fetch_pending_findings` — Active FleetGraph findings

`merge_context` combines their outputs, then the LLM answers the user's question.

**Path B** - On-demand: `[fetch_document ‖ fetch_workspace_stats ‖ fetch_pending_findings] → merge_context → answer_query → format_response → END`

### Human-in-the-Loop Gate

Findings from the proactive graph are persisted to the `fleetgraph_findings` table with `status: 'pending'`. Users interact with findings via:

1. **Findings tab** in the FleetGraph chat panel - shows pending findings with Approve/Dismiss buttons
2. **REST API** - `POST /api/fleetgraph/findings/:id/approve` or `/dismiss`

When approved, the `execute_action` function runs the proposed action (e.g., adding a comment to a stale issue). Dismissed findings are suppressed for 7 days.

---

## Use Cases

| # | Role | Trigger | Agent Detects / Produces | Human Decides |
|---|------|---------|--------------------------|---------------|
| 1 | Week Owner | Proactive: daily scan | **Scope creep alert** - Issues added after plan submission. Estimates impact on capacity. | Defer new issues or accept scope increase |
| 2 | Issue Assignee | Proactive: 48h scan | **Stale issue detection** - In-progress issues with no activity for 48+ hours. | Update status, log blocker, or deprioritize |
| 3 | Project Owner | On-demand | **Project health report** - Velocity trends, hypothesis validation, ICE trajectories, recurring blockers. | Escalate, adjust scope, or continue |
| 4 | Workspace Admin | Proactive: weekly | **Missing rituals** - Completed weeks with no retro, new weeks with no plan. | Follow up with team members |
| 5 | Any Member | On-demand | **Daily priority synthesis** - Highest-impact next actions considering deadlines and dependencies. | Follow recommendation or reprioritize |
| 6 | Week Owner | On-demand | **Standup draft** - Reviews issue activity since last standup, drafts entry. | Post as-is, edit, or discard |
| 7 | Project Owner | Proactive | **Sprint-over-sprint trends** - Velocity delta, scope change frequency across weeks. | Adjust planning approach |
| 8 | Workspace Admin | On-demand | **Workload balance** - Capacity utilization across team members, over/under-allocation. | Rebalance assignments |

---

## Trigger Model

**Hybrid Polling** (no webhook system exists in Ship):

| Poll Type | Interval | What it Does | LLM Cost |
|-----------|----------|-------------|----------|
| Fast poll | 3 min | Hit activity feed, check for changes via hash. If no changes, short-circuit. | $0 (no LLM call) |
| Deep scan | On change | Fetch full issue data, run LLM reasoning to classify findings. | ~$0.016/scan |
| Slow poll | 30 min | Full scan for absence-based conditions (missing standups, retros). | ~$0.016/scan |

**Why polling over webhooks:** Ship has no pub/sub or event system. Building one is out of scope. The 3-min fast poll with activity-hash gating achieves <5 minute detection latency while minimizing unnecessary LLM calls.

**Cost at scale:** At 1 workspace, ~$1-2/day. At 100 workspaces, ~$50-100/day. The activity-hash check ensures LLM calls only happen when data actually changed.

---

## Technology Stack

| Component | Technology | Reason |
|-----------|-----------|--------|
| LLM | Claude Sonnet 4 via `@langchain/anthropic` | Required by spec; auto-traced by LangSmith |
| Framework | LangGraph JS (`@langchain/langgraph`) | TypeScript consistency, native LangSmith tracing, conditional edges |
| Observability | LangSmith | Required from day one; automatic tracing via LangChain |
| Database | PostgreSQL (Ship's existing `pg` pool) | Direct DB access for agent queries, no ORM |
| Frontend | React + TanStack Query | Consistent with Ship's existing patterns |

---

## Database Schema

Three new tables (migration 039):

- **`fleetgraph_findings`** - Proactive detection results with severity, proposed action, and approval status
- **`fleetgraph_poll_state`** - Per-workspace polling timestamps and activity hash for change detection
- **`fleetgraph_chat_messages`** - On-demand conversation history

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/fleetgraph/chat` | On-demand chat with document context |
| GET | `/api/fleetgraph/findings` | List findings (filterable by status) |
| POST | `/api/fleetgraph/findings/:id/approve` | Approve finding's proposed action |
| POST | `/api/fleetgraph/findings/:id/dismiss` | Dismiss finding (7-day suppression) |
| GET | `/api/fleetgraph/status` | Agent health: enabled, last poll, pending count |

---

## LangSmith Trace Links

- **Trace 1 (Path A - Proactive, 4-way parallel detection fan-out):** https://smith.langchain.com/public/9a017d99-81fa-42d6-8309-3b2804f38f21/r
  - Shows: `fetch_activity → [detect_stale_issues ‖ detect_missing_standups ‖ detect_scope_creep ‖ detect_missing_rituals] → propose_action`
  - All 4 detection nodes start within 3ms of each other
- **Trace 2 (Path B - On-demand, 3-way parallel context fetch):** https://smith.langchain.com/public/24b2bb4e-9409-4379-8601-c8e32b057f7c/r
  - Shows: `[fetch_document ‖ fetch_workspace_stats ‖ fetch_pending_findings] → merge_context → answer_query → format_response`

LangSmith project dashboard: https://smith.langchain.com/o/9ec225d0-ceaf-4bba-a026-02438fa14772/projects/p/2763fbc4-bba2-47b1-8d6f-05a8f956d446

---

## Architecture Decisions

See [PRESEARCH.md](./PRESEARCH.md) for detailed rationale on:
- LLM provider choice (Claude API / Anthropic SDK)
- Framework choice (LangGraph JS)
- Trigger model (hybrid polling)
- Human-in-the-loop design
- Error handling strategy

---

## Test Cases

### Unit Tests

| Test | Node | Validates |
|------|------|-----------|
| Stale detection with LLM fallback | `detect-stale-issues` | Falls back to rule-based classification when LLM returns invalid JSON |
| Stale detection skips fresh issues | `detect-stale-issues` | Issues updated <48h ago produce no findings |
| Missing standups detects absence | `detect-missing-standups` | People without standups in 48h generate findings |
| Scope creep counts post-plan issues | `detect-scope-creep` | Issues created after plan submission are flagged |
| Missing rituals checks past weeks | `detect-missing-rituals` | Past weeks without retros generate high-severity findings |
| Propose action deduplicates | `propose-action` | Duplicate findings within 24h are not re-inserted |
| Propose action respects suppression | `propose-action` | Dismissed findings within suppression window are skipped |
| Merge context combines outputs | `merge-context` | Empty fields are filtered, non-empty fields joined |

### Integration Tests

| Test | Graph | Validates |
|------|-------|-----------|
| Proactive: no changes → early exit | Proactive | `hasChanges=false` short-circuits to END without running detection |
| Proactive: parallel detection fan-out | Proactive | All 4 detection nodes execute, findings merge correctly |
| On-demand: parallel context fetch | On-demand | 3 fetch nodes run, merge, LLM answers with combined context |
| On-demand: no document context | On-demand | Works correctly when `documentId` is null |
| Findings approval flow | REST API | Approve → execute action → status updated |
| Findings dismissal flow | REST API | Dismiss → suppression active for 7 days |

---

## Cost Analysis

| Scenario | Fast Polls/day | Deep Scans/day | LLM Cost/day |
|----------|---------------|---------------|-------------|
| 1 workspace, low activity | 480 | ~10 | ~$0.16 |
| 1 workspace, high activity | 480 | ~96 | ~$1.54 |
| 10 workspaces, mixed | 4,800 | ~200 | ~$3.20 |

Token budget per invocation:
- Proactive deep scan: ~4,000 input + ~800 output tokens
- On-demand query: ~6,000 input + ~1,200 output tokens
