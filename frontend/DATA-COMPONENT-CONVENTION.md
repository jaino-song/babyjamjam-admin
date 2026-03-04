# Data-Component Naming Convention

## 1. Overview

This project uses a **layered attribute strategy** for DOM element identification:

| Attribute | Purpose | Scope |
|-----------|---------|-------|
| `data-component` | Primary identifier for app-level elements. Used for E2E testing, analytics, AI targeting, and debugging. | App components |
| `data-slot` | shadcn/ui primitive internals only. **DO NOT MODIFY.** | `frontend/src/components/ui/` |
| `data-testid` | Test-specific selectors for unique test identification. | Test files |
| `data-instance` *(future)* | Reserved for per-instance tracking. **Not implemented yet.** | — |

### Selector Precedence

```
data-component > data-slot > data-testid
```

When querying elements, prefer `data-component` first. Fall back to `data-slot` for shadcn primitives, then `data-testid` for test-only selectors.

---

## 2. Naming Format

```
{page-name}-{parent}-{child}-{element}
```

- All values **MUST** be `kebab-case`
- No PascalCase, no camelCase, no underscores
- Examples: `dashboard-header-actions`, `clients-filter-search-input`

---

## 3. Page Name Mapping

| Route | Semantic Page Name |
|-------|-------------------|
| `/` | `home` |
| `/dashboard` | `dashboard` |
| `/clients` | `clients` |
| `/clients/filtered` | `clients-filtered` |
| `/employees` | `employees` |
| `/contracts` | `contracts` |
| `/contracts/creation` | `contracts-creation` |
| `/messages` | `messages` |
| `/messages/templates` | `messages-templates` |
| `/messages/templates/new` | `messages-templates-new` |
| `/messages/templates/[id]/edit` | `messages-template-edit` |
| `/messages/system-templates` | `messages-system-templates` |
| `/messages/system-templates/[templateKey]` | `messages-system-template-detail` |
| `/settings` | `settings` |
| `/settings/general` | `settings-general` |
| `/settings/voucher-price` | `settings-voucher-price` |
| `/admin` | `admin` |
| `/admin/feedback/[id]` | `admin-feedback-detail` |
| `/auth/register` | `auth-register` |
| `/auth/forgot-password` | `auth-forgot-password` |
| `/auth/reset-password` | `auth-reset-password` |
| `/auth/verify-email` | `auth-verify-email` |
| `/callback` | `auth-callback` |
| `/chat` | `chat` |
| `/files` | `files` |
| `/select-organization` | `select-org` |
| `/login` | `login` |
| `/logout` | `logout` |
| `/test` | `test` |

> **NOTE:** `/auth/login` does **NOT** exist. Login is at `/login`.

---

## 4. Layout / Global Components (No Page Prefix)

Layout and global components use generic names **without** a page prefix:

| Component | `data-component` |
|-----------|-----------------|
| V3Sidebar root | `sidebar` |
| V3Sidebar nav section | `sidebar-nav` |
| V3Sidebar nav item | `sidebar-nav-item` |
| V3MainContent root | `main-content` |
| V3MobileHeader root | `mobile-header` |
| MobileBottomNav root | `mobile-bottom-nav` |

---

## 5. Depth Limit Rule

- **Maximum 5 segments** in a name (e.g., `dashboard-split-detail-summary-row`)
- If deeper nesting occurs, **restart the hierarchy** from the nearest named component
- **Page prefix MUST be retained** even when restarting hierarchy

### Example

Instead of:
```
dashboard-split-list-item-status-badge-icon   ← 7 segments, too deep
```

Use:
```
dashboard-list-item-status-badge   ← 5 segments, restarted from "list-item"
```

---

## 6. Collision Policy

### Repeated Structures
Repeated structures (e.g., multiple list items) use the **same** `data-component` value. The attribute identifies the component **type**, not the instance.

### Shared Components Across Pages
Use the **page prefix of where the component is rendered**:
- `dashboard-chat-widget` — when rendered on the dashboard page
- `chat-widget` — when rendered on the chat page

Inside the component file itself, use the component's own name as prefix.

### Duplicate Detection
If two different elements on the same page would get the same name, append a **semantic disambiguator** based on purpose:
- `dashboard-header-action-primary`
- `dashboard-header-action-secondary`

---

## 7. Path Disambiguation (CRITICAL)

Two directories named `ui/` exist in the project:

| Path | Purpose | Attribute | Editable? |
|------|---------|-----------|-----------|
| `frontend/src/components/ui/` | shadcn/ui primitives | `data-slot` | **DO NOT MODIFY** |
| `frontend/src/app/(components)/ui/` | App-level shared UI | `data-component` | **EDITABLE** |

Always verify which `ui/` directory you are working in before making changes.

---

## 8. Example: Dashboard Page Tree

```html
<section data-component="dashboard">
  <div data-component="dashboard-header">
    <div data-component="dashboard-header-actions">
      <a data-component="dashboard-header-send-contract">
      <a data-component="dashboard-header-send-message">
  <div data-component="dashboard-stats">
    <div data-component="dashboard-stats-active-clients">
    <div data-component="dashboard-stats-upcoming">
    <div data-component="dashboard-stats-pending-sign">
    <div data-component="dashboard-stats-pending-send">
  <div data-component="dashboard-split">
    <div data-component="dashboard-split-list">
      <div data-component="dashboard-split-list-tabs">
      <div data-component="dashboard-split-list-item">
    <div data-component="dashboard-split-detail">
      <div data-component="dashboard-split-detail-summary">
        <div data-component="dashboard-split-detail-summary-row">
      <div data-component="dashboard-split-detail-chat">
```

---

## 9. How to Name a New Component (Step-by-Step)

1. **Identify the page** — Check which route renders this component
2. **Look up the semantic name** — Find the page in the [Page Name Mapping](#3-page-name-mapping) table
3. **Trace the hierarchy** — Walk from the page root down to your component
4. **Build the name** — `{page-name}-{parent}-{child}-{element}`
5. **Check depth** — If more than 5 segments, restart from nearest named component (keep page prefix)
6. **Verify kebab-case** — No PascalCase, no camelCase, no underscores
7. **Check for collisions** — If another element has the same name, add a semantic disambiguator
8. **Layout/global components** — Use generic names without page prefix

---

## 10. What Gets Annotated

### ✅ Annotate

- Named components (their root DOM element)
- Structural wrappers (`<div>`, `<section>`, `<nav>`, `<main>`, `<aside>`, `<article>`, `<header>`, `<footer>`)
- Actionable elements (buttons, inputs, links)

### ❌ Do NOT Annotate

- Inline text elements (`<p>`, `<span>`, `<label>`, `<br>`, `<hr>`)
- SVG internals (`<svg>`, `<path>`, `<circle>`)
- Component invocation sites (e.g., `<PageHeader />`) — only DOM nodes inside implementations
- shadcn/ui components in `frontend/src/components/ui/` (they use `data-slot`)
- Third-party library internals (Radix, recharts, etc.)

---

## 11. SSR Compatibility

All `data-component` values are **static strings**. No React Context, no runtime logic, no `'use client'` additions needed. Fully SSR-compatible.
