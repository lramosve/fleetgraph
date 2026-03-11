# Category 7: Accessibility Improvements

## Problem
Three custom modal dialogs lacked keyboard focus traps, allowing Tab key to escape behind the overlay. Six form inputs in AdminWorkspaceDetail lacked `aria-label` attributes, making them invisible to screen readers.

## Changes

### 1. Focus Trap Hook (`web/src/hooks/useFocusTrap.ts`)
- Created reusable `useFocusTrap(isActive)` hook
- Traps Tab/Shift+Tab within the dialog container
- Auto-focuses first focusable element on open
- Restores focus to trigger element on close

### 2. Modal Dialog Focus Traps
Applied `useFocusTrap` + `aria-labelledby` to:
- `ConversionDialog.tsx` — document type conversion confirmation
- `MergeProgramDialog.tsx` — program merge workflow
- `BacklogPickerModal.tsx` — issue picker with search

### 3. Form Input Labels (`AdminWorkspaceDetail.tsx`)
Added `aria-label` to 6 inputs:
- Member role select: `"Role for {member.name}"`
- User search input: `"Search users by email"`
- Add user role select: `"Role for new user"`
- Invite email input: `"Invite email address"`
- Invite role select: `"Role for invited user"`
- PIV Subject DN input: `"PIV X.509 Subject DN"`

### 4. Search Input Label (`BacklogPickerModal.tsx`)
- Added `aria-label="Search issues"` to the issue search field

## Before/After

| Metric | Before | After |
|--------|--------|-------|
| Dialogs with focus traps | 0/3 | 3/3 |
| Dialogs with aria-labelledby | 0/3 | 3/3 |
| Form inputs missing labels | 6 | 0 |
| Focus restored on close | No | Yes |

## Lighthouse Accessibility Scores (Baseline)

Scores measured via `scripts/lighthouse-audit.cjs` across all 11 pages:

| Page | Before Score | Expected After | Notes |
|------|-------------|----------------|-------|
| Login | 91 | 91+ | No changes on this page |
| Dashboard | 96 | 96+ | Modal focus traps improve keyboard nav |
| My Week | 96 | 96+ | Modal focus traps improve keyboard nav |
| Documents | 91 | 91+ | No changes on this page |
| Issues | 100 | 100 | BacklogPickerModal now has focus trap + aria-label |
| Projects | 100 | 100 | No changes on this page |
| Programs | 100 | 100 | MergeProgramDialog now has focus trap |
| Team Allocation | 100 | 100 | No changes on this page |
| Team Directory | 100 | 100 | No changes on this page |
| Team Status | 100 | 100 | No changes on this page |
| Settings | 100 | 100 | 6 form inputs now have aria-labels |

**Note on Lighthouse vs. Manual Testing:**
Lighthouse automated accessibility audits primarily test static DOM attributes (aria-labels, color contrast, heading hierarchy). Focus trap behavior is a keyboard interaction pattern that Lighthouse does not directly measure. The focus trap improvements are verified through manual keyboard testing:
1. Open any dialog (e.g., Convert Document, Merge Program, Backlog Picker)
2. Press Tab repeatedly — focus should cycle within the dialog
3. Press Shift+Tab — focus should cycle backwards within the dialog
4. Press Escape — dialog closes and focus returns to the trigger element

## Methodology
- **Lighthouse audits:** Chrome DevTools Lighthouse with `--only-categories=accessibility`
- **Benchmark script:** `./scripts/run-benchmarks.sh --category 7` measures aria-labels, focus traps, and role attributes
- **Manual verification:** Keyboard navigation testing for focus traps

## Testing
- `npx tsc --noEmit` — passes with no type errors
- `npx vite build` — builds successfully
- Focus trap behavior: Tab cycles within dialog, Shift+Tab wraps, Escape closes
