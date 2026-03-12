/**
 * Supplemental seed script to meet audit benchmarking requirements:
 *   500+ documents, 100+ issues, 20+ users, 10+ sprints
 *
 * Run AFTER the standard seed: pnpm --filter api run db:seed
 * Usage: npx tsx scripts/seed-benchmark-data.ts
 */

import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '../api/.env.local') });
config({ path: join(__dirname, '../api/.env') });

const EXTRA_USERS = [
  'Karen Taylor', 'Leo Adams', 'Maya Thompson', 'Nathan Wright',
  'Olivia Scott', 'Patrick Hall', 'Quinn Davis', 'Rachel Moore',
  'Samuel Clark', 'Tina Lewis', 'Uma Robinson', 'Victor Walker',
  'Wendy Young', 'Xavier King',
];

const ISSUE_TITLES = [
  'Update login page error messages', 'Fix sidebar scroll on mobile',
  'Add pagination to search results', 'Optimize image compression pipeline',
  'Implement CSV export for reports', 'Add dark mode toggle to settings',
  'Fix timezone handling in date picker', 'Refactor notification service',
  'Add bulk archive for old documents', 'Update API rate limiting docs',
  'Fix memory leak in WebSocket handler', 'Add input validation for profile form',
  'Implement undo for document deletion', 'Add loading skeleton for dashboard',
  'Fix table column resize on Firefox', 'Audit npm dependencies for CVEs',
  'Add keyboard shortcut help modal', 'Fix race condition in auto-save',
  'Implement retry logic for failed uploads', 'Add aria-labels to icon buttons',
  'Optimize SQL query for team grid', 'Fix focus trap in confirmation dialog',
  'Add end-to-end test for onboarding', 'Update TLS certificates for staging',
  'Fix broken breadcrumb on nested docs', 'Add progress indicator for imports',
  'Implement session timeout warning', 'Fix drag-drop reorder on touch devices',
  'Add filter persistence to URL params', 'Optimize bundle size for editor chunk',
  'Fix color contrast on status badges', 'Add webhook support for integrations',
  'Implement document version history UI', 'Fix SSO redirect loop on logout',
  'Add multi-select for issue assignment', 'Update onboarding tutorial content',
  'Fix toast notification stacking', 'Add column sorting to issue table',
  'Implement inline code block styling', 'Fix search index for special chars',
  'Add monitoring dashboard for admins', 'Fix print stylesheet for documents',
  'Implement comment threading UI', 'Add API endpoint for bulk status update',
  'Fix file upload size validation', 'Update error page with support contact',
  'Add role-based nav menu filtering', 'Fix PWA manifest icons',
  'Implement auto-assignment rules', 'Add calendar view for sprint planning',
];

const WIKI_TITLES = [
  'Engineering Standards', 'Deployment Runbook', 'Incident Response Guide',
  'API Design Guidelines', 'Database Migration Procedures', 'Code Review Checklist',
  'Performance Tuning Guide', 'Security Best Practices', 'Accessibility Standards',
  'Testing Strategy Document', 'Release Process', 'Architecture Decision Records',
  'Monitoring and Alerting Setup', 'Data Retention Policy', 'Team Onboarding Guide',
  'Infrastructure Diagrams', 'Dependency Update Policy', 'Feature Flag Guidelines',
  'Load Testing Procedures', 'Backup and Recovery Plan', 'CI/CD Pipeline Guide',
  'API Versioning Strategy', 'Error Handling Standards', 'Logging Conventions',
  'CSS and Styling Guide', 'Git Workflow Standards', 'Sprint Retrospective Templates',
  'Meeting Notes Template', 'Risk Assessment Framework', 'Change Management Process',
  'Vendor Evaluation Criteria', 'Budget Tracking Guide', 'Compliance Checklist',
  'User Research Playbook', 'Design System Documentation', 'Mobile Responsiveness Guide',
  'Internationalization Guide', 'Data Privacy Guidelines', 'Open Source Policy',
  'Technical Debt Tracker', 'Capacity Planning Guide', 'Disaster Recovery Plan',
  'Network Architecture Guide', 'Container Security Guide', 'API Gateway Config',
  'Service Level Agreements', 'Operational Readiness Checklist', 'Post-Mortem Template',
  'Knowledge Base Organization', 'Weekly Status Report Template',
];

const STATES = ['triage', 'backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

function randomItem<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

async function seedBenchmarkData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  console.log('Supplemental benchmark seed starting...');

  try {
    // Get workspace
    const wsResult = await pool.query("SELECT id FROM workspaces WHERE name = 'Ship Workspace'");
    if (!wsResult.rows[0]) {
      console.error('Workspace not found. Run pnpm --filter api run db:seed first.');
      process.exit(1);
    }
    const workspaceId = wsResult.rows[0].id;

    // Get existing user IDs
    const existingUsers = await pool.query('SELECT id FROM users');
    const userIds: string[] = existingUsers.rows.map((r: { id: string }) => r.id);

    // Get existing program IDs
    const programs = await pool.query(
      "SELECT id FROM documents WHERE workspace_id = $1 AND document_type = 'program' AND deleted_at IS NULL",
      [workspaceId]
    );
    const programIds: string[] = programs.rows.map((r: { id: string }) => r.id);

    // Get existing project IDs
    const projects = await pool.query(
      "SELECT id FROM documents WHERE workspace_id = $1 AND document_type = 'project' AND deleted_at IS NULL",
      [workspaceId]
    );
    const projectIds: string[] = projects.rows.map((r: { id: string }) => r.id);

    // Get existing sprint IDs
    const sprints = await pool.query(
      "SELECT id FROM documents WHERE workspace_id = $1 AND document_type = 'sprint' AND deleted_at IS NULL",
      [workspaceId]
    );
    const sprintIds: string[] = sprints.rows.map((r: { id: string }) => r.id);

    // ── 1. Create 14 additional users (11 existing + 14 = 25 total) ──
    const passwordHash = await bcrypt.hash('admin123', 10);
    let usersCreated = 0;

    for (const name of EXTRA_USERS) {
      const email = name.toLowerCase().replace(' ', '.') + '@ship.local';
      const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);

      if (!existing.rows[0]) {
        const userResult = await pool.query(
          `INSERT INTO users (email, password_hash, name, last_workspace_id)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [email, passwordHash, name, workspaceId]
        );
        const userId = userResult.rows[0].id;
        userIds.push(userId);

        // Create workspace membership
        await pool.query(
          'INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [workspaceId, userId, 'member']
        );

        // Create person document
        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
           VALUES ($1, 'person', $2, $3, $4)`,
          [workspaceId, name, JSON.stringify({ user_id: userId, email }), userId]
        );

        usersCreated++;
      }
    }
    console.log(`Created ${usersCreated} additional users (total: ${userIds.length})`);

    // ── 2. Create additional issues to reach 400+ ──
    // Get current max ticket number
    const maxTicket = await pool.query(
      "SELECT COALESCE(MAX(ticket_number), 0) as max_num FROM documents WHERE workspace_id = $1 AND document_type = 'issue'",
      [workspaceId]
    );
    let ticketNum = (maxTicket.rows[0].max_num as number) + 1;

    // Create 300 more issues (104 existing + 300 = 404 total)
    const issueBatchValues: string[] = [];
    const issueBatchParams: unknown[] = [];
    let paramIdx = 1;
    const issueIds: string[] = [];

    for (let i = 0; i < 300; i++) {
      const title = ISSUE_TITLES[i % ISSUE_TITLES.length] + (i >= ISSUE_TITLES.length ? ` (${Math.floor(i / ISSUE_TITLES.length) + 1})` : '');
      const state = randomItem(STATES);
      const priority = randomItem(PRIORITIES);
      const assigneeId = randomItem(userIds);
      const createdBy = randomItem(userIds);

      const props = JSON.stringify({
        state,
        priority,
        assignee_id: assigneeId,
        source: 'internal',
        estimate: Math.floor(Math.random() * 8) + 1,
      });

      issueBatchValues.push(
        `($${paramIdx}, 'issue', $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4})`
      );
      issueBatchParams.push(workspaceId, title, props, ticketNum, createdBy);
      paramIdx += 5;
      ticketNum++;
    }

    // Batch insert in groups of 50
    for (let batch = 0; batch < issueBatchValues.length; batch += 50) {
      const batchSlice = issueBatchValues.slice(batch, batch + 50);
      const paramsPerRow = 5;
      const startParam = batch * paramsPerRow;
      const batchParams = issueBatchParams.slice(startParam, startParam + batchSlice.length * paramsPerRow);

      // Renumber parameters for this batch
      let localIdx = 1;
      const renumbered = batchSlice.map(() => {
        const s = `($${localIdx}, 'issue', $${localIdx + 1}, $${localIdx + 2}, $${localIdx + 3}, $${localIdx + 4})`;
        localIdx += 5;
        return s;
      });

      const result = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, ticket_number, created_by)
         VALUES ${renumbered.join(', ')}
         RETURNING id`,
        batchParams
      );
      issueIds.push(...result.rows.map((r: { id: string }) => r.id));
    }
    console.log(`Created 300 additional issues (total: ${ticketNum - 1})`);

    // Create associations for new issues (assign to random projects and sprints)
    let assocCount = 0;
    for (const issueId of issueIds) {
      if (projectIds.length > 0 && Math.random() > 0.3) {
        const projectId = randomItem(projectIds);
        await pool.query(
          `INSERT INTO document_associations (document_id, related_id, relationship_type)
           VALUES ($1, $2, 'project') ON CONFLICT DO NOTHING`,
          [issueId, projectId]
        );
        assocCount++;
      }
      if (sprintIds.length > 0 && Math.random() > 0.4) {
        const sprintId = randomItem(sprintIds);
        await pool.query(
          `INSERT INTO document_associations (document_id, related_id, relationship_type)
           VALUES ($1, $2, 'sprint') ON CONFLICT DO NOTHING`,
          [issueId, sprintId]
        );
        assocCount++;
      }
      if (programIds.length > 0 && Math.random() > 0.5) {
        const programId = randomItem(programIds);
        await pool.query(
          `INSERT INTO document_associations (document_id, related_id, relationship_type)
           VALUES ($1, $2, 'program') ON CONFLICT DO NOTHING`,
          [issueId, programId]
        );
        assocCount++;
      }
    }
    console.log(`Created ${assocCount} issue associations`);

    // ── 3. Create 50 additional wiki documents ──
    let wikiCount = 0;
    for (let i = 0; i < WIKI_TITLES.length; i++) {
      const title = WIKI_TITLES[i]!;
      const createdBy = randomItem(userIds);
      const content = JSON.stringify({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
          { type: 'paragraph', content: [{ type: 'text', text: `This document covers ${title.toLowerCase()} for the Ship project. It provides guidelines and procedures for the engineering team.` }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Last updated by the engineering team. Please review regularly and submit changes via the standard review process.' }] },
        ],
      });

      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, content, properties, created_by)
         VALUES ($1, 'wiki', $2, $3, $4, $5)`,
        [workspaceId, title, content, '{}', createdBy]
      );
      wikiCount++;
    }
    console.log(`Created ${wikiCount} additional wiki documents`);

    // ── 4. Create additional standups (2 per new user) ──
    let standupCount = 0;
    for (const userId of userIds.slice(-usersCreated > 0 ? usersCreated : 0)) {
      for (let d = 0; d < 2; d++) {
        const date = new Date();
        date.setDate(date.getDate() - d);
        const content = JSON.stringify({
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: `Worked on assigned tasks. Reviewed PRs and attended standup.` }] },
          ],
        });

        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, content, properties, created_by)
           VALUES ($1, 'standup', $2, $3, $4, $5)`,
          [workspaceId, `Standup - ${date.toISOString().split('T')[0]}`,
           content,
           JSON.stringify({ author_id: userId, date: date.toISOString().split('T')[0], submitted_at: date.toISOString() }),
           userId]
        );
        standupCount++;
      }
    }
    console.log(`Created ${standupCount} additional standups`);

    // ── 5. Count totals ──
    const totalDocs = await pool.query(
      'SELECT COUNT(*) as total FROM documents WHERE workspace_id = $1 AND deleted_at IS NULL',
      [workspaceId]
    );
    const totalIssues = await pool.query(
      "SELECT COUNT(*) as total FROM documents WHERE workspace_id = $1 AND document_type = 'issue' AND deleted_at IS NULL",
      [workspaceId]
    );
    const totalUsers = await pool.query('SELECT COUNT(*) as total FROM users');
    const totalSprints = await pool.query(
      "SELECT COUNT(*) as total FROM documents WHERE workspace_id = $1 AND document_type = 'sprint' AND deleted_at IS NULL",
      [workspaceId]
    );

    console.log('\n--- Final Totals ---');
    console.log(`Documents: ${totalDocs.rows[0].total} (target: 500+)`);
    console.log(`Issues:    ${totalIssues.rows[0].total} (target: 100+)`);
    console.log(`Users:     ${totalUsers.rows[0].total} (target: 20+)`);
    console.log(`Sprints:   ${totalSprints.rows[0].total} (target: 10+)`);

    console.log('\nBenchmark seed complete!');

  } finally {
    await pool.end();
  }
}

seedBenchmarkData().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
