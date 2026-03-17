-- FleetGraph tables for proactive detection and on-demand chat

-- Stores proactive detection findings
CREATE TABLE IF NOT EXISTS fleetgraph_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  finding_type TEXT NOT NULL,  -- 'stale_issue', 'scope_creep', 'missing_standup', etc.
  severity TEXT NOT NULL DEFAULT 'medium',  -- 'low', 'medium', 'high'
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  document_type TEXT,
  summary TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  proposed_action TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'dismissed', 'executed', 'expired'
  dismissed_until TIMESTAMPTZ,  -- suppression window
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fleetgraph_findings_workspace ON fleetgraph_findings(workspace_id);
CREATE INDEX idx_fleetgraph_findings_status ON fleetgraph_findings(workspace_id, status);
CREATE INDEX idx_fleetgraph_findings_document ON fleetgraph_findings(document_id);

-- Persists polling timestamps per workspace
CREATE TABLE IF NOT EXISTS fleetgraph_poll_state (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  last_fast_poll TIMESTAMPTZ,
  last_slow_poll TIMESTAMPTZ,
  activity_hash TEXT,  -- hash of last activity feed for change detection
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- On-demand conversation history
CREATE TABLE IF NOT EXISTS fleetgraph_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,  -- 'user' or 'assistant'
  content TEXT NOT NULL,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  document_type TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fleetgraph_chat_workspace_user ON fleetgraph_chat_messages(workspace_id, user_id);
CREATE INDEX idx_fleetgraph_chat_created ON fleetgraph_chat_messages(created_at);
