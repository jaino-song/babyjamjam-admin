| Spec | Reason | Unblocks When |
| --- | --- | --- |
| `nav-indicator-diagnose.spec.ts` | Local-only diagnostic that depends on real login and timing capture. | Keep local-only by design. |
| `nav-slide-dense.spec.ts` | Local-only diagnostic that depends on real login and dense frame capture. | Keep local-only by design. |
| `animation-plan-visual-verify.spec.ts` | Visual animation diagnostic that is timing-fragile in CI. | Keep local-only by design. |
| `dashboard-activities-animation.spec.ts` | Animation diagnostic built around event collection timing. | Keep local-only by design. |
