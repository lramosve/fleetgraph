# Category 6: Error Handling Improvements

## Improvement 1: Process-Level Error Handlers

**File:** `api/src/index.ts`

**What changed:** Added `process.on('unhandledRejection')` and `process.on('uncaughtException')` handlers that log the error and exit with a failure code.

**Why the original code was suboptimal:** Without these handlers, any unhandled promise rejection (e.g., a database connection failure during WebSocket document persistence) or uncaught exception would crash the Node.js process silently — no log, no alert, no graceful shutdown. In-flight Yjs document state could be lost.

**Why this approach is better:** The handlers ensure every fatal error is logged before the process exits. The explicit `process.exit(1)` ensures the process manager (PM2, ECS, systemd) detects the failure and restarts the service.

**Tradeoffs:** The process still exits (no graceful drain of in-flight requests). A more sophisticated approach would drain connections before exiting, but that adds complexity and the current route handlers already have try/catch for recoverable errors.

### Before/After

| Metric | Before | After |
|--------|--------|-------|
| `process.on('unhandledRejection')` | Not configured | Logs error + exits with code 1 |
| `process.on('uncaughtException')` | Not configured | Logs error + exits with code 1 |
| Behavior on unhandled rejection | Silent crash, no log | Error logged, clean exit for restart |

---

## Improvement 2: Express Global Error-Handling Middleware

**File:** `api/src/app.ts`

**What changed:** Added a global error-handling middleware `(err, req, res, next)` at the end of the middleware chain. It preserves HTTP status codes from upstream middleware (e.g., CSRF's 403) and returns structured JSON error responses.

**Why the original code was suboptimal:** Without a global error handler, any synchronous throw that bypassed a route-level try/catch would produce Express's default unstructured HTML error page. The CSRF middleware (`csrf-sync`) throws `ForbiddenError` which was already handled by Express's default behavior, but any unexpected error would result in an unstructured 500.

**Why this approach is better:** All errors now return consistent JSON responses with `{ error, message }` format. In production, 500-level errors hide internal details. The handler respects `err.status` and `err.statusCode` from libraries like `http-errors` (used by `csrf-sync`), so existing behavior (e.g., CSRF 403 responses) is preserved.

**Tradeoffs:** Error messages are exposed in non-production environments for debugging. Production mode returns a generic message for 500s.

### Before/After

| Metric | Before | After |
|--------|--------|-------|
| Express global error handler | Not configured | JSON response with status-aware error codes |
| Unhandled sync throw response | Unstructured HTML 500 | `{ error: "INTERNAL_SERVER_ERROR", message: "..." }` |
| CSRF error (403) handling | Express default | Preserved as 403 with `{ error: "FORBIDDEN" }` |
| API test suite | 451 passed, 0 failed | 451 passed, 0 failed |

---

## Improvement 3: Granular ErrorBoundary in Sidebar

**File:** `web/src/pages/App.tsx`

**What changed:** Added an `<ErrorBoundary>` around the sidebar content area (DocumentsTree, IssuesSidebar, ProjectsList, etc.). Previously, only the main content `<Outlet>` and the TipTap editor had error boundaries.

**Why the original code was suboptimal:** A crash in any sidebar component (document tree, issues list, projects list) would bubble up to the root ErrorBoundary, replacing the ENTIRE application with "Something went wrong." The user would lose access to navigation, the editor, and all other functionality.

**Why this approach is better:** A sidebar crash now shows a localized "Sidebar failed to load" message with a reload link, while the main content area (editor, dashboard) remains functional. Users can still save their work.

**Tradeoffs:** The fallback UI is minimal (text + reload link). A more sophisticated approach could retry rendering or offer to switch sidebar modes, but this adds complexity without clear benefit.

### Before/After

| Metric | Before | After |
|--------|--------|-------|
| ErrorBoundary placements | 2 (App root Outlet + Editor) | 3 (+Sidebar content) |
| Sidebar crash impact | Entire app replaced with error | Only sidebar shows error; main content works |
| Web unit tests | 138 passed, 13 failed (pre-existing) | 138 passed, 13 failed (unchanged) |
| TypeScript compilation | 0 errors | 0 errors |
