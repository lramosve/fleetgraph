# FleetGraph Pre-Search Conversation Reference

*Saved as required by PRESEARCH.md instructions: "Save your AI conversation as a reference document."*

**Date**: 2026-03-16
**Participants**: lramos (developer) + Claude Opus 4.6

---

## Conversation Summary

### 1. Project Setup Decisions

**Repo strategy**: Created `fleetgraph` as a standalone repo (not a GitHub fork) seeded from `lramosve/shipshape`.

- `shipshape` is a fork of `US-Department-of-the-Treasury/ship`
- GitHub does not allow forking your own repo to the same account
- GitHub does not allow retroactively designating a standalone repo as a fork
- Accepted tradeoff: PRs back to upstream would need git remotes, not GitHub fork UI
- Alternative considered: forking from the upstream Treasury repo directly, using a GitHub org, or working on a branch within shipshape

### 2. Ship Codebase Analysis

**Tech stack**: TypeScript monorepo (api/ + web/ + shared/), Express backend, React + Vite frontend, PostgreSQL (Aurora Serverless), TipTap + Yjs for real-time collaborative editing, deployed on AWS (EB/ECS + CloudFront + S3).

**Data model**: "Everything is a Document" pattern. Single `documents` table with `document_type` discriminator. Types: wiki, issue, program, project, sprint (week), weekly_plan, weekly_retro, standup, person. Relationships via `document_associations` table. Properties stored as JSONB.

**Auth**: Session-based (15-min inactivity, 12-hr absolute) + API tokens (`ship_<hex>`) for programmatic access. Two workspace roles only: admin and member. No RBAC.

**Existing AI**: Plan/retro quality analysis via AWS Bedrock, Claude context API, MCP server auto-generating 92+ tools from OpenAPI spec, Claude Code `/prd`, `/work`, `/standup` workflows.

**No webhook/event system exists** - critical for trigger model decision.

**API**: 28 route handlers, OpenAPI 3.0 spec at `/api/openapi.json`, Swagger UI at `/api/docs`.

### 3. Key Architecture Decisions

**LLM Provider**: Claude API (Anthropic SDK) as required by spec. Abstracted behind a provider interface for future OpenAI compatibility (US Government preference).

**Framework**: LangGraph JS (`@langchain/langgraph`) - keeps TypeScript consistency with Ship, provides native LangSmith tracing.

**Trigger model**: Hybrid polling. Fast poll every 3 min (activity endpoint only), selective deep scan when changes detected, slow poll every 30 min for absence-based conditions. No webhooks available in Ship today.

**Authentication for proactive mode**: Dedicated API token for a FleetGraph service account.

**Deployment**: Same-process polling loop for MVP, separate container or Lambda for production.

### 4. Agent Responsibility Scope

**Proactive monitoring**: Stale issues (48h+), missing standups, scope creep, unplanned weeks, overloaded assignees, blocked issues, retro gaps, issue state drift, project health decay.

**On-demand capabilities**: Project health reports, daily priority synthesis, standup draft generation, workload balance analysis, free-form reasoning about current view context.

**Autonomous actions (no confirmation)**: Read data, compute metrics, generate summaries.

**Requires human confirmation**: Any write operation (state changes, reassignments, new documents, notifications).

### 5. Use Cases Defined (8 total, 5 required)

1. Scope creep alert (Week Owner)
2. Stale issue detection (Engineer)
3. Project health report (Project Owner, on-demand)
4. Missing retro/plan detection (Admin)
5. Daily priority synthesis (Any member, on-demand)
6. Standup draft generation (Week Owner, on-demand)
7. Sprint-over-sprint trend analysis (Project Owner)
8. Workload balance analysis (Admin, on-demand)

### 6. Constraints Noted

- Ship REST API is the only data source (no direct DB access)
- AI via Claude API (Anthropic SDK) - with future OpenAI path
- LangGraph recommended; LangSmith tracing required from day one
- Chat interface must be embedded in context (no standalone chatbot)
- Detection latency target: <5 minutes
- One-week sprint with four deadlines (Pre-Search, MVP Tue, Early Fri, Final Sun)
