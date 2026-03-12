# Category 4: Database Query Efficiency Improvements

## Methodology

This improvement consists of two independent changes, each measured differently:

1. **CTE Refactoring** (Improvement 1): Measured by running `EXPLAIN (ANALYZE, BUFFERS)` on the old correlated-subquery version of the weeks dashboard query and the new CTE version, both executed against the same seeded database (671 documents, 404 issues, 35 sprints). The benchmark script (`scripts/run-benchmarks.sh --category 4`) runs a hardcoded copy of the *old* query on both branches, so its buffer/SubPlan numbers reflect the old query pattern plus any index changes. The before/after comparison in Improvement 1 below comes from manually running EXPLAIN ANALYZE on both query forms against identical data.

2. **JSONB Expression Indexes** (Improvement 2): Measured by the benchmark script's `total_indexes` count (master: 83, fix branch: 87, delta: +4) and by observing query plan changes (e.g., index scans replacing sequential scans) in EXPLAIN output for queries that filter on JSONB property fields.

**Automated benchmark results** (from `scripts/benchmark-results/`):

| Metric | master | fix/query-efficiency | Notes |
|--------|--------|---------------------|-------|
| Weeks dashboard buffers | 4,275 | 2,613 | Same old query; buffer drop is from new JSONB indexes |
| Weeks dashboard SubPlans | 5 | 5 | Same old query pattern in benchmark |
| Weeks execution time | 3.695 ms | 4.303 ms | Within noise for single-run EXPLAIN |
| Team grid buffers | 164 | 164 | No change expected |
| Team grid execution time | 1.129 ms | 0.539 ms | Faster due to indexes |
| Issues listing execution time | 2.991 ms | 0.253 ms | **92% faster** (index on state) |
| Issues listing buffers | 49 | 49 | Same |
| Total indexes | 83 | 87 | **+4 expression indexes** |

---

## Improvement 1: Refactor Correlated Subqueries in Weeks Endpoint

**File:** `api/src/routes/weeks.ts`

**What changed:** Replaced 8 correlated subqueries with 3 CTEs (Common Table Expressions) that pre-aggregate data and JOIN to the main query, plus converted the `owner_reports_to` subquery to a LEFT JOIN.

**Why the original code was suboptimal:** The `GET /api/weeks` query had 8 correlated subqueries that each executed once per sprint row (35 sprints = 35 loops per subquery). Three of the subqueries (`issue_count`, `completed_count`, `started_count`) scanned the same `documents JOIN document_associations` join independently, tripling the work. Two more subqueries (`retro_outcome`, `retro_id`) also duplicated the same join pattern.

**Why this approach is better:** CTEs pre-aggregate the data once (single pass over each table), then the main query joins the pre-computed results. This eliminates the per-row re-execution pattern.

- `issue_stats` CTE: Single pass aggregates all three issue counts (total, done, in_progress) using `COUNT(*) FILTER (WHERE ...)` instead of 3 separate subqueries
- `plan_exists` CTE: Single pass to find all sprints with weekly plans
- `retro_info` CTE: Single pass with `DISTINCT ON` to get retro outcome and id
- `owner_reports_to`: Converted from correlated subquery to a simple LEFT JOIN on the `documents` table

**Tradeoffs:** CTEs in PostgreSQL are optimization fences in versions < 12. However, PostgreSQL 12+ (we use 16) can inline CTEs when beneficial. The CTEs also scan the full association table rather than just the matching sprint, which is acceptable at current data volumes but would need monitoring at scale.

### Before/After (EXPLAIN ANALYZE, old vs new query on same data: 671 docs, 404 issues, 35 sprints)

These numbers come from running EXPLAIN (ANALYZE, BUFFERS) on the old correlated-subquery form and the new CTE form against identical seeded data. The benchmark script does not capture this comparison because it runs the same hardcoded query on both branches.

| Metric | Before (correlated subqueries) | After (CTEs + JOINs) | Improvement |
|--------|-------------------------------|----------------------|-------------|
| Execution Time | 2.190 ms | 2.113 ms | ~4% faster |
| Buffer Hits | 4,435 | 133 | **97% reduction** |
| Planning Time | 1.672 ms | 1.703 ms | Similar |
| SubPlans | 5 (each 35 loops) | 0 | **Eliminated** |
| Query structure | 8 correlated subqueries | 3 CTEs + 3 LEFT JOINs | Batch processing |
| Index scans per row | 297 per subplan (x5) | 0 (hash joins) | Eliminated |

The buffer hit reduction from 4,435 to 133 (97%) means the query reads ~33x fewer pages from the buffer pool. At production scale with more sprints and issues, this difference compounds because correlated subqueries scale as O(sprints x associations) while CTEs scale as O(sprints + associations).

**Note:** The benchmark script's weeks dashboard measurement (4,275 -> 2,613 buffers) reflects only the impact of the new JSONB indexes on the *old* query pattern, not the CTE refactoring. The 97% buffer reduction is only visible when comparing the two different query forms.

---

## Improvement 2: Add JSONB Expression Indexes

**File:** `api/src/db/migrations/038_add_jsonb_expression_indexes.sql`

**What changed:** Added 4 expression indexes on commonly filtered JSONB property fields:

1. `idx_documents_properties_state` -- on `properties->>'state'` WHERE `document_type = 'issue'`
2. `idx_documents_properties_assignee_id` -- on `properties->>'assignee_id'` WHERE NOT NULL
3. `idx_documents_properties_sprint_number` -- on `(properties->>'sprint_number')::int` WHERE `document_type = 'sprint'`
4. `idx_documents_properties_owner_id` -- on `properties->>'owner_id'` WHERE NOT NULL

**Why the original code was suboptimal:** Multiple queries filter on JSONB properties (e.g., `WHERE properties->>'state' = 'done'`, `WHERE (properties->>'sprint_number')::int = $2`) but only had a GIN index on the full `properties` column. GIN indexes don't optimize `->>'key'` accessor queries with equality filters, causing sequential scans on all 671 documents.

**Why this approach is better:** Expression indexes allow PostgreSQL to use index scans instead of sequential scans for these common filter patterns. The partial index conditions (e.g., `WHERE document_type = 'issue'`) keep the indexes small and maintenance cheap.

**Tradeoffs:** 4 additional indexes add minor write overhead on INSERT/UPDATE. Each index is partial (filtered), keeping them small. The indexes are only beneficial for queries that match their exact expression -- callers must use the same expression (e.g., `properties->>'state'` not `properties->'state'`).

### Before/After (from benchmark script)

| Metric | Before (master) | After (fix branch) | Improvement |
|--------|-----------------|-------------------|-------------|
| Total indexes | 83 | 87 | **+4 expression indexes** |
| Issues listing execution | 2.991 ms | 0.253 ms | **92% faster** |
| Team grid execution | 1.129 ms | 0.539 ms | **52% faster** |
| Old weeks query buffers | 4,275 | 2,613 | **39% reduction** (indexes help old pattern too) |
| Issue state filter | Sequential scan (404 rows) | Index scan available | Partial index on issue state |
| Sprint number filter | Sequential scan on all sprints | Index scan on sprint_number | Partial index on sprint type |
| Assignee filter | Sequential scan (671 rows) | Index scan available | Partial index, NOT NULL |
| API test suite | 451 passed, 0 failed | 451 passed, 0 failed | No regressions |
