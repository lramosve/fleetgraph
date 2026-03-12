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

### Load Testing (autocannon v8.0.0)

**Seed data:** 671 documents, 404 issues, 25 users, 35 sprints

#### `/api/team/grid` (primary endpoint improved)

| Connections | Metric | Before (master) | After (fix) | Improvement |
|-------------|--------|-----------------|-------------|-------------|
| 10 | P50 | 21ms | 13ms | **38% faster** |
| 10 | P95 | 31ms | 19.7ms | **36% faster** |
| 10 | P99 | 38ms | 25ms | **34% faster** |
| 25 | P50 | 53ms | 38ms | **28% faster** |
| 25 | P95 | 66.7ms | 59.3ms | **11% faster** |
| 50 | P50 | 109ms | 74ms | **32% faster** |
| 50 | P95 | 141.3ms | 102.3ms | **28% faster** |
| 50 | P99 | 158ms | 128ms | **19% faster** |

#### Other endpoints (control — no changes expected)

| Endpoint | Connections | Before P50 | After P50 | Delta |
|----------|-------------|------------|-----------|-------|
| `/api/issues` | 10 | 78ms | 82ms | ~same |
| `/api/issues` | 50 | 395ms | 411ms | ~same |
| `/api/weeks` | 10 | 16ms | 15ms | ~same |
| `/api/weeks` | 50 | 83ms | 82ms | ~same |
| `/api/dashboard/my-work` | 10 | 19ms | 18ms | ~same |
| `/api/dashboard/my-work` | 50 | 100ms | 94ms | ~same |

### EXPLAIN ANALYZE (PostgreSQL query plan)

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Execution time | 0.515ms | 0.200ms | **61% faster** |
| Buffer hits | 63 | 25 | **60% fewer** |
| Rows scanned from sprints | 257 (all) | filtered to range | DB-level filtering |
| Query plan | Hash joins (full scan) | Nested loop (selective) | Smarter plan |

### Scaling Analysis
The default grid shows `fromSprint` to `toSprint` (14 weeks). Without the filter, the query loads ALL sprint-assigned issues ever created. With the filter, it loads only the ~14-week window. For a workspace with 2 years of weekly sprints (104 sprints), this reduces the scan by ~86%.

## Methodology

- **Tool:** autocannon v8.0.0 (`npm install -g autocannon`)
- **Protocol:** 10-second runs at 10/25/50 concurrent connections per endpoint
- **Auth:** Session cookie obtained via `/api/csrf-token` + `/api/auth/login`
- **Rate limit:** Disabled for benchmarks via `BENCHMARK_NO_RATE_LIMIT=1` env var
- **P95 calculation:** Interpolated from autocannon's P90 and P97.5: `P95 = P90 + (P97.5 - P90) x 0.667`
- **Reproducible:** Run `./scripts/run-benchmarks.sh --category 3` on master and this branch

## Also Contributes
The JSONB expression indexes from Cat 4 (`fix/query-efficiency` branch) further accelerate property-based filtering on `state`, `assignee_id`, `sprint_number`, and `owner_id`.

## Testing
- All API tests pass
- No type errors
- Verified identical response payload before and after
