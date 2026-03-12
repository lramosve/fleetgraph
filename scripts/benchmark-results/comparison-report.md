# ShipShape Audit: Before/After Benchmark Report

**Pre-merge baseline commit:** cc67d63 (master)
**Generated:** 2026-03-12

Reproducible measurements comparing `master` (before) against fix branches (after).

| Category | Metric | Before (master) | After (fix branch) | Delta | % Change |
|----------|--------|-----------------|-------------------|-------|----------|
| **1. Type Safety** | Total violations | 551 | 405 | -146 | -26.5% |
| | `as any` casts | 161 | 12 | -149 | -92.5% |
| **2. Bundle Size** | Total JS (KB) | 2197.7 | 2220.47 | | 1.0% |
| | Total gzip (KB) | 676.52 | 703.27 | | 4.0% |
| | Largest chunk (KB) | 2025.1 | 465.31 | | -77.0% |
| **3. API Response** | team/grid P50 @10c | 21ms | 13ms | | -38.1% |
| | team/grid P95 @10c | 31ms | 19.7ms | | -36.5% |
| | team/grid P50 @50c | 109ms | 74ms | | -32.1% |
| **3. API Response** | issues P50 @10c | 78ms | 82ms | | 5.1% |
| | issues P95 @10c | 97ms | 107.3ms | | 10.6% |
| | issues P50 @50c | 395ms | 411ms | | 4.1% |
| **3. API Response** | weeks P50 @10c | 16ms | 15ms | | -6.3% |
| | weeks P95 @10c | 25.7ms | 25ms | | -2.7% |
| | weeks P50 @50c | 83ms | 82ms | | -1.2% |
| **3. API Response** | dashboard/my-work P50 @10c | 19ms | 18ms | | -5.3% |
| | dashboard/my-work P95 @10c | 29.7ms | 27.3ms | | -8.1% |
| | dashboard/my-work P50 @50c | 100ms | 94ms | | -6.0% |
| **4. Query Efficiency** | Weeks buffer hits | 4275 | 2613 | -1662 | -38.9% |
| | Weeks SubPlans | 5 | 5 | 0 | |
| | Total indexes | 83 | 87 | +4 | |
| **5. Test Coverage** | Total test files | 115 | 119 | +4 | |
| | Unit test cases | 598 | 633 | +35 | |
| | Web coverage config | false | true | | |
| **6. Error Handling** | Process handlers | 0 | 2 | +2 | |
| | Express error middleware | 0 | 1 | +1 | |
| | ErrorBoundaries | 11 | 13 | +2 | |
| **7. Accessibility** | Dialogs w/ focus trap | 0/3 | 3/3 | +3 | |
| | useFocusTrap hook | false | true | | |
| | Missing form labels | 6 | 0 | -6 | |

---

## Methodology

- **Seed data:** 671 documents, 404 issues, 25 users, 35 sprints (via `scripts/seed-benchmark-data.ts`)
- **API timing:** autocannon v8.0.0 load testing at 10/25/50 concurrent connections for 10s each, reporting P50/P95/P99 latency
- **Query analysis:** PostgreSQL `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on identical seed data
- **Bundle size:** Actual file sizes on disk after `pnpm build`, independently verified with `gzip -c | wc -c`
- **Static counts:** `grep` with consistent include/exclude patterns across all branches

## How to Reproduce

To reproduce the **before** measurements after merge:
```bash
git checkout cc67d63   # pre-merge master commit
./scripts/run-benchmarks.sh  # run all categories
```

To reproduce the **after** measurements:
```bash
git checkout master          # post-merge (contains all fixes)
./scripts/run-benchmarks.sh  # run all categories
```

Results saved to `scripts/benchmark-results/`.