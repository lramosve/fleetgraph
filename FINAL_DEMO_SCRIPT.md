# FleetGraph Final Submission Demo Script (5 min)

**Focus:** What changed since MVP — parallel execution, new detections, production hardening.

**URL:** https://fleetgraph-production-614c.up.railway.app/
**Credentials:** dev@ship.local / admin123

---

## 0:00–0:30 — Recap + What Changed

> "This is FleetGraph, a project intelligence agent for Ship. In the MVP, I showed proactive stale issue detection and on-demand chat. The reviewer flagged that both graphs were entirely sequential — no parallel execution at any level. Since then, I've made significant improvements."
>
> "Here's what changed: parallel graph topology in both graphs, three new detection types, an LLM provider abstraction, retry and timeout logic, full test coverage, and updated LangSmith traces proving parallel execution."

---

## 0:30–1:30 — Parallel Proactive Graph (4-way fan-out)

**Action:** Open the proactive LangSmith trace: https://smith.langchain.com/public/9a017d99-81fa-42d6-8309-3b2804f38f21/r

> "Let me show the biggest change. The proactive graph now fans out to four detection nodes running in parallel after fetch_activity detects changes."
>
> "You can see it right here in the LangSmith trace: detect_stale_issues, detect_missing_standups, detect_scope_creep, and detect_missing_rituals all start at the exact same millisecond — 45.982, 45.984, 45.984, 45.985. That's true parallel execution via LangGraph's conditional edge array return."
>
> "All four write to a shared findings array using a merge reducer, then propose_action fans in and waits for all of them to complete before persisting findings to the database."

**Action:** Point to the timing in the trace.

> "The stale issue detection takes about 3.5 seconds because it calls Claude for classification, while the other three are pure database queries finishing in under 30 milliseconds. The whole graph completes in under 4 seconds thanks to parallelism."

---

## 1:30–2:15 — Parallel On-Demand Graph (3-way fan-out)

**Action:** Open the on-demand LangSmith trace: https://smith.langchain.com/public/24b2bb4e-9409-4379-8601-c8e32b057f7c/r

> "The on-demand graph also got parallelized. Instead of one sequential fetch_context node making four back-to-back database queries, I split it into three parallel nodes: fetch_document, fetch_workspace_stats, and fetch_pending_findings."
>
> "In the trace you can see all three start concurrently, then merge_context combines their outputs before passing to the LLM. fetch_document also uses Promise.all internally to fetch the document and its history simultaneously."

---

## 2:15–3:15 — New Detection Types in Action

**Action:** Open the app, log in, click FleetGraph icon, go to Findings tab.

> "The MVP only detected stale issues. Now FleetGraph detects four types of problems."

**Action:** Point to findings with different types.

> "Stale issues — in-progress issues with no activity for 48+ hours, classified by Claude with a rule-based fallback. Missing standups — team members who haven't posted in 24+ hours. Scope creep — issues added to the current week after the plan was submitted. And missing rituals — weeks that ended without a retrospective or started without a plan."
>
> "Each detection node runs independently in parallel, has its own try-catch error handling so one failure doesn't crash the others, and writes to the shared findings array via LangGraph's merge reducer."

---

## 3:15–4:00 — Production Hardening

> "Three more things I added for production readiness."
>
> "First, the LLM is abstracted behind a provider interface. getLLM returns a BaseChatModel. Today it's Anthropic, but switching to OpenAI is just setting an environment variable — no graph code changes. This matters because Ship is a government app that may need provider flexibility."
>
> "Second, retry logic. The Anthropic SDK is configured with maxRetries: 3 with exponential backoff. If Claude has a transient error, FleetGraph retries automatically."
>
> "Third, every graph invocation has a 30-second timeout via AbortSignal. If a graph run hangs — maybe a slow LLM response or a database issue — it gets killed cleanly instead of blocking the polling loop. Timeout errors are logged separately for easy debugging."

---

## 4:00–4:30 — Test Coverage

> "The MVP had zero tests. Now there are 27 unit tests across 6 test files, all using mocked database and LLM — no running database required."
>
> "Key tests include: LLM fallback when Claude returns invalid JSON, deduplication logic in propose_action, severity classification, parallel query verification, and edge cases like empty workspaces and missing sprint data."

---

## 4:30–5:00 — Summary

> "To recap what changed since MVP: both graphs now use parallel fan-out — four detection nodes in the proactive graph, three context-fetch nodes in the on-demand graph. I added scope creep, missing standups, and missing rituals detection. The LLM is abstracted for provider flexibility, with retry and timeout logic. And there are 27 unit tests covering all detection nodes."
>
> "Everything is deployed on Railway, traced in LangSmith, and the traces I showed prove the parallel execution the reviewer asked for. Thanks."

---

## Pre-Demo Checklist

- [ ] Open production URL: https://fleetgraph-production-614c.up.railway.app/
- [ ] Open proactive trace (parallel detection): https://smith.langchain.com/public/9a017d99-81fa-42d6-8309-3b2804f38f21/r
- [ ] Open on-demand trace (parallel context): https://smith.langchain.com/public/24b2bb4e-9409-4379-8601-c8e32b057f7c/r
- [ ] Verify findings exist (check Findings tab has entries)
- [ ] Have FLEETGRAPH.md open for reference if needed
- [ ] Start recording
