# Category 3: API Response Time Improvements

## Problem
`GET /api/team/grid` fetches ALL assigned issues across the entire workspace history (no date range filter), then filters them in JavaScript. As the workspace accumulates sprints, this query loads increasingly more data that will be discarded.

## Root Cause
The issues query (joining `documents` + `document_associations` + sprint documents) had no `WHERE` clause constraining sprint dates, even though `minDate`/`maxDate` were already computed for the sprint query above it.

## Change
Added date range filtering to the issues query in `api/src/routes/team.ts`:
```sql
AND (s.properties->>'start_date')::date >= $4
AND (s.properties->>'end_date')::date <= $5
```
Parameters `minDate` and `maxDate` (already available from the sprint range calculation) are passed to constrain the JOIN to only sprints within the visible grid window.

## Before/After Benchmarks

### EXPLAIN ANALYZE (PostgreSQL query plan)

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Execution time | 0.515ms | 0.200ms | **61% faster** |
| Buffer hits | 63 | 25 | **60% fewer** |
| Rows scanned from sprints | 257 (all) | filtered to range | DB-level filtering |
| Query plan | Hash joins (full scan) | Nested loop (selective) | Smarter plan |

### HTTP Response Time (5-run average, local dev, seed data)

| Metric | Before | After |
|--------|--------|-------|
| Avg response time | ~12ms | ~12ms |
| Response size | 4085 bytes | 4085 bytes |

Note: Local dev with small seed data (87 issues, 257 sprints) shows modest improvement. The impact scales with workspace size — production workspaces with thousands of historical issues and hundreds of sprints would see proportionally larger gains since only ~15 sprints (the visible window) are loaded instead of all.

### Scaling Analysis
The default grid shows `fromSprint` to `toSprint` (14 weeks). Without the filter, the query loads ALL sprint-assigned issues ever created. With the filter, it loads only the ~14-week window. For a workspace with 2 years of weekly sprints (104 sprints), this reduces the scan by ~86%.

## Also Contributes
The JSONB expression indexes from Cat 4 (`fix/query-efficiency` branch) further accelerate property-based filtering on `state`, `assignee_id`, `sprint_number`, and `owner_id`.

## Testing
- All 451 API tests pass
- No type errors
- Verified identical response payload (4085 bytes) before and after
