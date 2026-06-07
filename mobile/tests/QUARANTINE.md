| Spec | Reason | Unblocks When |
| --- | --- | --- |
| `client-creation.spec.ts` | `/clients` no longer exposes the old dialog flow; creation moved to `/clients/new` wizard. | Rewrite against the `/clients/new` wizard flow. |
| `alimtalk-settings.spec.ts` | Navigates removed routes `/settings/general` and `/settings/voucher-price`, which now 404. | Rewrite against the current settings information architecture. |
| `nav-indicator-diagnose.spec.ts` | Local-only diagnostic that depends on real login and timing capture. | Keep local-only by design. |
| `nav-slide-dense.spec.ts` | Local-only diagnostic that depends on real login and dense frame capture. | Keep local-only by design. |
| `animation-plan-visual-verify.spec.ts` | Visual animation diagnostic that is timing-fragile in CI. | Keep local-only by design. |
| `dashboard-activities-animation.spec.ts` | Animation diagnostic built around event collection timing. | Keep local-only by design. |
| `chat-live-stream.spec.ts` | Calls real `/api/ai/chat/stream`; CI backend has no Gemini vendor stub and needs `GEMINI_API_KEY`. | Add backend e2e Gemini stubs or provide a usable key in CI. |
