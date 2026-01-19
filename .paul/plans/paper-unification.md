# Paper Component Unification Plan

## Context

### Original Request
Unify MUI Paper usages across the codebase into a single, consistent `ContentPaper` component that replaces the existing `ComponentContainer`.

### Interview Summary
**Key Discussions**:
- Single `ContentPaper` component with optional title/subtitle props
- Enforce consistent `elevation={2}` across all usages
- Include Fade animation for smooth content appearance
- Support both `title/subtitle` strings AND `header` ReactNode for flexibility
- **FULL REPLACEMENT**: Delete ComponentContainer, no backward compatibility

**Research Findings**:
- 22 files currently use MUI Paper directly
- 5 files use ComponentContainer (with textJSON-based i18n titles)
- Different CSS hashes (`css-1y7crb5`, `css-rzj6o7`) due to varying sx props
- Theme sets `borderRadius: 14` globally
- Common props: `elevation={2}`, `p: 3`
- **Duplicate structure found**: `features/` (legacy) vs `app/(components)/` (canonical) - both have EmployeesTable.tsx and ClientsTable.tsx

---

## Rollback Strategy

**Before starting migration:**
1. Create a git branch: `git checkout -b refactor/paper-unification`
2. Take screenshots of key pages: /employees, /clients, /settings/general, /messages, /contracts
3. If issues found during verification (Task 5), revert: `git checkout main`

---

## Work Objectives

### Core Objective
Create a unified `ContentPaper` component that replaces all direct Paper usages and the existing ComponentContainer, ensuring consistent styling and API across the entire frontend.

### Concrete Deliverables
- New `ContentPaper.tsx` component in `(components)/root/`
- Delete `ComponentContainer.tsx`
- Update all 20 files to use `ContentPaper`
- Consistent elevation, padding, and animation behavior

### Definition of Done
- [ ] No direct `<Paper>` imports for content sections (except excluded files)
- [ ] No `ComponentContainer` references anywhere in codebase
- [ ] All content sections use `ContentPaper`
- [ ] TypeScript compiles without errors
- [ ] Visual appearance unchanged (same padding, elevation, border-radius)

### Must Have
- `elevation={2}` as enforced default
- `p: 3` (24px padding) as default
- `bgcolor: "background.default"` as default
- Fade animation with 500ms timeout
- Support for `title?: string` and `subtitle?: string` props
- Support for `header?: ReactNode` prop (overrides title/subtitle)
- Full TypeScript types with proper MUI Paper prop forwarding
- `data-component="content-paper"` for testing/debugging
- All sx props merged and forwardable (for borderRadius overrides, minHeight, etc.)

### Must NOT Have (Guardrails)
- NO backward compatibility layer for ComponentContainer
- NO multiple component variants (single ContentPaper only)
- NO changes to Autocomplete dropdown Papers (EmployeeAutocomplete, ClientAutocomplete)
- NO changes to login page Paper styling
- NO breaking the existing textJSON i18n pattern (migrate to explicit title/subtitle)

---

## Task Flow

```
Task 1 (Create ContentPaper)
    ↓
Task 2 (Migrate ComponentContainer usages) ──┐
    ↓                                         │ parallel
Task 3 (Migrate direct Paper usages) ────────┘
    ↓
Task 4 (Delete ComponentContainer)
    ↓
Task 5 (Verify & cleanup imports)
```

## Parallelization

| Group | Tasks | Reason |
|-------|-------|--------|
| A | 2, 3 | Independent file migrations after ContentPaper exists |

| Task | Depends On | Reason |
|------|------------|--------|
| 2, 3 | 1 | Need ContentPaper component to exist first |
| 4 | 2 | Must migrate all usages before deletion |
| 5 | 2, 3, 4 | Final verification after all migrations |

---

## TODOs

- [ ] 1. Create ContentPaper Component

  **What to do**:
  - Create `frontend/src/app/(components)/root/ContentPaper.tsx`
  - Define props interface:
    ```typescript
    interface ContentPaperProps extends Omit<PaperProps, 'elevation'> {
      children: React.ReactNode;
      title?: string;
      subtitle?: string;
      header?: React.ReactNode; // Overrides title/subtitle if provided
      elevation?: number; // Default 2, but allow override
      disableAnimation?: boolean;
      sx?: SxProps<Theme>;
    }
    ```
  - Implement component with:
    - `<Paper elevation={2}>` as base
    - `sx={{ p: 3, ...sx }}` for consistent padding
    - `<Fade in appear timeout={500}>` wrapper (unless disableAnimation)
    - Conditional title/subtitle Typography rendering
    - `data-component="content-paper"` attribute
  - Export as named export: `export const ContentPaper = ...`

  **Must NOT do**:
  - Don't add textJSON prop (explicit title/subtitle instead)
  - Don't use default export
  - Don't add complex variants or modes

  **Parallelizable**: NO (dependency for all other tasks)

  **References**:
  - `frontend/src/app/(components)/root/ComponentContainer.tsx` - Current implementation pattern
  - `frontend/src/app/(components)/mui-theme-provider.tsx:24` - Theme borderRadius

  **Acceptance Criteria**:
  - [ ] Component renders Paper with elevation={2}
  - [ ] Fade animation works on mount
  - [ ] title/subtitle render when provided
  - [ ] header prop overrides title/subtitle
  - [ ] sx prop merges correctly with defaults
  - [ ] TypeScript types are complete

---

- [ ] 2. Migrate ComponentContainer Usages (5 files)

  **What to do**:
  - Update imports from `ComponentContainer` to `ContentPaper`
  - Replace `textJSON` prop with explicit `title` and `subtitle` using i18n
  
  **NOTE on duplicate files**: 
  - `frontend/src/features/` is LEGACY structure (older, smaller files)
  - `frontend/src/app/(components)/` is CANONICAL structure (newer, actively maintained)
  - Both need migration as they both currently import ComponentContainer
  
  **Files to migrate with i18n key mapping**:
  
  | File | textJSON | title key | subtitle key |
  |------|----------|-----------|--------------|
  | `app/(components)/employees/EmployeesTable.tsx` | "employees" | `employees.title` | `employees.subtitle` |
  | `features/employees/components/EmployeesTable.tsx` | "employees" | `employees.title` | `employees.subtitle` |
  | `app/(components)/clients/ClientsTable.tsx` | "clients" | `clients.title` | `clients.subtitle` |
  | `features/clients/components/ClientsTable.tsx` | "clients" | `clients.title` | `clients.subtitle` |
  | `app/(components)/eformsign/DocumentsList.tsx` | "documents-list" | `documents-list.title` | `documents-list.subtitle` |
  
  - Migration pattern:
    ```typescript
    // Before
    <ComponentContainer textJSON="employees">
    
    // After
    const locale = useLocale();
    <ContentPaper 
      title={t(locale, "employees.title")} 
      subtitle={t(locale, "employees.subtitle")}
      sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
    >
    ```
  
  - Note: ComponentContainer had `minHeight: 70vh` - preserve this via sx for these full-page containers
  - For borderTopLeftRadius/borderTopRightRadius, pass via sx: `sx={{ borderTopLeftRadius: 0 }}`

  **Must NOT do**:
  - Don't change the children content
  - Don't lose the minHeight: 70vh for full-page containers
  - Don't change i18n key structure

  **Parallelizable**: YES (with Task 3, after Task 1)

  **References**:
  - `frontend/src/app/(components)/root/ComponentContainer.tsx:13-34` - Current usage pattern
  - `frontend/src/app/lib/i18n/translations.ts` - i18n t() function

  **Acceptance Criteria**:
  - [ ] All 5 files use ContentPaper instead of ComponentContainer
  - [ ] Titles and subtitles display correctly (same as before)
  - [ ] No TypeScript errors

---

- [ ] 3. Migrate Direct Paper Usages (13 files)

  **What to do**:
  - Replace direct `<Paper>` with `<ContentPaper>` for content sections
  - Files to migrate:
    1. `frontend/src/app/messages/page.tsx` (line 59)
    2. `frontend/src/app/messages/loading.tsx` (line 9)
    3. `frontend/src/app/settings/general/page.tsx` (lines 89, 144, 187) - **3 Papers in this file**
    4. `frontend/src/app/(components)/settings/VoucherPriceUploadForm.tsx` (line 133)
    5. `frontend/src/app/(components)/dashboard/HeroBanner.tsx` (line 28)
    6. `frontend/src/app/(components)/chat/ChatFullscreen.tsx` (line 31)
    7. `frontend/src/app/(components)/dashboard/QuickActions.tsx` (line 12)
    8. `frontend/src/app/(components)/settings/ImageDropzone.tsx` (line 117)
    9. `frontend/src/app/(components)/notifications/NotificationSettings.tsx` (line 96)
    10. `frontend/src/app/(components)/dashboard/RecentActivity.tsx` (line 20)
    11. `frontend/src/app/(components)/messages/templates/GeneratedMsg.tsx` (line 16)
    12. `frontend/src/app/(components)/dashboard/PerformanceOverview.tsx` (line 17)
    13. `frontend/src/app/(components)/messages/forms/ContractCreationForm.tsx` (line 576)

  - Migration pattern:
    ```typescript
    // Before
    <Paper elevation={2} sx={{ p: 3, ...otherStyles }}>
    
    // After
    <ContentPaper sx={{ ...otherStyles }}>
    ```
  
  **Padding handling rules**:
  | Original padding | Migration |
  |-----------------|-----------|
  | `p: 3` | Remove (now default) → `<ContentPaper>` |
  | `p: 2` or other | Keep via sx → `<ContentPaper sx={{ p: 2 }}>` |
  | No padding specified | Accept default `p: 3` |
  | `p: { xs: 2.5, sm: 3 }` | Preserve responsive → `<ContentPaper sx={{ p: { xs: 2.5, sm: 3 } }}>` |
  
  - For Papers with `elevation={0}`, use: `<ContentPaper elevation={0}>`

  **Exclusion criteria** (Papers NOT to migrate):
  | Exclusion Type | Files | Reason |
  |----------------|-------|--------|
  | Dropdown/Popover | EmployeeAutocomplete.tsx, ClientAutocomplete.tsx | Uses Paper in Portal, elevation={8} |
  | Full-page layout | login/page.tsx | Custom full-page styling, not content container |
  | TableContainer wrapper | ParsedDataPreview.tsx (line 128) | `<TableContainer component={Paper}>` - MUI pattern |

  **Must NOT do**:
  - Don't migrate excluded files (see table above)
  - Don't change the visual appearance
  - Don't duplicate padding (remove p: 3 since it's now default)

  **Parallelizable**: YES (with Task 2, after Task 1)

  **References**:
  - Each file's current Paper usage (see line numbers above)

  **Acceptance Criteria**:
  - [ ] All 15 files use ContentPaper
  - [ ] Visual appearance unchanged
  - [ ] No duplicate padding (p: 3 not applied twice)
  - [ ] No TypeScript errors

---

- [ ] 4. Delete ComponentContainer

  **What to do**:
  - Delete `frontend/src/app/(components)/root/ComponentContainer.tsx`
  - Verify no remaining imports reference it

  **Must NOT do**:
  - Don't delete before all migrations complete
  - Don't leave orphaned imports

  **Parallelizable**: NO (depends on Task 2)

  **References**:
  - Task 2 completion

  **Acceptance Criteria**:
  - [ ] File deleted
  - [ ] No import errors in codebase

---

- [ ] 5. Verify & Cleanup

  **What to do**:
  
  **5.1 TypeScript Verification**:
  - Run: `npm run build` or `npx tsc --noEmit`
  - Fix any type errors before proceeding
  
  **5.2 Code Search Verification**:
  - Search for remaining ComponentContainer: `grep -r "ComponentContainer" frontend/src/`
  - Search for remaining direct Paper in content sections (should only find excluded files)
  
  **5.3 Visual Verification (compare with screenshots)**:
  
  | Page | What to Check |
  |------|---------------|
  | /employees | Table renders, title/subtitle correct, padding consistent |
  | /clients | Table renders, title/subtitle correct, padding consistent |
  | /settings/general | 3 Papers visible, all have same elevation/padding |
  | /messages | Content renders, no layout shift |
  | /contracts | Document list renders correctly |
  
  **5.4 Fade Animation Verification**:
  - Check pages with multiple ContentPapers (e.g., /settings/general)
  - Verify: No layout shift during animation
  - Verify: No flickering or stutter
  - Verify: Animation feels smooth (500ms timeout)
  - Performance check: No visible lag on initial load
  
  **Verification Depth**: 
  - Quick check (5 min): Pages load without console errors
  - Medium check (15 min): Padding, elevation, border-radius match pre-migration screenshots
  - Deep check (30 min): Responsive behavior, animation smoothness, multiple browsers (Chrome, Safari)

  **Must NOT do**:
  - Don't skip visual verification
  - Don't ignore TypeScript errors
  - Don't merge if any visual regression detected

  **Parallelizable**: NO (final step)

  **References**:
  - All migrated files
  - Pre-migration screenshots (from Rollback Strategy)

  **Acceptance Criteria**:
  - [ ] `npm run build` succeeds with no errors
  - [ ] No ComponentContainer references found (grep returns empty)
  - [ ] Visual appearance matches pre-migration screenshots
  - [ ] All pages render without console errors
  - [ ] Fade animation doesn't cause layout shift
  - [ ] No performance degradation on pages with multiple ContentPapers

---

## Success Criteria

### Final Checklist
- [ ] ContentPaper component created with full TypeScript types
- [ ] All ComponentContainer usages migrated (5 files)
- [ ] All direct Paper usages migrated (15 files)
- [ ] ComponentContainer.tsx deleted
- [ ] No TypeScript compilation errors
- [ ] Visual regression: pages look identical to before
- [ ] Excluded files unchanged (login, Autocompletes)
