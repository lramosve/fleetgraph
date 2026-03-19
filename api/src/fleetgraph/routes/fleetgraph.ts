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

export default router;
