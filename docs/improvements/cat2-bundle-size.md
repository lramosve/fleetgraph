# Category 2: Bundle Size Improvements

## Improvement 1: Route-Level Code Splitting

**File:** `web/src/main.tsx`

**What changed:** Converted 20 page component imports from static `import { Page } from '@/pages/Page'` to dynamic `React.lazy(() => import('@/pages/Page'))`. Added a `<React.Suspense>` wrapper with a loading fallback around the route tree.

**Why the original code was suboptimal:** All 20 page components were statically imported, meaning the entire application (every page, every feature) was bundled into a single 2,073 KB JavaScript file. Users visiting the login page downloaded the full editor, emoji picker, team grid, admin dashboard, and every other page — even though they'd only use one page at a time.

**Why this approach is better:** React.lazy with dynamic imports tells Vite/Rollup to create separate chunks for each page. The browser only downloads a page's code when the user navigates to it. The initial load now only includes the framework, shared components, and the active page.

**Tradeoffs:** First navigation to a new page shows a brief "Loading..." state while the chunk downloads. This is imperceptible on fast connections and preferable to a large upfront download on slow ones.

## Improvement 2: Vendor Library Chunking (manualChunks)

**File:** `web/vite.config.ts`

**What changed:** Added a `manualChunks` function in the Rollup output configuration that separates large vendor dependencies into independently cached chunks:

- `vendor-editor`: TipTap + ProseMirror (476 KB)
- `vendor-collab`: Yjs + lib0 + y-websocket + y-indexeddb (101 KB)
- `vendor-emoji`: emoji-picker-react (271 KB)
- `vendor-highlight`: highlight.js + lowlight (172 KB)
- `vendor-dnd`: @dnd-kit (193 KB)

**Why the original code was suboptimal:** All vendor code was bundled into one monolithic chunk. When any application code changed, the entire 2 MB bundle cache was invalidated, forcing users to re-download everything — including vendor libraries that hadn't changed.

**Why this approach is better:** Vendor chunks are cached independently. Application code updates only invalidate the main chunk (341 KB), while vendor chunks remain cached. The editor chunk (476 KB) is only loaded when a user opens a document editor.

**Tradeoffs:** More HTTP requests on first visit (6 vendor chunks vs 1). HTTP/2 multiplexing makes this negligible. The benefit of independent caching far outweighs the cost of additional requests.

### Before/After

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Main JS bundle (raw) | 2,073.70 KB | 341.00 KB | **83.6% reduction** |
| Main JS bundle (gzipped) | 589.49 KB | 97.10 KB | **83.5% reduction** |
| Initial page load JS | 2,073.70 KB (everything) | 341 KB + page chunk (~10-50 KB) | **~82% reduction** |
| Vendor chunks | 0 | 5 (editor: 476 KB, emoji: 271 KB, dnd: 193 KB, highlight: 172 KB, collab: 101 KB) | Independently cached |
| Number of JS chunks | 262 | 290 | +28 (page chunks + vendor chunks) |
| Vite chunk size warning | Yes (4x over 500 KB limit) | No warnings | Resolved |
| TypeScript compilation | 0 errors | 0 errors | No change |
| Web unit tests | 138 passed, 13 failed (pre-existing) | 138 passed, 13 failed | No change |
