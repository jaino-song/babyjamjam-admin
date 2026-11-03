# Chat workspace

Approved reference: `docs/mockups/admin-chat-variants-20261103/02-workspace.html`
from prototype commit `eb3eebe540546af4ef26d601975b5c94a3a4e38b` (separate mockup worktree).
Implementation source of truth: `ChatWorkspace.tsx`, `ChatWorkspaceStats.tsx`, the two
existing controllers and the design-system manifest. No sample conversations, fake
counts, preview selectors or gallery navigation enter the product.

## Composition and ownership

- `/chat` uses the actual V3 sidebar, mobile header, bottom navigation and quick actions.
  The discovery/compatibility route switch is unchanged. The application owns the only `main`.
- `ChatWorkspace` is a presentation template with slots. `ListPanel` and `DetailPanel`
  provide white rounded surfaces, shared shadows and typography. Primary-light user
  bubbles and plain assistant prose follow the approved workspace. Existing rich parts
  and task/approval controls keep their original behavior.
- The existing controllers own message/history/session state and all actions.
  `useAgentChat.displayedSession` is a readonly display projection of confirmed responses;
  it never determines request identity, storage, authorization or transport selection.
  Failed selection retains the displayed conversation's title. Session list refreshes
  supply authoritative renamed/generated titles; a response title survives list pagination.
- Legacy has only its real current conversation. Its delete button still invokes the
  destructive `clearSession`; it has no fabricated history/search/new-session controls.
  Its three quick actions, wizards, confirmation, feedback and prepend anchoring remain.
- `AssistantMessage`/`ChatInput` default visuals stay unchanged in widget/fullscreen.
  Workspace visuals are opt-in. Shared ChatInput now ignores IME Enter/229 in all contexts.

## Responsive and scroll boundaries

A single `(max-width: 1279px)` media authority controls compact mode. At 1280px and
above the list and thread share a row, with independent desktop collapse. Below it,
only the thread remains in flow. The list renders once inside the existing Radix Sheet,
with modal focus trapping, Escape, focus restoration, background aria hiding and an
inert workspace. Existing chrome hides during the Sheet scroll lock. Resizing to desktop
closes the drawer; the thread/scroller is never conditionally replaced or keyed.

The chat route uses `h-dvh` and reserves 96px plus the bottom safe inset below md;
other routes keep their original height/padding. The workspace and both panels are
bounded by `min-h-0`/overflow. Workspace-scoped CSS disables DetailPanel's outer scroll
and decorative bottom spacer, leaving each controller's original message viewport as
the sole message scroller. Composer and header stay outside that viewport.

## Live statistics

`StatsBar` uses `responsive-square` density. The app-wide provider's green
`DocumentJobsStatMini` always renders, including its own loading/error/retry behavior.
The burgundy Send card uses existing `/api/clients/stats.contractsNotSent`, whose backend
predicate matches contract-required badges; no partial dashboard rows are counted.
The burgundy warning card uses `useClientListSummary().serviceEnd.count`.

Both new queries wait for the authenticated user and aligned branch. The optional
`useDashboardStats({branchId, enabled})` API preserves existing no-argument keys/callers
and the `dashboard/stats` invalidation prefix; scoped variants isolate caches and
recheck alignment in the query function. Unavailable/error values are `—`, real zeros
are `0`, and each item's loading is independent. Errors have source-specific retry labels.

## Validation boundary

Unit tests exercise modal lifecycle, 375/1024/1279/1280 transitions, stable scroller,
callbacks/history/IME, confirmed-title races and query isolation. jsdom cannot establish
pixel geometry, actual mobile chrome layering or provider acceptance. Main owns real
Chrome screenshot/DOM/computed-style checks at 1280×900 and 375×812 and independent review.
No Storybook exists; manifest registration is checked by the existing architecture gate.

## Workspace control sizing (C3)

The approved mockup uses a 16px composer font (26px line height), with 44px mobile
send/suggestion targets. Main measured the live input at 14px/40px on mobile and
11.2px/32px on desktop with Glint 0.8. The workspace and its portal list now mark
their control scope with `data-chat-workspace-controls`. Scoped CSS keeps native
input/textarea text at 16px/26px, input minimum height at 44px and design-system
button targets at least 44px in both axes. Pixel minimums deliberately survive
Glint scaling; surrounding admin tokens, spacing and surfaces remain shared.
This includes real Agent/Legacy controls and drawer actions. Default ChatInput
widget/fullscreen consumers outside the workspace keep their original styling.

Tests apply the actual scoped CSS over the measured scaled baseline and check
both native input types, send/header/list buttons and default-widget isolation.
Main must recheck real 375×812 and 1280×900 geometry after the larger minimums.
