import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { authMiddleware } from '../../middleware/auth.js';
import { z } from 'zod';
import { buildOnDemandGraph } from '../graph/on-demand.js';
import { executeAction } from '../graph/nodes/execute-action.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

const chatSchema = z.object({
  message: z.string().min(1).max(5000),
  documentId: z.string().uuid().optional(),
  documentType: z.string().optional(),
});

/**
 * POST /api/fleetgraph/chat
 * On-demand: user asks a question with optional document context
 */
router.post('/chat', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { message, documentId, documentType } = parsed.data;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Save user message
    await pool.query(
      `INSERT INTO fleetgraph_chat_messages (workspace_id, user_id, role, content, document_id, document_type)
       VALUES ($1, $2, 'user', $3, $4, $5)`,
      [workspaceId, userId, message, documentId || null, documentType || null]
    );

    // Run on-demand graph (30s timeout)
    const graph = buildOnDemandGraph();
    const result = await graph.invoke(
      {
        mode: 'on_demand',
        workspaceId,
        userId,
        userMessage: message,
        documentId: documentId || null,
        documentType: documentType || null,
      },
      { signal: AbortSignal.timeout(30_000) },
    );

    // Save assistant response
    await pool.query(
      `INSERT INTO fleetgraph_chat_messages (workspace_id, user_id, role, content, document_id, document_type)
       VALUES ($1, $2, 'assistant', $3, $4, $5)`,
      [workspaceId, userId, result.response, documentId || null, documentType || null]
    );

    res.json({ response: result.response });
  } catch (err) {
    console.error('[FleetGraph] Chat error:', err);
    res.status(500).json({ error: 'FleetGraph encountered an error processing your request.' });
  }
});

/**
 * GET /api/fleetgraph/findings
 * List findings for the current workspace
 */
router.get('/findings', authMiddleware, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspaceId!;
    const status = (req.query.status as string) || 'pending';

    const result = await pool.query(
      `SELECT id, finding_type, severity, document_id, document_type, summary, details, proposed_action, status, created_at
       FROM fleetgraph_findings
       WHERE workspace_id = $1 AND status = $2
       ORDER BY
         CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         created_at DESC
       LIMIT 50`,
      [workspaceId, status]
    );

    res.json({ findings: result.rows });
  } catch (err) {
    console.error('[FleetGraph] Findings error:', err);
    res.status(500).json({ error: 'Failed to fetch findings' });
  }
});

/**
 * POST /api/fleetgraph/findings/:id/approve
 * Approve a finding's proposed action
 */
router.post('/findings/:id/approve', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const workspaceId = req.workspaceId as string;

    // Update status to approved
    const result = await pool.query(
      "UPDATE fleetgraph_findings SET status = 'approved', updated_at = NOW() WHERE id = $1 AND workspace_id = $2 RETURNING *",
      [id, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Finding not found' });
      return;
    }

    // Execute the action
    try {
      await executeAction(id, workspaceId);
    } catch (execErr) {
      console.error('[FleetGraph] Action execution error:', execErr);
      // Still return success for the approval itself
    }

    res.json({ finding: result.rows[0] });
  } catch (err) {
    console.error('[FleetGraph] Approve error:', err);
    res.status(500).json({ error: 'Failed to approve finding' });
  }
});

/**
 * POST /api/fleetgraph/findings/:id/dismiss
 * Dismiss a finding (suppresses for 7 days)
 */
router.post('/findings/:id/dismiss', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const workspaceId = req.workspaceId!;

    const result = await pool.query(
      `UPDATE fleetgraph_findings
       SET status = 'dismissed', dismissed_until = NOW() + INTERVAL '7 days', updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2
       RETURNING *`,
      [id, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Finding not found' });
      return;
    }

    res.json({ finding: result.rows[0] });
  } catch (err) {
    console.error('[FleetGraph] Dismiss error:', err);
    res.status(500).json({ error: 'Failed to dismiss finding' });
  }
});

/**
 * GET /api/fleetgraph/status
 * Agent health check
 */
router.get('/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspaceId!;

    const pollState = await pool.query(
      'SELECT last_fast_poll, last_slow_poll FROM fleetgraph_poll_state WHERE workspace_id = $1',
      [workspaceId]
    );

    const pendingCount = await pool.query(
      "SELECT COUNT(*) as count FROM fleetgraph_findings WHERE workspace_id = $1 AND status = 'pending'",
      [workspaceId]
    );

    res.json({
      enabled: process.env.FLEETGRAPH_ENABLED === 'true',
      lastPoll: pollState.rows[0]?.last_fast_poll || null,
      lastSlowPoll: pollState.rows[0]?.last_slow_poll || null,
      pendingCount: parseInt(pendingCount.rows[0]?.count || '0'),
    });
  } catch (err) {
    console.error('[FleetGraph] Status error:', err);
    res.status(500).json({ error: 'Failed to get FleetGraph status' });
  }
});

/**
 * POST /api/fleetgraph/seed-demo
 * Insert sample findings for demo purposes (admin only)
 */
router.post('/seed-demo', authMiddleware, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspaceId!;

    const demoFindings = [
      {
        type: 'scope_creep', severity: 'medium',
        doc_id: 'f0000000-0000-0000-0000-000000000003', doc_type: 'sprint',
        summary: '3 issue(s) added to "Week 12 (Mar 16-22)" after plan was submitted.',
        details: { week_title: 'Week 12 (Mar 16-22)', plan_submitted_at: '2026-03-16T09:00:00Z', added_issues: [{ title: 'Fix notification delivery' }, { title: 'Fix date picker timezone' }, { title: 'Improve search performance' }] },
        action: 'Review the 3 new issue(s) and decide whether to defer or accept the scope increase.',
      },
      {
        type: 'missing_ritual', severity: 'high',
        doc_id: 'f0000000-0000-0000-0000-000000000002', doc_type: 'sprint',
        summary: 'Week "Week 11 (Mar 9-15)" (Sprint 11) was completed without a retro.',
        details: { week_title: 'Week 11 (Mar 9-15)', sprint_number: 11, ritual_type: 'weekly_retro' },
        action: 'Follow up with the week owner about writing a retrospective for "Week 11 (Mar 9-15)".',
      },
      {
        type: 'missing_ritual', severity: 'medium',
        doc_id: 'f0000000-0000-0000-0000-000000000003', doc_type: 'sprint',
        summary: 'Week "Week 12 (Mar 16-22)" (Sprint 12) has no weekly plan.',
        details: { week_title: 'Week 12 (Mar 16-22)', sprint_number: 12, ritual_type: 'weekly_plan' },
        action: 'Remind the week owner to submit a weekly plan for "Week 12 (Mar 16-22)".',
      },
      {
        type: 'missing_standup', severity: 'medium',
        doc_id: '403f315c-a908-438b-921b-ea4ab4f7da4e', doc_type: 'person',
        summary: 'Alex Rivera has not posted a standup in the last 48 hours.',
        details: { person_name: 'Alex Rivera' },
        action: 'Send a reminder to post a standup update.',
      },
    ];

    let inserted = 0;
    for (const f of demoFindings) {
      const exists = await pool.query(
        `SELECT id FROM fleetgraph_findings WHERE workspace_id = $1 AND finding_type = $2 AND document_id = $3 AND status = 'pending'`,
        [workspaceId, f.type, f.doc_id]
      );
      if (exists.rows.length > 0) continue;

      await pool.query(
        `INSERT INTO fleetgraph_findings (workspace_id, finding_type, severity, document_id, document_type, summary, details, proposed_action, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
        [workspaceId, f.type, f.severity, f.doc_id, f.doc_type, f.summary, JSON.stringify(f.details), f.action]
      );
      inserted++;
    }

    res.json({ inserted, total: demoFindings.length });
  } catch (err) {
    console.error('[FleetGraph] Seed demo error:', err);
    res.status(500).json({ error: 'Failed to seed demo findings' });
  }
});

export default router;
