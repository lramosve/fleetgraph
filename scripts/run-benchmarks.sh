#!/usr/bin/env bash
#
# Reproducible benchmark suite for ShipShape audit improvements.
# Measures before/after metrics for all 7 audit categories.
#
# Usage:
#   ./scripts/run-benchmarks.sh                    # Measure all categories
#   ./scripts/run-benchmarks.sh --category 1       # Measure single category
#   ./scripts/run-benchmarks.sh --category 3,4     # Measure specific categories
#   ./scripts/run-benchmarks.sh --report           # Generate comparison report
#
# Results are saved to scripts/benchmark-results/{cat}-{branch}.json
# Use --report to compare the current branch against master.
#
# Requirements:
#   - PostgreSQL running locally (for categories 3, 4)
#   - Node.js / pnpm installed
#   - Git repository with fix/* branches
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/benchmark-results"
BENCH_API_PORT=3099
API_PID=""
API_ALREADY_RUNNING=false
COOKIES_FILE="$RESULTS_DIR/.cookies.txt"

# ── Argument parsing ──────────────────────────────────────────────

CATEGORIES=""
REPORT_MODE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --category|-c) CATEGORIES="$2"; shift 2 ;;
    --report|-r)   REPORT_MODE=true; shift ;;
    --help|-h)
      head -18 "$0" | tail -16
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -z "$CATEGORIES" ] && [ "$REPORT_MODE" = false ]; then
  CATEGORIES="1,2,3,4,5,6,7"
fi

# ── Shared utilities ──────────────────────────────────────────────

BRANCH=$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)
BRANCH_SAFE=$(echo "$BRANCH" | tr '/' '-')
COMMIT=$(git -C "$ROOT_DIR" rev-parse --short HEAD)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

mkdir -p "$RESULTS_DIR"

log() { echo "[benchmark] $*"; }
err() { echo "[benchmark] ERROR: $*" >&2; }

# Load DATABASE_URL from api/.env.local
load_db_url() {
  local env_file="$ROOT_DIR/api/.env.local"
  if [ -f "$env_file" ]; then
    DATABASE_URL=$(grep -E '^DATABASE_URL=' "$env_file" | head -1 | cut -d= -f2-)
    export DATABASE_URL
  fi
  if [ -z "${DATABASE_URL:-}" ]; then
    env_file="$ROOT_DIR/api/.env"
    if [ -f "$env_file" ]; then
      DATABASE_URL=$(grep -E '^DATABASE_URL=' "$env_file" | head -1 | cut -d= -f2-)
      export DATABASE_URL
    fi
  fi
}

# Docker container name for PostgreSQL (fallback when psql not in PATH)
PG_CONTAINER="shipshape-postgres-1"
USE_DOCKER_PSQL=false

# Wrapper: run psql command via local binary or docker exec
db_query() {
  local flags="$1"
  local sql="$2"
  if [ "$USE_DOCKER_PSQL" = true ]; then
    docker exec "$PG_CONTAINER" psql -U ship -d ship_dev $flags -c "$sql" 2>/dev/null
  else
    psql "$DATABASE_URL" $flags -c "$sql" 2>/dev/null
  fi
}

require_postgres() {
  load_db_url
  # Try local psql first
  if command -v psql > /dev/null 2>&1; then
    if psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
      log "Using local psql"
      return 0
    fi
  fi
  # Fall back to docker exec
  if command -v docker > /dev/null 2>&1; then
    if docker exec "$PG_CONTAINER" psql -U ship -d ship_dev -c "SELECT 1" > /dev/null 2>&1; then
      USE_DOCKER_PSQL=true
      log "Using psql via docker exec ($PG_CONTAINER)"
      return 0
    fi
  fi
  err "PostgreSQL is not accessible."
  err "Either install psql locally, or ensure Docker container '$PG_CONTAINER' is running."
  return 1
}

ensure_seed_data() {
  local doc_count
  doc_count=$(db_query "-t" "SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL" | tr -d ' ')
  if [ "${doc_count:-0}" -lt 400 ]; then
    log "Seeding benchmark data (current: $doc_count docs, need 400+)..."
    cd "$ROOT_DIR"
    pnpm --filter api run db:seed 2>&1 | tail -5
    pnpm --filter api exec tsx ../scripts/seed-benchmark-data.ts 2>&1 | tail -5
    cd "$SCRIPT_DIR"
  else
    log "Seed data sufficient ($doc_count documents)"
  fi
}

get_seed_counts() {
  local docs issues users sprints
  docs=$(db_query "-t" "SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL" | tr -d ' ')
  issues=$(db_query "-t" "SELECT COUNT(*) FROM documents WHERE document_type = 'issue' AND deleted_at IS NULL" | tr -d ' ')
  users=$(db_query "-t" "SELECT COUNT(*) FROM users" | tr -d ' ')
  sprints=$(db_query "-t" "SELECT COUNT(*) FROM documents WHERE document_type = 'sprint' AND deleted_at IS NULL" | tr -d ' ')
  echo "\"seed_data\": { \"documents\": $docs, \"issues\": $issues, \"users\": $users, \"sprints\": $sprints }"
}

start_api_server() {
  if curl -s "http://localhost:${BENCH_API_PORT}/health" > /dev/null 2>&1; then
    API_ALREADY_RUNNING=true
    log "API server already running on port $BENCH_API_PORT"
    return 0
  fi

  log "Starting API server on port $BENCH_API_PORT..."
  cd "$ROOT_DIR"

  # Build shared types first
  pnpm build:shared > /dev/null 2>&1

  # Start API in background with BENCHMARK_NO_RATE_LIMIT=1 to disable rate limiting for load tests
  BENCHMARK_NO_RATE_LIMIT=1 PORT=$BENCH_API_PORT pnpm --filter api exec tsx src/index.ts > "$RESULTS_DIR/.api-server.log" 2>&1 &
  API_PID=$!

  # Wait for health check (max 30s)
  for i in $(seq 1 30); do
    if curl -s "http://localhost:${BENCH_API_PORT}/health" > /dev/null 2>&1; then
      log "API server ready (PID=$API_PID)"
      return 0
    fi
    sleep 1
  done

  err "API server failed to start within 30s. Check $RESULTS_DIR/.api-server.log"
  return 1
}

stop_api_server() {
  if [ -n "$API_PID" ] && [ "$API_ALREADY_RUNNING" = false ]; then
    log "Stopping API server (PID=$API_PID)"
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
    API_PID=""
  fi
}

get_session_cookie() {
  # Step 1: Get CSRF token (required for login)
  local csrf_resp
  csrf_resp=$(curl -s -c "$COOKIES_FILE" "http://localhost:${BENCH_API_PORT}/api/csrf-token" 2>/dev/null)
  local csrf_token
  csrf_token=$(echo "$csrf_resp" | grep -oE '"token":"[^"]+"' | cut -d'"' -f4)

  # Step 2: Login with CSRF token
  curl -s -b "$COOKIES_FILE" -c "$COOKIES_FILE" \
    -X POST "http://localhost:${BENCH_API_PORT}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -H "x-csrf-token: $csrf_token" \
    -d '{"email":"dev@ship.local","password":"admin123"}' \
    > /dev/null 2>&1
}

# Timed API request: returns time in ms (5 runs, median)
timed_request() {
  local endpoint="$1"
  local times=()

  # Warm-up request
  curl -s -b "$COOKIES_FILE" "http://localhost:${BENCH_API_PORT}${endpoint}" > /dev/null 2>&1

  for i in $(seq 1 5); do
    local t
    t=$(curl -s -o /dev/null -w '%{time_total}' -b "$COOKIES_FILE" \
        "http://localhost:${BENCH_API_PORT}${endpoint}" 2>/dev/null)
    # Convert seconds to ms (integer)
    local ms
    ms=$(echo "$t" | awk '{printf "%.0f", $1 * 1000}')
    times+=("$ms")
  done

  # Sort and take median (3rd of 5)
  local sorted
  sorted=$(printf '%s\n' "${times[@]}" | sort -n)
  local median
  median=$(echo "$sorted" | sed -n '3p')
  local p95
  p95=$(echo "$sorted" | sed -n '5p')

  echo "\"${endpoint}\": { \"times_ms\": [$(IFS=,; echo "${times[*]}")], \"median_ms\": $median, \"p95_ms\": $p95 }"
}

trap stop_api_server EXIT

# ── Category 1: Type Safety ──────────────────────────────────────

measure_cat1() {
  log "Category 1: Type Safety"
  local outfile="$RESULTS_DIR/cat1-type-safety-${BRANCH_SAFE}.json"

  # Count patterns across api/src and web/src (exclude node_modules, dist, .d.ts)
  local as_any_api as_any_web colon_any_api colon_any_web
  local type_assert_api type_assert_web nonnull_api nonnull_web
  local ts_expect_api ts_expect_web

  cd "$ROOT_DIR"

  # as any
  as_any_api=$(grep -rn --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=dist 'as any' api/src/ 2>/dev/null | grep -v '\.d\.ts' | wc -l | tr -d ' ')
  as_any_web=$(grep -rn --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=dist 'as any' web/src/ 2>/dev/null | grep -v '\.d\.ts' | wc -l | tr -d ' ')

  # : any (explicit any type annotation — match ": any" but not "as any")
  colon_any_api=$(grep -rnE ':[[:space:]]*any\b' --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=dist api/src/ 2>/dev/null | grep -v '\.d\.ts' | wc -l | tr -d ' ')
  colon_any_web=$(grep -rnE ':[[:space:]]*any\b' --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=dist web/src/ 2>/dev/null | grep -v '\.d\.ts' | wc -l | tr -d ' ')

  # as Type (type assertions excluding "as any" and "as const")
  type_assert_api=$(grep -rnE '\bas[[:space:]]+[A-Z]' --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=dist api/src/ 2>/dev/null | grep -v '\.d\.ts' | grep -v 'as any' | wc -l | tr -d ' ')
  type_assert_web=$(grep -rnE '\bas[[:space:]]+[A-Z]' --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=dist web/src/ 2>/dev/null | grep -v '\.d\.ts' | grep -v 'as any' | wc -l | tr -d ' ')

  # Non-null assertions (!.)
  nonnull_api=$(grep -rnE '!\.' --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=dist api/src/ 2>/dev/null | grep -v '\.d\.ts' | grep -v '!=\.' | wc -l | tr -d ' ')
  nonnull_web=$(grep -rnE '!\.' --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=dist web/src/ 2>/dev/null | grep -v '\.d\.ts' | grep -v '!=\.' | wc -l | tr -d ' ')

  # @ts-expect-error
  ts_expect_api=$(grep -rn '@ts-expect-error\|@ts-ignore' --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=dist api/src/ 2>/dev/null | wc -l | tr -d ' ')
  ts_expect_web=$(grep -rn '@ts-expect-error\|@ts-ignore' --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=dist web/src/ 2>/dev/null | wc -l | tr -d ' ')

  local total=$(( as_any_api + as_any_web + colon_any_api + colon_any_web + type_assert_api + type_assert_web + nonnull_api + nonnull_web + ts_expect_api + ts_expect_web ))

  cat > "$outfile" <<EOF
{
  "category": "type-safety",
  "branch": "$BRANCH",
  "commit": "$COMMIT",
  "timestamp": "$TIMESTAMP",
  "metrics": {
    "as_any": { "api": $as_any_api, "web": $as_any_web, "total": $(( as_any_api + as_any_web )) },
    "colon_any": { "api": $colon_any_api, "web": $colon_any_web, "total": $(( colon_any_api + colon_any_web )) },
    "type_assertions": { "api": $type_assert_api, "web": $type_assert_web, "total": $(( type_assert_api + type_assert_web )) },
    "non_null_assertions": { "api": $nonnull_api, "web": $nonnull_web, "total": $(( nonnull_api + nonnull_web )) },
    "ts_directives": { "api": $ts_expect_api, "web": $ts_expect_web, "total": $(( ts_expect_api + ts_expect_web )) },
    "total_violations": $total
  }
}
EOF

  log "  Total violations: $total"
  log "  Results: $outfile"
}

# ── Category 2: Bundle Size ──────────────────────────────────────

measure_cat2() {
  log "Category 2: Bundle Size"
  local outfile="$RESULTS_DIR/cat2-bundle-size-${BRANCH_SAFE}.json"

  cd "$ROOT_DIR"

  # Clean previous build and rebuild
  rm -rf "$ROOT_DIR/web/dist"
  pnpm build:shared > /dev/null 2>&1

  # Build web (run tsc and vite separately for Windows compatibility)
  cd "$ROOT_DIR/web"
  pnpm exec tsc > /dev/null 2>&1
  VITE_API_URL="" pnpm exec vite build > /dev/null 2>&1
  cd "$ROOT_DIR"

  # Parse chunk data from build output and measure actual files
  local total_js_bytes=0
  local total_gzip_bytes=0
  local chunk_count=0
  local largest_chunk_bytes=0
  local chunks_json="["
  local first=true

  for jsfile in "$ROOT_DIR"/web/dist/assets/*.js; do
    if [ ! -f "$jsfile" ]; then continue; fi
    local fname
    fname=$(basename "$jsfile")
    local raw_bytes
    raw_bytes=$(wc -c < "$jsfile" | tr -d ' ')
    local gzip_bytes
    gzip_bytes=$(gzip -c "$jsfile" | wc -c | tr -d ' ')
    local raw_kb
    raw_kb=$(echo "$raw_bytes" | awk '{printf "%.2f", $1/1024}')
    local gzip_kb
    gzip_kb=$(echo "$gzip_bytes" | awk '{printf "%.2f", $1/1024}')

    total_js_bytes=$(( total_js_bytes + raw_bytes ))
    total_gzip_bytes=$(( total_gzip_bytes + gzip_bytes ))
    chunk_count=$(( chunk_count + 1 ))

    if [ "$raw_bytes" -gt "$largest_chunk_bytes" ]; then
      largest_chunk_bytes=$raw_bytes
    fi

    if [ "$first" = true ]; then first=false; else chunks_json="$chunks_json,"; fi
    chunks_json="$chunks_json { \"name\": \"$fname\", \"size_kb\": $raw_kb, \"gzip_kb\": $gzip_kb }"
  done
  chunks_json="$chunks_json ]"

  local total_js_kb
  total_js_kb=$(echo "$total_js_bytes" | awk '{printf "%.2f", $1/1024}')
  local total_gzip_kb
  total_gzip_kb=$(echo "$total_gzip_bytes" | awk '{printf "%.2f", $1/1024}')
  local largest_kb
  largest_kb=$(echo "$largest_chunk_bytes" | awk '{printf "%.2f", $1/1024}')

  # Count CSS chunks too
  local css_bytes=0
  for cssfile in "$ROOT_DIR"/web/dist/assets/*.css; do
    if [ ! -f "$cssfile" ]; then continue; fi
    local cb
    cb=$(wc -c < "$cssfile" | tr -d ' ')
    css_bytes=$(( css_bytes + cb ))
  done
  local css_kb
  css_kb=$(echo "$css_bytes" | awk '{printf "%.2f", $1/1024}')

  cat > "$outfile" <<EOF
{
  "category": "bundle-size",
  "branch": "$BRANCH",
  "commit": "$COMMIT",
  "timestamp": "$TIMESTAMP",
  "metrics": {
    "total_js_kb": $total_js_kb,
    "total_gzip_kb": $total_gzip_kb,
    "total_css_kb": $css_kb,
    "js_chunk_count": $chunk_count,
    "largest_chunk_kb": $largest_kb,
    "chunks": $chunks_json
  }
}
EOF

  log "  Total JS: ${total_js_kb} KB (gzip: ${total_gzip_kb} KB), ${chunk_count} chunks"
  log "  Largest chunk: ${largest_kb} KB"
  log "  Results: $outfile"
}

# ── Category 3: API Response Time ────────────────────────────────

measure_cat3() {
  log "Category 3: API Response Time"
  local outfile="$RESULTS_DIR/cat3-api-response-time-${BRANCH_SAFE}.json"

  if ! require_postgres; then return 1; fi
  ensure_seed_data
  start_api_server
  get_session_cookie

  local seed_counts
  seed_counts=$(get_seed_counts)

  # Extract session cookie for autocannon
  local cookie_val=""
  if [ -f "$COOKIES_FILE" ]; then
    cookie_val=$(grep -E 'session_id' "$COOKIES_FILE" | awk '{print $NF}' | head -1)
  fi
  local cookie_header=""
  if [ -n "$cookie_val" ]; then
    cookie_header="session_id=${cookie_val}"
  fi
  log "  Auth cookie: ${cookie_header:0:30}..."

  local base_url="http://localhost:${BENCH_API_PORT}"
  local endpoints=("/api/team/grid" "/api/issues" "/api/weeks" "/api/dashboard/my-work")
  local connections=(10 25 50)
  local duration=10  # seconds per run

  # Build endpoint results JSON
  local endpoints_json=""
  local first_ep=true

  for ep in "${endpoints[@]}"; do
    log "  Testing $ep with autocannon..."
    local ep_json=""
    local first_conn=true

    for conn in "${connections[@]}"; do
      log "    ${conn} connections, ${duration}s..."
      local ac_output
      if [ -n "$cookie_header" ]; then
        ac_output=$(autocannon -c "$conn" -d "$duration" -j \
          -H "Cookie: $cookie_header" \
          "${base_url}${ep}" 2>/dev/null)
      else
        ac_output=$(autocannon -c "$conn" -d "$duration" -j \
          "${base_url}${ep}" 2>/dev/null)
      fi

      # Extract latency percentiles from autocannon JSON (single-line output)
      # autocannon provides p50, p90, p97_5, p99 — we interpolate p95 from p90 and p97_5
      # P95 ≈ p90 + (p97_5 - p90) × (95-90)/(97.5-90) = p90 + (p97_5 - p90) × 0.667
      local p50 p90 p97_5 p99 p95 avg_lat rps_avg total_2xx total_non2xx total_errors
      p50=$(echo "$ac_output" | grep -oE '"latency":\{[^}]+\}' | grep -oE '"p50":[0-9.]+' | grep -oE '[0-9.]+$' || echo "0")
      p90=$(echo "$ac_output" | grep -oE '"latency":\{[^}]+\}' | grep -oE '"p90":[0-9.]+' | grep -oE '[0-9.]+$' || echo "0")
      p97_5=$(echo "$ac_output" | grep -oE '"latency":\{[^}]+\}' | grep -oE '"p97_5":[0-9.]+' | grep -oE '[0-9.]+$' || echo "0")
      p99=$(echo "$ac_output" | grep -oE '"latency":\{[^}]+\}' | grep -oE '"p99":[0-9.]+' | grep -oE '[0-9.]+$' || echo "0")
      p95=$(echo "$p90 $p97_5" | awk '{printf "%.1f", $1 + ($2 - $1) * 0.667}')
      avg_lat=$(echo "$ac_output" | grep -oE '"latency":\{[^}]+\}' | grep -oE '"average":[0-9.]+' | grep -oE '[0-9.]+$' || echo "0")
      rps_avg=$(echo "$ac_output" | grep -oE '"requests":\{[^}]+\}' | grep -oE '"average":[0-9.]+' | grep -oE '[0-9.]+$' || echo "0")
      total_2xx=$(echo "$ac_output" | grep -oE '"2xx":[0-9]+' | head -1 | grep -oE '[0-9]+$' || echo "0")
      total_non2xx=$(echo "$ac_output" | grep -oE '"non2xx":[0-9]+' | head -1 | grep -oE '[0-9]+$' || echo "0")
      total_errors=$(echo "$ac_output" | grep -oE '"errors":[0-9]+' | head -1 | grep -oE '[0-9]+$' || echo "0")

      local conn_json="\"${conn}_connections\": { \"p50_ms\": $p50, \"p95_ms\": $p95, \"p99_ms\": $p99, \"avg_ms\": $avg_lat, \"rps\": $rps_avg, \"total_2xx\": $total_2xx, \"non2xx\": $total_non2xx, \"errors\": $total_errors }"

      if [ "$first_conn" = true ]; then first_conn=false; else conn_json=", $conn_json"; fi
      ep_json="${ep_json}${conn_json}"
    done

    local ep_entry="\"${ep}\": { $ep_json }"
    if [ "$first_ep" = true ]; then first_ep=false; else ep_entry=", $ep_entry"; fi
    endpoints_json="${endpoints_json}${ep_entry}"
  done

  # Also keep simple curl median for quick reference
  local grid_curl issues_curl
  grid_curl=$(timed_request "/api/team/grid")
  issues_curl=$(timed_request "/api/issues")

  cat > "$outfile" <<EOF
{
  "category": "api-response-time",
  "branch": "$BRANCH",
  "commit": "$COMMIT",
  "timestamp": "$TIMESTAMP",
  $seed_counts,
  "tool": "autocannon $(autocannon --version 2>/dev/null | head -1 || echo 'unknown')",
  "test_config": {
    "connections": [10, 25, 50],
    "duration_seconds": $duration
  },
  "metrics": {
    "autocannon": {
      $endpoints_json
    },
    "curl_baseline": {
      $grid_curl,
      $issues_curl
    }
  }
}
EOF

  log "  Results: $outfile"
}

# ── Category 4: DB Query Efficiency ──────────────────────────────

measure_cat4() {
  log "Category 4: Database Query Efficiency"
  local outfile="$RESULTS_DIR/cat4-query-efficiency-${BRANCH_SAFE}.json"

  if ! require_postgres; then return 1; fi
  ensure_seed_data

  local seed_counts
  seed_counts=$(get_seed_counts)

  # Get workspace_id and user_id for dev@ship.local
  local workspace_id user_id
  workspace_id=$(db_query "-t" "SELECT id FROM workspaces LIMIT 1" | tr -d ' ')
  user_id=$(db_query "-t" "SELECT id FROM users WHERE LOWER(email) = 'dev@ship.local'" | tr -d ' ')

  # Get current sprint number
  local sprint_start_date current_sprint_number
  sprint_start_date=$(db_query "-t" "SELECT sprint_start_date FROM workspaces WHERE id = '$workspace_id'" | tr -d ' ')

  # Calculate date range for team grid (14 weeks around today)
  local min_date max_date
  min_date=$(date -u -d "98 days ago" +%Y-%m-%d 2>/dev/null || date -u -v-98d +%Y-%m-%d 2>/dev/null || echo "2025-12-01")
  max_date=$(date -u -d "+98 days" +%Y-%m-%d 2>/dev/null || date -u -v+98d +%Y-%m-%d 2>/dev/null || echo "2026-06-30")

  # Query 1: Weeks dashboard (the one with correlated subqueries on master)
  log "  Running EXPLAIN ANALYZE on weeks dashboard query..."
  local weeks_explain
  weeks_explain=$(db_query "-t" "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT d.id, d.title, d.properties, (SELECT COUNT(*) FROM documents i JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint' WHERE i.document_type = 'issue') as issue_count, (SELECT COUNT(*) FROM documents i JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint' WHERE i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count, (SELECT COUNT(*) FROM documents i JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint' WHERE i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count, (SELECT COUNT(*) > 0 FROM documents pl WHERE pl.parent_id = d.id AND pl.document_type = 'weekly_plan') as has_plan, (SELECT COUNT(*) > 0 FROM documents rt JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint' WHERE rt.properties->>'outcome' IS NOT NULL) as has_retro FROM documents d WHERE d.workspace_id = '$workspace_id' AND d.document_type = 'sprint' ORDER BY (d.properties->>'sprint_number')::int")

  # Extract key metrics from EXPLAIN JSON
  local weeks_exec_time weeks_plan_time weeks_buffers weeks_subplans
  weeks_exec_time=$(echo "$weeks_explain" | grep -oE '"Execution Time":[[:space:]]*[0-9.]+' | head -1 | grep -oE '[0-9.]+$' || echo "0")
  weeks_plan_time=$(echo "$weeks_explain" | grep -oE '"Planning Time":[[:space:]]*[0-9.]+' | head -1 | grep -oE '[0-9.]+$' || echo "0")
  weeks_buffers=$(echo "$weeks_explain" | grep -oE '"Shared Hit Blocks":[[:space:]]*[0-9]+' | head -1 | grep -oE '[0-9]+$' || echo "0")
  weeks_subplans=$(echo "$weeks_explain" | grep -c '"SubPlan"' || echo "0")

  # Query 2: Team grid issues query
  log "  Running EXPLAIN ANALYZE on team grid issues query..."
  local grid_explain
  grid_explain=$(db_query "-t" "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT i.id, i.title, da_sprint.related_id as sprint_id, i.properties->>'assignee_id' as assignee_id, i.properties->>'state' as state FROM documents i JOIN document_associations da_sprint ON da_sprint.document_id = i.id AND da_sprint.relationship_type = 'sprint' JOIN documents s ON s.id = da_sprint.related_id WHERE i.workspace_id = '$workspace_id' AND i.document_type = 'issue' AND i.properties->>'assignee_id' IS NOT NULL")

  local grid_exec_time grid_plan_time grid_buffers grid_rows
  grid_exec_time=$(echo "$grid_explain" | grep -oE '"Execution Time":[[:space:]]*[0-9.]+' | head -1 | grep -oE '[0-9.]+$' || echo "0")
  grid_plan_time=$(echo "$grid_explain" | grep -oE '"Planning Time":[[:space:]]*[0-9.]+' | head -1 | grep -oE '[0-9.]+$' || echo "0")
  grid_buffers=$(echo "$grid_explain" | grep -oE '"Shared Hit Blocks":[[:space:]]*[0-9]+' | head -1 | grep -oE '[0-9]+$' || echo "0")
  grid_rows=$(echo "$grid_explain" | grep -oE '"Actual Rows":[[:space:]]*[0-9]+' | head -1 | grep -oE '[0-9]+$' || echo "0")

  # Query 3: Issues listing
  log "  Running EXPLAIN ANALYZE on issues listing query..."
  local issues_explain
  issues_explain=$(db_query "-t" "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT d.id, d.title, d.properties, d.ticket_number FROM documents d WHERE d.workspace_id = '$workspace_id' AND d.document_type = 'issue' AND d.deleted_at IS NULL ORDER BY d.created_at DESC")

  local issues_exec_time issues_buffers issues_rows
  issues_exec_time=$(echo "$issues_explain" | grep -oE '"Execution Time":[[:space:]]*[0-9.]+' | head -1 | grep -oE '[0-9.]+$' || echo "0")
  issues_buffers=$(echo "$issues_explain" | grep -oE '"Shared Hit Blocks":[[:space:]]*[0-9]+' | head -1 | grep -oE '[0-9]+$' || echo "0")
  issues_rows=$(echo "$issues_explain" | grep -oE '"Actual Rows":[[:space:]]*[0-9]+' | head -1 | grep -oE '[0-9]+$' || echo "0")

  # Count indexes
  local index_count
  index_count=$(db_query "-t" "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public'" | tr -d ' ')

  cat > "$outfile" <<EOF
{
  "category": "query-efficiency",
  "branch": "$BRANCH",
  "commit": "$COMMIT",
  "timestamp": "$TIMESTAMP",
  $seed_counts,
  "metrics": {
    "weeks_dashboard": {
      "execution_time_ms": $weeks_exec_time,
      "planning_time_ms": $weeks_plan_time,
      "shared_hit_blocks": $weeks_buffers,
      "sub_plans": $weeks_subplans
    },
    "team_grid_issues": {
      "execution_time_ms": $grid_exec_time,
      "planning_time_ms": $grid_plan_time,
      "shared_hit_blocks": $grid_buffers,
      "actual_rows": $grid_rows
    },
    "issues_listing": {
      "execution_time_ms": $issues_exec_time,
      "shared_hit_blocks": $issues_buffers,
      "actual_rows": $issues_rows
    },
    "total_indexes": $index_count
  }
}
EOF

  log "  Weeks: ${weeks_exec_time}ms exec, ${weeks_buffers} buffers, ${weeks_subplans} SubPlans"
  log "  Grid:  ${grid_exec_time}ms exec, ${grid_buffers} buffers"
  log "  Results: $outfile"
}

# ── Category 5: Test Coverage ────────────────────────────────────

measure_cat5() {
  log "Category 5: Test Coverage"
  local outfile="$RESULTS_DIR/cat5-test-coverage-${BRANCH_SAFE}.json"

  cd "$ROOT_DIR"

  # Count test files
  local api_test_files web_test_files
  api_test_files=$(find api/src -name '*.test.ts' -o -name '*.test.tsx' 2>/dev/null | wc -l | tr -d ' ')
  web_test_files=$(find web/src -name '*.test.ts' -o -name '*.test.tsx' 2>/dev/null | wc -l | tr -d ' ')

  # Count test cases (it( or test( calls)
  local api_test_cases web_test_cases
  api_test_cases=$(grep -rn --include='*.test.ts' --include='*.test.tsx' -E '\b(it|test)\(' api/src/ 2>/dev/null | wc -l | tr -d ' ')
  web_test_cases=$(grep -rn --include='*.test.ts' --include='*.test.tsx' -E '\b(it|test)\(' web/src/ 2>/dev/null | wc -l | tr -d ' ')

  # Check for coverage config in web
  local web_has_coverage=false
  if grep -q 'coverage' "$ROOT_DIR/web/vitest.config.ts" 2>/dev/null; then
    web_has_coverage=true
  fi

  # Check for coverage config in api
  local api_has_coverage=false
  if grep -q 'coverage' "$ROOT_DIR/api/vitest.config.ts" 2>/dev/null; then
    api_has_coverage=true
  fi

  # Count e2e test files
  local e2e_test_files=0
  if [ -d "$ROOT_DIR/e2e" ]; then
    e2e_test_files=$(find "$ROOT_DIR/e2e" -name '*.spec.ts' -o -name '*.test.ts' 2>/dev/null | wc -l | tr -d ' ')
  fi

  local total_files=$(( api_test_files + web_test_files + e2e_test_files ))
  local total_cases=$(( api_test_cases + web_test_cases ))

  cat > "$outfile" <<EOF
{
  "category": "test-coverage",
  "branch": "$BRANCH",
  "commit": "$COMMIT",
  "timestamp": "$TIMESTAMP",
  "metrics": {
    "api": {
      "test_files": $api_test_files,
      "test_cases": $api_test_cases,
      "has_coverage_config": $api_has_coverage
    },
    "web": {
      "test_files": $web_test_files,
      "test_cases": $web_test_cases,
      "has_coverage_config": $web_has_coverage
    },
    "e2e": {
      "test_files": $e2e_test_files
    },
    "total_test_files": $total_files,
    "total_unit_test_cases": $total_cases
  }
}
EOF

  log "  API: $api_test_files files, $api_test_cases cases (coverage: $api_has_coverage)"
  log "  Web: $web_test_files files, $web_test_cases cases (coverage: $web_has_coverage)"
  log "  E2E: $e2e_test_files spec files"
  log "  Results: $outfile"
}

# ── Category 6: Error Handling ───────────────────────────────────

measure_cat6() {
  log "Category 6: Error Handling"
  local outfile="$RESULTS_DIR/cat6-error-handling-${BRANCH_SAFE}.json"

  cd "$ROOT_DIR"

  # Process-level handlers
  local uncaught_exception unhandled_rejection
  uncaught_exception=$(grep -rn "process\.on.*uncaughtException" --include='*.ts' api/src/ 2>/dev/null | grep -v node_modules | grep -v '\.test\.' | wc -l | tr -d ' ')
  unhandled_rejection=$(grep -rn "process\.on.*unhandledRejection" --include='*.ts' api/src/ 2>/dev/null | grep -v node_modules | grep -v '\.test\.' | wc -l | tr -d ' ')

  # Express error middleware (4-arg handler: err, req, res, next — with optional type annotations)
  local express_error_middleware
  express_error_middleware=$(grep -rnE '\(err[^,)]*,[[:space:]]*(req|_req|_)[^,)]*,[[:space:]]*(res|_res|_)[^,)]*,[[:space:]]*(next|_next|_)' --include='*.ts' api/src/ 2>/dev/null | grep -v node_modules | grep -v '\.test\.' | wc -l | tr -d ' ')

  # ErrorBoundary component usages in web
  local error_boundaries
  error_boundaries=$(grep -rn 'ErrorBoundary' --include='*.tsx' --include='*.ts' web/src/ 2>/dev/null | grep -v node_modules | grep -v '\.test\.' | grep -v 'import' | wc -l | tr -d ' ')

  # Silent catches: .catch(() => {}) or catch (e) {} with empty body
  local silent_catches
  silent_catches=$(grep -rnE '\.catch\([[:space:]]*\(\)[[:space:]]*=>[[:space:]]*\{?[[:space:]]*\}?[[:space:]]*\)' --include='*.ts' --include='*.tsx' api/src/ web/src/ 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')

  # Empty catch blocks
  local empty_catches
  empty_catches=$(grep -rnE 'catch[[:space:]]*\([^)]*\)[[:space:]]*\{[[:space:]]*\}' --include='*.ts' --include='*.tsx' api/src/ web/src/ 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')

  # Route files with try/catch
  local routes_with_try_catch routes_total
  routes_with_try_catch=$(grep -rl 'try[[:space:]]*{' --include='*.ts' api/src/routes/ 2>/dev/null | wc -l | tr -d ' ')
  routes_total=$(find api/src/routes -name '*.ts' ! -name '*.test.ts' 2>/dev/null | wc -l | tr -d ' ')

  cat > "$outfile" <<EOF
{
  "category": "error-handling",
  "branch": "$BRANCH",
  "commit": "$COMMIT",
  "timestamp": "$TIMESTAMP",
  "metrics": {
    "process_handlers": {
      "uncaught_exception": $uncaught_exception,
      "unhandled_rejection": $unhandled_rejection,
      "total": $(( uncaught_exception + unhandled_rejection ))
    },
    "express_error_middleware": $express_error_middleware,
    "error_boundaries": $error_boundaries,
    "silent_catches": $silent_catches,
    "empty_catch_blocks": $empty_catches,
    "route_error_handling": {
      "routes_with_try_catch": $routes_with_try_catch,
      "routes_total": $routes_total
    }
  }
}
EOF

  log "  Process handlers: $(( uncaught_exception + unhandled_rejection ))"
  log "  Express error middleware: $express_error_middleware"
  log "  ErrorBoundaries: $error_boundaries"
  log "  Silent catches: $silent_catches"
  log "  Results: $outfile"
}

# ── Category 7: Accessibility ────────────────────────────────────

measure_cat7() {
  log "Category 7: Accessibility"
  local outfile="$RESULTS_DIR/cat7-accessibility-${BRANCH_SAFE}.json"

  cd "$ROOT_DIR"

  # Focus traps in dialog components
  local dialogs_total dialogs_with_focus_trap
  dialogs_total=$(find web/src/components/dialogs -name '*.tsx' 2>/dev/null | wc -l | tr -d ' ')
  dialogs_with_focus_trap=$(grep -rl 'useFocusTrap\|focus-trap\|FocusTrap' --include='*.tsx' web/src/components/dialogs/ 2>/dev/null | wc -l | tr -d ' ')

  # aria-label counts
  local aria_labels
  aria_labels=$(grep -rn 'aria-label' --include='*.tsx' --include='*.ts' web/src/ 2>/dev/null | grep -v node_modules | grep -v '\.test\.' | wc -l | tr -d ' ')

  # aria-labelledby counts
  local aria_labelledby
  aria_labelledby=$(grep -rn 'aria-labelledby' --include='*.tsx' --include='*.ts' web/src/ 2>/dev/null | grep -v node_modules | grep -v '\.test\.' | wc -l | tr -d ' ')

  # role attributes
  local role_attrs
  role_attrs=$(grep -rn 'role=' --include='*.tsx' web/src/ 2>/dev/null | grep -v node_modules | grep -v '\.test\.' | wc -l | tr -d ' ')

  # Form inputs without labels (heuristic: count <input that don't have aria-label or id with matching htmlFor)
  # Simplified: count input elements in admin page that lack aria-label
  local admin_inputs admin_labels
  admin_inputs=$(grep -E -c '<input|<select|<textarea' web/src/pages/AdminWorkspaceDetail.tsx 2>/dev/null || echo "0")
  admin_labels=$(grep -E -c 'aria-label|htmlFor|<label' web/src/pages/AdminWorkspaceDetail.tsx 2>/dev/null || echo "0")
  admin_inputs=$(echo "$admin_inputs" | tr -d '[:space:]')
  admin_labels=$(echo "$admin_labels" | tr -d '[:space:]')
  local missing_labels=0
  if [ "$admin_inputs" -gt "$admin_labels" ] 2>/dev/null; then
    missing_labels=$(( admin_inputs - admin_labels ))
  fi

  # useFocusTrap hook exists?
  local has_focus_trap_hook=false
  if [ -f "web/src/hooks/useFocusTrap.ts" ]; then
    has_focus_trap_hook=true
  fi

  cat > "$outfile" <<EOF
{
  "category": "accessibility",
  "branch": "$BRANCH",
  "commit": "$COMMIT",
  "timestamp": "$TIMESTAMP",
  "metrics": {
    "dialogs_total": $dialogs_total,
    "dialogs_with_focus_trap": $dialogs_with_focus_trap,
    "has_focus_trap_hook": $has_focus_trap_hook,
    "aria_labels": $aria_labels,
    "aria_labelledby": $aria_labelledby,
    "role_attributes": $role_attrs,
    "admin_missing_labels_estimate": $missing_labels
  }
}
EOF

  log "  Dialogs with focus trap: $dialogs_with_focus_trap / $dialogs_total"
  log "  aria-label: $aria_labels, aria-labelledby: $aria_labelledby"
  log "  Focus trap hook: $has_focus_trap_hook"
  log "  Results: $outfile"
}

# ── Report Generator ─────────────────────────────────────────────

generate_report() {
  log "Generating comparison report..."
  local report_file="$RESULTS_DIR/comparison-report.md"

  cat > "$report_file" <<'HEADER'
# ShipShape Audit: Before/After Benchmark Report

Reproducible measurements comparing `master` (before) against fix branches (after).

| Category | Metric | Before (master) | After (fix branch) | Delta | % Change |
|----------|--------|-----------------|-------------------|-------|----------|
HEADER

  # Cat 1: Type Safety
  if [ -f "$RESULTS_DIR/cat1-type-safety-master.json" ]; then
    local before_total after_total after_branch after_file
    before_total=$(grep -oE '"total_violations":[[:space:]]*[0-9]+' "$RESULTS_DIR/cat1-type-safety-master.json" | grep -oE '[0-9]+$')

    # Find the fix branch file
    after_file=$(ls "$RESULTS_DIR"/cat1-type-safety-fix*.json 2>/dev/null | head -1)
    if [ -n "$after_file" ]; then
      after_total=$(grep -oE '"total_violations":[[:space:]]*[0-9]+' "$after_file" | grep -oE '[0-9]+$')
      after_branch=$(grep -oE '"branch":[[:space:]]*"[^"]+"' "$after_file" | grep -oE '"[^"]+$' | tr -d '"')
      local delta=$(( after_total - before_total ))
      local pct
      pct=$(echo "$before_total $after_total" | awk '{if ($1>0) printf "%.1f", (($2-$1)/$1)*100; else print "0"}')
      echo "| **1. Type Safety** | Total violations | $before_total | $after_total | $delta | ${pct}% |" >> "$report_file"
    fi

    # Break down as_any specifically
    local before_as_any after_as_any
    before_as_any=$(grep -oE '"as_any":[[:space:]]*\{[^}]+\}' "$RESULTS_DIR/cat1-type-safety-master.json" | grep -oE '"total":[[:space:]]*[0-9]+' | grep -oE '[0-9]+$')
    if [ -n "$after_file" ]; then
      after_as_any=$(grep -oE '"as_any":[[:space:]]*\{[^}]+\}' "$after_file" | grep -oE '"total":[[:space:]]*[0-9]+' | grep -oE '[0-9]+$')
      local delta_any=$(( after_as_any - before_as_any ))
      local pct_any
      pct_any=$(echo "$before_as_any $after_as_any" | awk '{if ($1>0) printf "%.1f", (($2-$1)/$1)*100; else print "0"}')
      echo "| | \`as any\` casts | $before_as_any | $after_as_any | $delta_any | ${pct_any}% |" >> "$report_file"
    fi
  fi

  # Cat 2: Bundle Size
  if [ -f "$RESULTS_DIR/cat2-bundle-size-master.json" ]; then
    local before_js after_js after_file
    before_js=$(grep -oE '"total_js_kb":[[:space:]]*[0-9.]+' "$RESULTS_DIR/cat2-bundle-size-master.json" | grep -oE '[0-9.]+$')
    before_gzip=$(grep -oE '"total_gzip_kb":[[:space:]]*[0-9.]+' "$RESULTS_DIR/cat2-bundle-size-master.json" | grep -oE '[0-9.]+$')
    before_largest=$(grep -oE '"largest_chunk_kb":[[:space:]]*[0-9.]+' "$RESULTS_DIR/cat2-bundle-size-master.json" | grep -oE '[0-9.]+$')

    after_file=$(ls "$RESULTS_DIR"/cat2-bundle-size-fix*.json 2>/dev/null | head -1)
    if [ -n "$after_file" ]; then
      after_js=$(grep -oE '"total_js_kb":[[:space:]]*[0-9.]+' "$after_file" | grep -oE '[0-9.]+$')
      after_gzip=$(grep -oE '"total_gzip_kb":[[:space:]]*[0-9.]+' "$after_file" | grep -oE '[0-9.]+$')
      after_largest=$(grep -oE '"largest_chunk_kb":[[:space:]]*[0-9.]+' "$after_file" | grep -oE '[0-9.]+$')
      local pct_js
      pct_js=$(echo "$before_js $after_js" | awk '{if ($1>0) printf "%.1f", (($2-$1)/$1)*100; else print "0"}')
      local pct_largest
      pct_largest=$(echo "$before_largest $after_largest" | awk '{if ($1>0) printf "%.1f", (($2-$1)/$1)*100; else print "0"}')
      echo "| **2. Bundle Size** | Total JS (KB) | $before_js | $after_js | | ${pct_js}% |" >> "$report_file"
      echo "| | Total gzip (KB) | $before_gzip | $after_gzip | | |" >> "$report_file"
      echo "| | Largest chunk (KB) | $before_largest | $after_largest | | ${pct_largest}% |" >> "$report_file"
    fi
  fi

  # Cat 3: API Response Time (autocannon)
  if [ -f "$RESULTS_DIR/cat3-api-response-time-master.json" ]; then
    local after_file
    after_file=$(ls "$RESULTS_DIR"/cat3-api-response-time-fix*.json 2>/dev/null | head -1)
    if [ -n "$after_file" ]; then
      for ep in "/api/team/grid" "/api/issues" "/api/weeks" "/api/dashboard/my-work"; do
        local escaped_ep
        escaped_ep=$(echo "$ep" | sed 's|/|\\/|g')
        local label="${ep#/api/}"

        # Try autocannon format first (10 connections P50)
        local before_p50 after_p50 before_p95 after_p95 before_p99 after_p99
        before_p50=$(grep -A5 "\"${escaped_ep}\"" "$RESULTS_DIR/cat3-api-response-time-master.json" | grep -oE '"p50_ms":[[:space:]]*[0-9.]+' | head -1 | grep -oE '[0-9.]+$' || echo "?")
        after_p50=$(grep -A5 "\"${escaped_ep}\"" "$after_file" | grep -oE '"p50_ms":[[:space:]]*[0-9.]+' | head -1 | grep -oE '[0-9.]+$' || echo "?")
        before_p95=$(grep -A5 "\"${escaped_ep}\"" "$RESULTS_DIR/cat3-api-response-time-master.json" | grep -oE '"p95_ms":[[:space:]]*[0-9.]+' | head -1 | grep -oE '[0-9.]+$' || echo "?")
        after_p95=$(grep -A5 "\"${escaped_ep}\"" "$after_file" | grep -oE '"p95_ms":[[:space:]]*[0-9.]+' | head -1 | grep -oE '[0-9.]+$' || echo "?")
        before_p99=$(grep -A5 "\"${escaped_ep}\"" "$RESULTS_DIR/cat3-api-response-time-master.json" | grep -oE '"p99_ms":[[:space:]]*[0-9.]+' | head -1 | grep -oE '[0-9.]+$' || echo "?")
        after_p99=$(grep -A5 "\"${escaped_ep}\"" "$after_file" | grep -oE '"p99_ms":[[:space:]]*[0-9.]+' | head -1 | grep -oE '[0-9.]+$' || echo "?")

        if [ "$before_p50" != "?" ]; then
          echo "| **3. API Response** | ${label} P50 @10c (ms) | $before_p50 | $after_p50 | | |" >> "$report_file"
          echo "| | ${label} P95 @10c (ms) | $before_p95 | $after_p95 | | |" >> "$report_file"
          echo "| | ${label} P99 @10c (ms) | $before_p99 | $after_p99 | | |" >> "$report_file"
        else
          # Fallback to curl median format
          local before_median after_median
          before_median=$(grep -oE "\"${escaped_ep}\"[^}]+\"median_ms\":[[:space:]]*[0-9]+" "$RESULTS_DIR/cat3-api-response-time-master.json" | grep -oE '[0-9]+$' || echo "?")
          after_median=$(grep -oE "\"${escaped_ep}\"[^}]+\"median_ms\":[[:space:]]*[0-9]+" "$after_file" | grep -oE '[0-9]+$' || echo "?")
          echo "| **3. API Response** | ${label} median (ms) | $before_median | $after_median | | |" >> "$report_file"
        fi
      done
    fi
  fi

  # Cat 4: Query Efficiency
  if [ -f "$RESULTS_DIR/cat4-query-efficiency-master.json" ]; then
    local after_file
    after_file=$(ls "$RESULTS_DIR"/cat4-query-efficiency-fix*.json 2>/dev/null | head -1)
    if [ -n "$after_file" ]; then
      local before_weeks_buf after_weeks_buf before_subplans after_subplans
      before_weeks_buf=$(grep -oE '"shared_hit_blocks":[[:space:]]*[0-9]+' "$RESULTS_DIR/cat4-query-efficiency-master.json" | head -1 | grep -oE '[0-9]+$')
      after_weeks_buf=$(grep -oE '"shared_hit_blocks":[[:space:]]*[0-9]+' "$after_file" | head -1 | grep -oE '[0-9]+$')
      before_subplans=$(grep -oE '"sub_plans":[[:space:]]*[0-9]+' "$RESULTS_DIR/cat4-query-efficiency-master.json" | head -1 | grep -oE '[0-9]+$')
      after_subplans=$(grep -oE '"sub_plans":[[:space:]]*[0-9]+' "$after_file" | head -1 | grep -oE '[0-9]+$')
      local pct_buf
      pct_buf=$(echo "$before_weeks_buf $after_weeks_buf" | awk '{if ($1>0) printf "%.1f", (($2-$1)/$1)*100; else print "0"}')
      echo "| **4. Query Efficiency** | Weeks buffer hits | $before_weeks_buf | $after_weeks_buf | | ${pct_buf}% |" >> "$report_file"
      echo "| | Weeks SubPlans | $before_subplans | $after_subplans | | |" >> "$report_file"

      local before_idx after_idx
      before_idx=$(grep -oE '"total_indexes":[[:space:]]*[0-9]+' "$RESULTS_DIR/cat4-query-efficiency-master.json" | grep -oE '[0-9]+$')
      after_idx=$(grep -oE '"total_indexes":[[:space:]]*[0-9]+' "$after_file" | grep -oE '[0-9]+$')
      echo "| | Total indexes | $before_idx | $after_idx | +$(( after_idx - before_idx )) | |" >> "$report_file"
    fi
  fi

  # Cat 5: Test Coverage
  if [ -f "$RESULTS_DIR/cat5-test-coverage-master.json" ]; then
    local after_file
    after_file=$(ls "$RESULTS_DIR"/cat5-test-coverage-fix*.json 2>/dev/null | head -1)
    if [ -n "$after_file" ]; then
      local before_files after_files before_cases after_cases
      before_files=$(grep -oE '"total_test_files":[[:space:]]*[0-9]+' "$RESULTS_DIR/cat5-test-coverage-master.json" | grep -oE '[0-9]+$')
      after_files=$(grep -oE '"total_test_files":[[:space:]]*[0-9]+' "$after_file" | grep -oE '[0-9]+$')
      before_cases=$(grep -oE '"total_unit_test_cases":[[:space:]]*[0-9]+' "$RESULTS_DIR/cat5-test-coverage-master.json" | grep -oE '[0-9]+$')
      after_cases=$(grep -oE '"total_unit_test_cases":[[:space:]]*[0-9]+' "$after_file" | grep -oE '[0-9]+$')
      echo "| **5. Test Coverage** | Total test files | $before_files | $after_files | +$(( after_files - before_files )) | |" >> "$report_file"
      echo "| | Unit test cases | $before_cases | $after_cases | +$(( after_cases - before_cases )) | |" >> "$report_file"

      local before_webcov after_webcov
      before_webcov=$(grep -oE '"has_coverage_config":[[:space:]]*(true|false)' "$RESULTS_DIR/cat5-test-coverage-master.json" | tail -1 | grep -oE '(true|false)$')
      after_webcov=$(grep -oE '"has_coverage_config":[[:space:]]*(true|false)' "$after_file" | tail -1 | grep -oE '(true|false)$')
      echo "| | Web coverage config | $before_webcov | $after_webcov | | |" >> "$report_file"
    fi
  fi

  # Cat 6: Error Handling
  if [ -f "$RESULTS_DIR/cat6-error-handling-master.json" ]; then
    local after_file
    after_file=$(ls "$RESULTS_DIR"/cat6-error-handling-fix*.json 2>/dev/null | head -1)
    if [ -n "$after_file" ]; then
      local before_proc after_proc before_middleware after_middleware before_eb after_eb
      before_proc=$(grep -oE '"total":[[:space:]]*[0-9]+' "$RESULTS_DIR/cat6-error-handling-master.json" | head -1 | grep -oE '[0-9]+$')
      after_proc=$(grep -oE '"total":[[:space:]]*[0-9]+' "$after_file" | head -1 | grep -oE '[0-9]+$')
      before_middleware=$(grep -oE '"express_error_middleware":[[:space:]]*[0-9]+' "$RESULTS_DIR/cat6-error-handling-master.json" | grep -oE '[0-9]+$')
      after_middleware=$(grep -oE '"express_error_middleware":[[:space:]]*[0-9]+' "$after_file" | grep -oE '[0-9]+$')
      before_eb=$(grep -oE '"error_boundaries":[[:space:]]*[0-9]+' "$RESULTS_DIR/cat6-error-handling-master.json" | grep -oE '[0-9]+$')
      after_eb=$(grep -oE '"error_boundaries":[[:space:]]*[0-9]+' "$after_file" | grep -oE '[0-9]+$')
      echo "| **6. Error Handling** | Process handlers | $before_proc | $after_proc | +$(( after_proc - before_proc )) | |" >> "$report_file"
      echo "| | Express error middleware | $before_middleware | $after_middleware | +$(( after_middleware - before_middleware )) | |" >> "$report_file"
      echo "| | ErrorBoundaries | $before_eb | $after_eb | +$(( after_eb - before_eb )) | |" >> "$report_file"
    fi
  fi

  # Cat 7: Accessibility
  if [ -f "$RESULTS_DIR/cat7-accessibility-master.json" ]; then
    local after_file
    after_file=$(ls "$RESULTS_DIR"/cat7-accessibility-fix*.json 2>/dev/null | head -1)
    if [ -n "$after_file" ]; then
      local before_ft after_ft before_hook after_hook before_missing after_missing
      before_ft=$(grep -oE '"dialogs_with_focus_trap":[[:space:]]*[0-9]+' "$RESULTS_DIR/cat7-accessibility-master.json" | grep -oE '[0-9]+$')
      after_ft=$(grep -oE '"dialogs_with_focus_trap":[[:space:]]*[0-9]+' "$after_file" | grep -oE '[0-9]+$')
      before_hook=$(grep -oE '"has_focus_trap_hook":[[:space:]]*\w+' "$RESULTS_DIR/cat7-accessibility-master.json" | grep -oE '\w+$')
      after_hook=$(grep -oE '"has_focus_trap_hook":[[:space:]]*\w+' "$after_file" | grep -oE '\w+$')
      local dt
      dt=$(grep -oE '"dialogs_total":[[:space:]]*[0-9]+' "$after_file" | grep -oE '[0-9]+$')
      echo "| **7. Accessibility** | Dialogs with focus trap | $before_ft/$dt | $after_ft/$dt | +$(( after_ft - before_ft )) | |" >> "$report_file"
      echo "| | useFocusTrap hook | $before_hook | $after_hook | | |" >> "$report_file"

      before_missing=$(grep -oE '"admin_missing_labels_estimate":[[:space:]]*[0-9]+' "$RESULTS_DIR/cat7-accessibility-master.json" | grep -oE '[0-9]+$')
      after_missing=$(grep -oE '"admin_missing_labels_estimate":[[:space:]]*[0-9]+' "$after_file" | grep -oE '[0-9]+$')
      echo "| | Missing form labels (est.) | $before_missing | $after_missing | $(( after_missing - before_missing )) | |" >> "$report_file"
    fi
  fi

  # Add metadata footer
  cat >> "$report_file" <<EOF

---

## Methodology

- **Seed data:** 500+ documents, 100+ issues, 20+ users, 10+ sprints (via \`scripts/seed-benchmark-data.ts\`)
- **API timing:** autocannon load testing at 10/25/50 concurrent connections for 10s each, reporting P50/P95/P99 latency
- **Query analysis:** PostgreSQL \`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)\` on identical seed data
- **Bundle size:** Actual file sizes on disk after \`pnpm build\`, independently verified with \`gzip -c | wc -c\`
- **Static counts:** \`grep\` with consistent include/exclude patterns across all branches

## How to Reproduce

\`\`\`bash
# 1. Measure master (before)
git checkout master
./scripts/run-benchmarks.sh

# 2. Measure each fix branch (after)
git checkout fix/type-safety     && ./scripts/run-benchmarks.sh --category 1
git checkout fix/bundle-size     && ./scripts/run-benchmarks.sh --category 2
git checkout fix/api-response-time && ./scripts/run-benchmarks.sh --category 3
git checkout fix/query-efficiency && ./scripts/run-benchmarks.sh --category 4
git checkout fix/test-coverage   && ./scripts/run-benchmarks.sh --category 5
git checkout fix/error-handling  && ./scripts/run-benchmarks.sh --category 6
git checkout fix/accessibility   && ./scripts/run-benchmarks.sh --category 7

# 3. Generate comparison report
./scripts/run-benchmarks.sh --report
\`\`\`

Results saved to \`scripts/benchmark-results/\`.
EOF

  log "Report generated: $report_file"
  log ""
  cat "$report_file"
}

# ── Main execution ───────────────────────────────────────────────

if [ "$REPORT_MODE" = true ]; then
  generate_report
  exit 0
fi

log "ShipShape Benchmark Suite"
log "Branch: $BRANCH (commit: $COMMIT)"
log "Categories: $CATEGORIES"
log ""

IFS=',' read -ra CATS <<< "$CATEGORIES"
for cat in "${CATS[@]}"; do
  cat=$(echo "$cat" | tr -d ' ')
  case "$cat" in
    1) measure_cat1 ;;
    2) measure_cat2 ;;
    3) measure_cat3 ;;
    4) measure_cat4 ;;
    5) measure_cat5 ;;
    6) measure_cat6 ;;
    7) measure_cat7 ;;
    *) err "Unknown category: $cat" ;;
  esac
  echo ""
done

log "All measurements complete. Results in $RESULTS_DIR/"
log "Run './scripts/run-benchmarks.sh --report' to generate comparison report."
