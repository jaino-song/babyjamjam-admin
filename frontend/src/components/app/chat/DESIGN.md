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
