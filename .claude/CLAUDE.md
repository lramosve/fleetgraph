# CLAUDE.md

This file provides guidance to Claude Code when working with the FleetGraph project.

## What is FleetGraph?

FleetGraph is a **project intelligence agent** for Ship (a project management platform forked from US-Department-of-the-Treasury/ship). It monitors project state, reasons about what it finds, and surfaces actionable insights to team members.

**Two modes:**
- **Proactive** - Runs on a schedule, detects problems (stale issues, scope creep, missing standups), and notifies stakeholders without being asked.
- **On-demand** - User invokes from within Ship UI via a context-aware chat interface scoped to what they're viewing (issue, week, project, dashboard).

## Project Structure

This is a monorepo inherited from Ship with FleetGraph additions:

```
api/           # Express backend + Ship API
web/           # React + Vite frontend
shared/        # TypeScript types
docs/          # Architecture documentation
PRESEARCH.md   # Pre-search deliverable (agent design decisions)
FLEETGRAPH.md  # Main deliverable (filled in as we build)
```

## Ship Codebase (inherited)

**Read `docs/*` before making architectural decisions.** Key docs:
- `docs/unified-document-model.md` - Core data model, document types
- `docs/application-architecture.md` - Tech stack, deployment, testing
- `docs/document-model-conventions.md` - Terminology, document vs config
- `docs/presearch-conversation.md` - FleetGraph design conversation reference

### Data Model
- "Everything is a Document" - single `documents` table with `document_type` discriminator
- Types: wiki, issue, program, project, sprint (week), weekly_plan, weekly_retro, standup, person
- Relationships via `document_associations` (parent, project, sprint, program)
- Properties stored as JSONB in `properties` column
- Two workspace roles only: admin, member (no RBAC)

### Auth
- Session cookies (15-min inactivity, 12-hr absolute) for browser users
- API tokens (`ship_<hex>`) for programmatic access - FleetGraph proactive mode uses this
- PIV/password/OAuth providers

### Existing AI
- Plan/retro quality analysis via AWS Bedrock (Claude)
- Claude context API at `/api/claude/context`
- MCP server auto-generating 92+ tools from OpenAPI spec
- Claude Code `/prd`, `/work`, `/standup` workflows

### No webhook/event system exists
Ship has no pub/sub or outbound event mechanism. FleetGraph uses polling against the REST API.

## FleetGraph Architecture Decisions

### LLM Provider: Claude API (Anthropic SDK)
- Required by spec. Ship is a US Government app (Treasury).
- Abstract behind a provider interface for future OpenAI compatibility.
- Day 1: Anthropic SDK. Future: OpenAI adapter without changing graph logic.

### Framework: LangGraph JS (`@langchain/langgraph`)
- Keeps TypeScript consistency with Ship
- Native LangSmith tracing (required by spec)
- Conditional edges, parallel nodes, state management built in

### Trigger Model: Hybrid Polling
- Fast poll every 3 min (activity endpoint only, no LLM call if nothing changed)
- Selective deep scan when changes detected (LLM reasoning runs)
- Slow poll every 30 min for absence-based conditions (missing standups, retros)

### Observability: LangSmith
Required from day one. Environment variables:
```
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=your_key
```

## Commands (inherited from Ship)

```bash
pnpm dev              # Start api + web in parallel (auto-creates DB, finds ports)
pnpm dev:api          # Express server on :3000
pnpm dev:web          # Vite dev server on :5173
pnpm build            # Build all packages
pnpm build:shared     # Build shared types first (required before api/web)
pnpm type-check       # Check all packages
pnpm db:seed          # Seed database with test data
pnpm db:migrate       # Run database migrations
pnpm test             # Runs api unit tests via vitest
```

PostgreSQL must be running locally before dev or tests.

## Database

PostgreSQL with direct SQL (no ORM). Migrations in `api/src/db/migrations/NNN_description.sql`. Never modify `schema.sql` for existing tables.

## Key Patterns (inherited)

- **4-Panel Editor Layout**: Icon Rail (48px) -> Sidebar (224px) -> Main Content (flex-1) -> Properties (256px)
- **Document associations**: via `document_associations` junction table
- **All API routes must be registered with OpenAPI** for Swagger + MCP auto-generation
- **"Untitled"** for all new document default titles
- **NEVER use `git commit --no-verify`**

## Deadlines

| Checkpoint | Deadline | Focus |
|---|---|---|
| Pre-Search | 2 hours after assignment | Agent responsibility + architecture decisions |
| MVP | Tuesday, 11:59 PM | Running graph, tracing, 5+ use cases |
| Early Submission | Friday, 11:59 PM | Polish, documentation, deployment |
| Final Submission | Sunday, 11:59 PM | All deliverables |

## MVP Checklist

- [ ] Graph running with at least one proactive detection end-to-end
- [ ] LangSmith tracing with 2+ shared trace links showing different execution paths
- [ ] FLEETGRAPH.md with Agent Responsibility and Use Cases (5+)
- [ ] Graph outline (nodes, edges, branching conditions) in FLEETGRAPH.md
- [ ] At least one human-in-the-loop gate
- [ ] Running against real Ship data (no mocks)
- [ ] Deployed and publicly accessible
- [ ] Trigger model documented and defended
