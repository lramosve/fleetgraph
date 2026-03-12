#!/usr/bin/env node
const fs = require('fs');
const dir = 'scripts/benchmark-results';

function load(file) {
  try { return JSON.parse(fs.readFileSync(dir + '/' + file)); } catch { return null; }
}

const m1 = load('cat1-type-safety-master.json');
const f1 = load('cat1-type-safety-fix-type-safety.json');
const m2 = load('cat2-bundle-size-master.json');
const f2 = load('cat2-bundle-size-fix-bundle-size.json');
const m3 = load('cat3-api-response-time-master.json');
const f3 = load('cat3-api-response-time-fix-api-response-time.json');
const m4 = load('cat4-query-efficiency-master.json');
const f4 = load('cat4-query-efficiency-fix-query-efficiency.json');
const m5 = load('cat5-test-coverage-master.json');
const f5 = load('cat5-test-coverage-fix-test-coverage.json');
const m6 = load('cat6-error-handling-master.json');
const f6 = load('cat6-error-handling-fix-error-handling.json');
const m7 = load('cat7-accessibility-master.json');
const f7 = load('cat7-accessibility-fix-accessibility.json');

function pct(before, after) {
  if (!before) return 'N/A';
  return ((after - before) / before * 100).toFixed(1) + '%';
}

let lines = [];
lines.push('# ShipShape Audit: Before/After Benchmark Report');
lines.push('');
lines.push('**Pre-merge baseline commit:** ' + m1.commit + ' (master)');
lines.push('**Generated:** ' + new Date().toISOString().split('T')[0]);
lines.push('');
lines.push('Reproducible measurements comparing `master` (before) against fix branches (after).');
lines.push('');
lines.push('| Category | Metric | Before (master) | After (fix branch) | Delta | % Change |');
lines.push('|----------|--------|-----------------|-------------------|-------|----------|');

// Cat 1
lines.push('| **1. Type Safety** | Total violations | ' + m1.metrics.total_violations + ' | ' + f1.metrics.total_violations + ' | ' + (f1.metrics.total_violations - m1.metrics.total_violations) + ' | ' + pct(m1.metrics.total_violations, f1.metrics.total_violations) + ' |');
lines.push('| | `as any` casts | ' + m1.metrics.as_any.total + ' | ' + f1.metrics.as_any.total + ' | ' + (f1.metrics.as_any.total - m1.metrics.as_any.total) + ' | ' + pct(m1.metrics.as_any.total, f1.metrics.as_any.total) + ' |');

// Cat 2
lines.push('| **2. Bundle Size** | Total JS (KB) | ' + m2.metrics.total_js_kb + ' | ' + f2.metrics.total_js_kb + ' | | ' + pct(m2.metrics.total_js_kb, f2.metrics.total_js_kb) + ' |');
lines.push('| | Total gzip (KB) | ' + m2.metrics.total_gzip_kb + ' | ' + f2.metrics.total_gzip_kb + ' | | ' + pct(m2.metrics.total_gzip_kb, f2.metrics.total_gzip_kb) + ' |');
lines.push('| | Largest chunk (KB) | ' + m2.metrics.largest_chunk_kb + ' | ' + f2.metrics.largest_chunk_kb + ' | | ' + pct(m2.metrics.largest_chunk_kb, f2.metrics.largest_chunk_kb) + ' |');

// Cat 3 - autocannon
const endpoints = ['/api/team/grid', '/api/issues', '/api/weeks', '/api/dashboard/my-work'];
for (const ep of endpoints) {
  const label = ep.replace('/api/', '');
  const mc = m3.metrics.autocannon[ep];
  const fc = f3.metrics.autocannon[ep];
  if (mc && fc) {
    lines.push('| **3. API Response** | ' + label + ' P50 @10c | ' + mc['10_connections'].p50_ms + 'ms | ' + fc['10_connections'].p50_ms + 'ms | | ' + pct(mc['10_connections'].p50_ms, fc['10_connections'].p50_ms) + ' |');
    lines.push('| | ' + label + ' P95 @10c | ' + mc['10_connections'].p95_ms + 'ms | ' + fc['10_connections'].p95_ms + 'ms | | ' + pct(mc['10_connections'].p95_ms, fc['10_connections'].p95_ms) + ' |');
    lines.push('| | ' + label + ' P50 @50c | ' + mc['50_connections'].p50_ms + 'ms | ' + fc['50_connections'].p50_ms + 'ms | | ' + pct(mc['50_connections'].p50_ms, fc['50_connections'].p50_ms) + ' |');
  }
}

// Cat 4
lines.push('| **4. Query Efficiency** | Weeks buffer hits | ' + m4.metrics.weeks_dashboard.shared_hit_blocks + ' | ' + f4.metrics.weeks_dashboard.shared_hit_blocks + ' | ' + (f4.metrics.weeks_dashboard.shared_hit_blocks - m4.metrics.weeks_dashboard.shared_hit_blocks) + ' | ' + pct(m4.metrics.weeks_dashboard.shared_hit_blocks, f4.metrics.weeks_dashboard.shared_hit_blocks) + ' |');
lines.push('| | Weeks SubPlans | ' + m4.metrics.weeks_dashboard.sub_plans + ' | ' + f4.metrics.weeks_dashboard.sub_plans + ' | ' + (f4.metrics.weeks_dashboard.sub_plans - m4.metrics.weeks_dashboard.sub_plans) + ' | |');
lines.push('| | Total indexes | ' + m4.metrics.total_indexes + ' | ' + f4.metrics.total_indexes + ' | +' + (f4.metrics.total_indexes - m4.metrics.total_indexes) + ' | |');

// Cat 5
lines.push('| **5. Test Coverage** | Total test files | ' + m5.metrics.total_test_files + ' | ' + f5.metrics.total_test_files + ' | +' + (f5.metrics.total_test_files - m5.metrics.total_test_files) + ' | |');
lines.push('| | Unit test cases | ' + m5.metrics.total_unit_test_cases + ' | ' + f5.metrics.total_unit_test_cases + ' | +' + (f5.metrics.total_unit_test_cases - m5.metrics.total_unit_test_cases) + ' | |');
lines.push('| | Web coverage config | ' + m5.metrics.web.has_coverage_config + ' | ' + f5.metrics.web.has_coverage_config + ' | | |');

// Cat 6
lines.push('| **6. Error Handling** | Process handlers | ' + m6.metrics.process_handlers.total + ' | ' + f6.metrics.process_handlers.total + ' | +' + (f6.metrics.process_handlers.total - m6.metrics.process_handlers.total) + ' | |');
lines.push('| | Express error middleware | ' + m6.metrics.express_error_middleware + ' | ' + f6.metrics.express_error_middleware + ' | +' + (f6.metrics.express_error_middleware - m6.metrics.express_error_middleware) + ' | |');
lines.push('| | ErrorBoundaries | ' + m6.metrics.error_boundaries + ' | ' + f6.metrics.error_boundaries + ' | +' + (f6.metrics.error_boundaries - m6.metrics.error_boundaries) + ' | |');

// Cat 7
lines.push('| **7. Accessibility** | Dialogs w/ focus trap | ' + m7.metrics.dialogs_with_focus_trap + '/' + m7.metrics.dialogs_total + ' | ' + f7.metrics.dialogs_with_focus_trap + '/' + f7.metrics.dialogs_total + ' | +' + (f7.metrics.dialogs_with_focus_trap - m7.metrics.dialogs_with_focus_trap) + ' | |');
lines.push('| | useFocusTrap hook | ' + m7.metrics.has_focus_trap_hook + ' | ' + f7.metrics.has_focus_trap_hook + ' | | |');
lines.push('| | Missing form labels | ' + m7.metrics.admin_missing_labels_estimate + ' | ' + f7.metrics.admin_missing_labels_estimate + ' | ' + (f7.metrics.admin_missing_labels_estimate - m7.metrics.admin_missing_labels_estimate) + ' | |');

lines.push('');
lines.push('---');
lines.push('');
lines.push('## Methodology');
lines.push('');
lines.push('- **Seed data:** 671 documents, 404 issues, 25 users, 35 sprints (via `scripts/seed-benchmark-data.ts`)');
lines.push('- **API timing:** autocannon v8.0.0 load testing at 10/25/50 concurrent connections for 10s each, reporting P50/P95/P99 latency');
lines.push('- **Query analysis:** PostgreSQL `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on identical seed data');
lines.push('- **Bundle size:** Actual file sizes on disk after `pnpm build`, independently verified with `gzip -c | wc -c`');
lines.push('- **Static counts:** `grep` with consistent include/exclude patterns across all branches');
lines.push('');
lines.push('## How to Reproduce');
lines.push('');
lines.push('To reproduce the **before** measurements after merge:');
lines.push('```bash');
lines.push('git checkout ' + m1.commit + '   # pre-merge master commit');
lines.push('./scripts/run-benchmarks.sh  # run all categories');
lines.push('```');
lines.push('');
lines.push('To reproduce the **after** measurements:');
lines.push('```bash');
lines.push('git checkout master          # post-merge (contains all fixes)');
lines.push('./scripts/run-benchmarks.sh  # run all categories');
lines.push('```');
lines.push('');
lines.push('Results saved to `scripts/benchmark-results/`.');

const report = lines.join('\n');
fs.writeFileSync(dir + '/comparison-report.md', report);
console.log(report);
