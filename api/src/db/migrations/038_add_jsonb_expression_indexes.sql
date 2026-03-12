-- Add expression indexes for JSONB property fields commonly used in WHERE clauses.
-- Without these, queries filtering on properties->>'state', properties->>'assignee_id',
-- or properties->>'sprint_number' fall back to sequential scans.

-- Issue state filtering (used by issues list, team grid, sprint issue counts)
CREATE INDEX IF NOT EXISTS idx_documents_properties_state
  ON documents ((properties->>'state'))
  WHERE document_type = 'issue';

-- Assignee filtering (used by dashboard/my-work, team grid)
CREATE INDEX IF NOT EXISTS idx_documents_properties_assignee_id
  ON documents ((properties->>'assignee_id'))
  WHERE properties->>'assignee_id' IS NOT NULL;

-- Sprint number filtering (used by weeks endpoint)
CREATE INDEX IF NOT EXISTS idx_documents_properties_sprint_number
  ON documents (((properties->>'sprint_number')::int))
  WHERE document_type = 'sprint';

-- Owner ID lookup (used by weeks endpoint owner_reports_to)
CREATE INDEX IF NOT EXISTS idx_documents_properties_owner_id
  ON documents ((properties->>'owner_id'))
  WHERE properties->>'owner_id' IS NOT NULL;
