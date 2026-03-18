# FleetGraph MVP Demo Script (5 min)

**URL:** https://fleetgraph-production-614c.up.railway.app/
**Credentials:** dev@ship.local / admin123

---

## 0:00–0:30 — Intro

> "Hi, I'm Luis. This is FleetGraph — a project intelligence agent built on top of Ship, a project management platform from the US Department of the Treasury."
>
> "FleetGraph has two modes: it proactively monitors your project for problems like stale issues and missing standups, and it provides an on-demand chat interface where you can ask questions about your project's health."

---

## 0:30–1:15 — Show the App + FleetGraph Icon

**Action:** Log in at the production URL. Close the Action Items modal.

> "Here's Ship with our seed data — documents, issues, projects. Notice the icon rail on the left."

**Action:** Point to the FleetGraph icon at the bottom of the rail (hexagon shape with orange badge dot).

> "This is FleetGraph. The orange dot means there are pending findings — things the agent detected proactively that need my attention. Let me click it."

**Action:** Click the FleetGraph icon to open the chat panel.

> "The panel has two tabs: Chat for on-demand questions, and Findings for proactive detections."

---

## 1:15–2:15 — Findings Tab (Proactive Detection + Human-in-the-Loop)

**Action:** Click the "Findings" tab.

> "FleetGraph runs a proactive scan every 3 minutes. It polls for recent activity, fetches in-progress issues, and uses Claude to classify which ones are stale."
>
> "Here we see a finding: a stale issue that's been in progress for 5 days with no activity. FleetGraph classified it as high severity and suggests adding a comment asking for a status update."
>
> "This is the human-in-the-loop gate. The agent can't take action on its own — it proposes an action and waits for approval. I can either Approve it, which will execute the action, or Dismiss it, which suppresses the finding for 7 days."

**Action:** Click "Approve" on a finding.

> "Approved. The agent will now add a comment to that issue. If I had clicked Dismiss, FleetGraph wouldn't bring it up again for a week."

---

## 2:15–3:15 — Chat Tab (On-Demand Mode)

**Action:** Switch to the "Chat" tab.

> "Now let me try the on-demand mode. I can ask FleetGraph questions and it uses the full workspace context to answer."

**Action:** Type "What's stale?" and press Enter. Wait for response.

> "FleetGraph fetches workspace data — issue counts, states, pending findings — passes it to Claude, and gives me an actionable summary. It found stale issues and recommends specific actions."

**Action:** Type "How is this project doing?" and press Enter.

> "It gives me a project health overview — how many issues are in progress, done, and todo, with risk flags and recommendations. All powered by real Ship data, not mocks."

---

## 3:15–4:00 — LangGraph Architecture + LangSmith Traces

**Action:** Switch to browser tab showing LangSmith trace (open https://smith.langchain.com/public/44f1ddc8-783b-4d62-857e-ecece7db05e1/r beforehand).

> "Under the hood, FleetGraph uses LangGraph JS with two compiled graphs. Here's a LangSmith trace of the proactive graph."
>
> "You can see the execution path: fetch_activity checks for changes, fetch_issues pulls in-progress issues, detect_stale uses Claude to classify them, and propose_action saves findings to the database."

**Action:** Switch to the on-demand trace (open https://smith.langchain.com/public/ab025179-1922-409d-81ed-0e311d1adb8a/r).

> "And here's the on-demand graph: fetch_context gathers workspace data, answer_query sends it to Claude with the user's question, and format_response prepares the output."
>
> "These are two distinct execution paths through the same system — conditional edges in LangGraph route between them."

---

## 4:00–4:40 — Trigger Model + Architecture

> "For the trigger model: Ship has no webhook system, so FleetGraph uses hybrid polling. A fast poll every 3 minutes checks for activity changes using a hash — if nothing changed, no LLM call is made, costing zero. When changes are detected, it runs a deep scan with Claude reasoning. A slow poll every 30 minutes catches absence-based conditions like missing standups."
>
> "The tech stack is: LangGraph JS for the graph engine, Claude Sonnet via the Anthropic SDK for reasoning, LangSmith for tracing, PostgreSQL for persistence, and React with TanStack Query for the frontend."

---

## 4:40–5:00 — Wrap Up

> "To summarize: FleetGraph is a project intelligence agent that proactively detects project health issues, surfaces them with proposed actions, requires human approval before acting, and provides an on-demand chat interface for project questions. It's deployed on Railway, traced with LangSmith, and running against real Ship data."
>
> "Thanks for watching."

---

## Pre-Demo Checklist

- [ ] Open production URL in a browser tab: https://fleetgraph-production-614c.up.railway.app/
- [ ] Open LangSmith proactive trace in a tab: https://smith.langchain.com/public/44f1ddc8-783b-4d62-857e-ecece7db05e1/r
- [ ] Open LangSmith on-demand trace in a tab: https://smith.langchain.com/public/ab025179-1922-409d-81ed-0e311d1adb8a/r
- [ ] Make sure there's at least 1 pending finding (if not, wait for a poll cycle or trigger manually)
- [ ] Start Loom recording with microphone + screen
