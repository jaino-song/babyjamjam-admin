# Annotate Components Skill

## Trigger Phrases
- "annotate components"
- "add data-component"
- "identify elements"
- "data-component annotation"

## Purpose
Add hierarchical `data-component` attributes to React components following the project's naming convention.

## Prerequisites
- Read `frontend/DATA-COMPONENT-CONVENTION.md` for the full naming convention reference

## Workflow

### Step 1: Identify Context
1. Determine which **page** renders this component (check the route/file path)
2. Look up the page's **semantic name** in the Page Name Mapping table in `DATA-COMPONENT-CONVENTION.md`
3. If the component is a **layout/global component** (sidebar, header, etc.), it uses generic names without page prefix

### Step 2: Analyze the JSX Tree
1. Read the target file
2. Identify all **structural DOM elements**: `<div>`, `<section>`, `<nav>`, `<main>`, `<aside>`, `<article>`, `<header>`, `<footer>`
3. Identify all **actionable elements**: buttons, inputs, links
4. Skip inline text elements: `<p>`, `<span>`, `<label>`, `<br>`, `<hr>`
5. Skip SVG internals: `<svg>`, `<path>`, `<circle>`
6. Skip component invocation sites (e.g., `<PageHeader />`) — only annotate DOM nodes inside component implementations

### Step 3: Generate Hierarchical Names
1. Start with the page name as the first segment: `{page-name}`
2. Add parent component context: `{page-name}-{parent}`
3. Add child/element context: `{page-name}-{parent}-{child}`
4. All names MUST be **kebab-case** (no PascalCase, no camelCase, no underscores)
5. Maximum **5 segments** per name (depth limit)

### Step 4: Apply Depth Limit
- If a name would exceed 5 segments, restart the hierarchy from the nearest named component
- **Always retain the page prefix** as the first segment
- Example: Instead of `dashboard-split-list-item-status-badge-icon`, use `dashboard-list-item-status-badge`

### Step 5: Handle Collisions
- **Repeated structures** (e.g., multiple list items): Use the same `data-component` value — it identifies the component TYPE, not the instance
- **Shared components across pages**: Use the page prefix where the component is rendered
- **Duplicate names**: Append a semantic disambiguator (e.g., `-primary`, `-secondary`)

### Step 6: Add Attributes
1. Add `data-component="{name}"` to each identified DOM element
2. Do NOT modify existing `data-slot` attributes (shadcn/ui)
3. Do NOT modify existing `data-testid` attributes
4. Do NOT change component behavior, styling, or props
5. Do NOT add `'use client'` to Server Components

## Path Disambiguation (CRITICAL)
Two directories named `ui/` exist with different purposes:
- **`frontend/src/components/ui/`** — shadcn/ui primitives. Uses `data-slot`. **DO NOT MODIFY.**
- **`frontend/src/app/(components)/ui/`** — App-level shared UI. Uses `data-component`. **EDITABLE.**

## Reconciliation Rules
When a component already has `data-component` attributes:
1. Check if the existing value follows kebab-case convention
2. If PascalCase (e.g., `EmployeeFormDialog`), convert to kebab-case with page prefix (e.g., `employees-form-dialog`)
3. If already kebab-case but missing page prefix, add the appropriate prefix
4. If already correct, leave it unchanged

## Example: Annotating a Dashboard Component

**Before:**
```tsx
export function StatsGrid() {
  return (
    <div className="grid grid-cols-4 gap-4">
      <div className="p-4 rounded-lg">
        <span>Active Clients</span>
        <p>42</p>
      </div>
    </div>
  );
}
```

**After:**
```tsx
export function StatsGrid() {
  return (
    <div data-component="dashboard-stats" className="grid grid-cols-4 gap-4">
      <div data-component="dashboard-stats-active-clients" className="p-4 rounded-lg">
        <span>Active Clients</span>
        <p>42</p>
      </div>
    </div>
  );
}
```

## Verification Checklist
- [ ] All structural DOM elements have `data-component`
- [ ] All values are kebab-case
- [ ] No name exceeds 5 segments
- [ ] Page prefix is correct for the component's context
- [ ] No `data-slot` attributes were modified
- [ ] No `data-testid` attributes were modified
- [ ] No files in `frontend/src/components/ui/` were touched
- [ ] No `'use client'` was added to Server Components
- [ ] `pnpm build` succeeds
