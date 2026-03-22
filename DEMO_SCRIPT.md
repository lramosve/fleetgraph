# FleetGraph Demo Script (5 min)

**Story:** A team's sprint has gone quiet. FleetGraph notices, classifies the risk, proposes action, and waits for human approval. We follow one finding from detection to resolution.

**URL:** https://fleetgraph-production-614c.up.railway.app/
**Credentials:** dev@ship.local / admin123

---

## 0:00–0:45 — Set the Scene

> "Imagine you're a project manager running a team on Ship. It's Wednesday, and your sprint started Monday. Four issues were assigned, but you've been in meetings all day. You haven't checked the board. Meanwhile, the WebSocket reconnection fix — a critical issue — has had zero activity for almost 10 days. Nobody updated it, nobody commented on it, nobody mentioned it in standup."
>
> "You don't know this yet. But FleetGraph does."
>
> "FleetGraph is a project intelligence agent that runs in the background. Every 3 minutes, it checks if anything changed in the workspace. When it detects changes, or every 30 minutes regardless, it runs a full diagnostic — scanning for stale issues, missing standups, scope creep, and missing rituals — all in parallel. Let me show you what it found."

---

## 0:45–1:45 — Show the Detection

**Action:** Log in. Click the FleetGraph hexagon icon in the left rail. Switch to the **Findings** tab.

> "This is the FleetGraph panel inside Ship. The Findings tab shows everything the agent detected proactively — without anyone asking. Let me walk through what we're seeing."

**Action:** Point to a high-severity stale_issue finding.

> "Here's the one I want to focus on: 'WebSocket reconnection fix has been idle for nearly 10 days.' FleetGraph classified this as **high severity**. It's also proposing an action — 'Escalate to team lead and request immediate status update.' But it hasn't done anything yet. It's waiting for me."
>
> "That's the key design decision: FleetGraph can read any data and reason about it autonomously, but it cannot take any write action — adding a comment, changing an issue, notifying someone — without human approval. Every finding sits here as a proposal until a person says yes or no."

**Action:** Scroll to show other finding types — Scope Creep, Missing Ritual, Missing Standup.

> "And this isn't just stale issues. The same proactive scan also detected scope creep — 3 issues added to this week after the plan was submitted. It caught a missing retrospective from last week. And it flagged team members who haven't posted standups. All four detection types ran in parallel during the same graph execution."

---

## 1:45–3:00 — Show the Graph and Trace

**Action:** Switch to the LangSmith proactive trace tab: https://smith.langchain.com/public/e09239db-e51d-4210-91eb-4975c67a3f90/r

> "Let's look under the hood. This is a LangSmith trace of the actual graph run that produced those findings. The proactive graph is built with LangGraph JS."
>
> "It starts with **fetch_activity** — a single database query that checks if anything changed since the last poll. If nothing changed, the graph ends immediately, costing zero. But in this run, changes were detected."

**Action:** Point to the 4 parallel detection nodes in the trace timeline.

> "Here's the parallel fan-out. After fetch_activity, the graph branches into **four detection nodes** — all starting at the exact same millisecond: detect_stale_issues, detect_missing_standups, detect_scope_creep, and detect_missing_rituals. LangGraph runs them concurrently."
>
> "Three of these are pure database queries — they finish in under 30 milliseconds. But **detect_stale_issues** is different. It sends the list of stale issues to Claude and asks it to classify severity and write a human-readable summary. That's the ChatAnthropic call you see here — it takes about 7 seconds."

**Action:** Point to propose_action at the end of the trace.

> "Then comes the **fan-in**. propose_action waits for all four nodes to finish, collects their findings through a merge reducer, deduplicates them against what was already surfaced in the last 24 hours, checks for dismissed findings that are still suppressed, and saves everything new to the database as **pending** — waiting for a human."
>
> "The whole run: 6.9 seconds. One LLM call. Four detection types. And if I switch to a clean run trace..."

**Action:** Briefly show the clean run trace: https://smith.langchain.com/public/c9b10ff8-7b48-4e54-bd8a-3e76a67af893/r

> "...you see fetch_activity checks the hash, nothing changed, and it exits in 22 milliseconds. No LLM, no cost. This is 95% of fast polls."

---

## 3:00–4:00 — The Human Step

**Action:** Switch back to the app, Findings tab. Click **Approve** on the high-severity stale issue finding.

> "Back in the app. I'm going to approve this finding. When I click Approve, FleetGraph executes the proposed action — in this case, it adds a comment to the WebSocket issue saying it's been flagged as stale and suggesting the team follow up."
>
> "The finding status changes to approved. The action is done. If I didn't agree, I could hit Dismiss instead, and FleetGraph would suppress that specific finding for 7 days — it won't bring it up again unless the condition gets significantly worse."

**Action:** Dismiss a missing_standup finding.

> "Let me dismiss this missing standup finding for Alex. Maybe I know Alex is on PTO. Now FleetGraph won't flag Alex's missing standups again until next week."
>
> "This is the human-in-the-loop gate. The agent detects, reasons, and proposes. The human approves, dismisses, or ignores. The agent never acts unilaterally."

---

## 4:00–4:45 — On-Demand Mode

**Action:** Switch to the Chat tab. Type: "What should I focus on today?" and send.

> "FleetGraph also has an on-demand mode. I can ask it questions directly. It fetches workspace context in parallel — the current document, issue stats, and pending findings — merges them, and sends everything to Claude."

**Action:** Wait for response, point to the answer.

> "It synthesized the stale issues, the scope creep, and the missing rituals into a prioritized action list. This is the same data the proactive graph detected, but now presented as a direct answer to my question."

---

## 4:45–5:00 — Wrap Up

> "To recap: FleetGraph runs proactively every 3 minutes. When it detects changes, four detection nodes run in parallel — stale issues, missing standups, scope creep, and missing rituals. Findings are classified, deduplicated, and saved as proposals. Humans approve or dismiss. The agent never writes without permission."
>
> "Everything is traced in LangSmith, tested with 27 unit tests, and deployed on Railway running against real Ship data. Thanks."

---

## Pre-Demo Setup

- [ ] Open production URL and log in: https://fleetgraph-production-614c.up.railway.app/
- [ ] Open proactive trace in a tab: https://smith.langchain.com/public/e09239db-e51d-4210-91eb-4975c67a3f90/r
- [ ] Open clean run trace in a tab: https://smith.langchain.com/public/c9b10ff8-7b48-4e54-bd8a-3e76a67af893/r
- [ ] Verify Findings tab has entries across multiple types (if empty, POST to `/api/fleetgraph/seed-demo`)
- [ ] Practice the approve/dismiss flow once so you know which finding to click
- [ ] Start recording
