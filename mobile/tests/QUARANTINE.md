| Spec | Reason | Unblocks When |
| --- | --- | --- |
| `nav-indicator-diagnose.spec.ts` | Local-only diagnostic that depends on real login and timing capture. | Keep local-only by design. |
| `nav-slide-dense.spec.ts` | Local-only diagnostic that depends on real login and dense frame capture. | Keep local-only by design. |
| `animation-plan-visual-verify.spec.ts` | Visual animation diagnostic that is timing-fragile in CI. | Keep local-only by design. |
| `dashboard-activities-animation.spec.ts` | Animation diagnostic built around event collection timing. | Keep local-only by design. |
| `chat-feedback.spec.ts` | The chat feedback UI (`MessageFeedback` thumbs) has no production mount: only the unmounted `ChatFullscreen` renders it, and the `/chat` page's local `AssistantMessage` does not. Users currently cannot submit chat feedback on mobile even though the backend routes and the admin review page exist. | Product decision: re-mount the feedback UI (e.g. on `/chat` assistant messages), then point the spec at it. |
| `screenshots/baseline.spec.ts` | Visual baseline capture tool — screenshots with zero assertions; relies on `networkidle`, which never settles against the polling app. | Keep local-only by design (run manually to refresh baselines). |
