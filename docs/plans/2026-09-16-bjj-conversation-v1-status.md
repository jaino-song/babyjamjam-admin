# BabyJamJam conversational AI implementation status

Updated: 2026-09-17. Baseline: `4198fb991a59d63f14f529f54b1d66c1587ca76b`.
Integration: `codex/bjj-conversation-v1`. Local implementation, deterministic verification, model quality and operational activation are separate results.

| Phase | Status | Evidence / remaining gate |
| --- | --- | --- |
| 0 — baseline and policy | Closed | Isolated worktrees, accepted policy and trace records |
| 1 — shared contracts and evaluation harness | Closed | Contract/vendor checks and independent review; synthetic harness only |
| 2 — persistence and provider evaluation adapters | Closed | Additive migration compatibility, real local DB, mock provider contracts; SOL SHIP |
| 3 — owned draft APIs | Closed | Authenticated HTTP/DB replay, conflicts and scope tests; SOL SHIP |
| 4 — lifecycle and retention | Closed | Source `3b094cdfa13b20f1c08762b916c2f2f20ffcef9c`; shared23/backend436/DB73; SOL SHIP/HIGH |
| 5 — conversation intake and context | Closed | Source `2d114d147b88fc208c86ed12679cf6f9101aca56`; shared25/backend498/DB93; cumulative SOL SHIP/HIGH |
| 6 — atomic task/action approval | Closed | Source `4dd69251ebde09ed1a2eaf8228c2a08080a73bef`; shared25/backend535/DB114; cumulative SOL SHIP/HIGH |
| 7 — client writes and automation consent | Implementation in progress; PLAN APPROVE/HIGH | Shared consent contracts, pure recipes, read-only rule listing and private receipt foundation added; complete transaction/delivery integration and FINAL pending |
| 8 — desktop and mobile | Not implemented | Both renderers, protected forms and authenticated browser QA pending |
| 9 — cumulative QA and release preparation | Not implemented | Full acceptance evidence and independent cumulative review pending |

## Phase5 final verification

Exact reviewed source `2d114d147b88fc208c86ed12679cf6f9101aca56`, diff base `673807e3ef8e808c2437d9138e03f698ddaf624f`, received cumulative independent Sol **SHIP/HIGH**, with no required corrective actions. The review covered the original eight blockers and all later findings, privacy, authorization, replay, transaction integrity, shared contracts, authenticated server evidence and evaluation semantics.

Parent verification passed shared25 tests, backend498 tests across30 suites, all shared/backend/frontend/mobile type checks, backend build, capability manifest47, generated and installed vendor parity31, and diff checks. Backend lint has0errors93existingwarnings0changed-filewarnings. The guarded synthetic PostgreSQL/HTTP group passed8suites93tests, including a distinct real AppModule/JWT/TenantGuard chat suite. The reduced-module conversation tests are not relabelled full-app proof. CI discovery proves5task+3other suites with no gap or overlap; hosted CI was not run.

One earlier integrated run encountered a loopback HTTP connection timeout during concurrent validation. The unchanged source passed its serial rerun, and both DB runs for the final correction passed without retry. This history remains disclosed.

## Implemented conversation boundaries

- Current and paused work comes from owned server tasks; current-turn and field-specific references constrain model changes. Questions and exact retries preserve canonical receipts without renewing retention or repeating mutation.
- Nonclient forms bypass client intake. New unbound client forms may create a matching task only when no task is active. Against an active task they return its safe snapshot and a bounded refusal with no write authority; exact replay resolves its original receipt first. Phase8 existing-task form editing uses taskId/expectedRevision-bound APIs.
- Known-value protection unions pre-intake and newly accepted values and sanitizes summary goals/status. Replay retains protected entity memory and structural read results while disabling mutation and new choices.
- Unique and multiple customer results emit existing schema-valid server-issued selection references. A real DB test follows the emitted references through persisted candidate mapping, structured selection, canonical client target and consumed candidate state.
- Conversion refusal or failure after a write rolls back source, destination, receipt and retention changes. Expired/purged replay and tenant/owner mismatches remain rejected.

## Product evaluation remains incomplete

The latest guarded product CLI intentionally exits1 for its failing report: **0passed / 48failed / 0not_evaluated**, 158suppliedmismatches, 192missingobservations, zero semantic events, and zero network/transport/safety violations. This is not an acceptance score or actual model-quality result.

Four stock registration fixtures use unlabelled synthetic-token input unsupported by strict labelled intake. The injected static no-tool model supplies no read outcomes. Later action/provider evidence is unimplemented, and current-host authority outcomes are uninstrumented. The report separates these causes. An explicit-label positive evaluator case proves real draft/receipt creation, retry and fresh-runtime restoration. The separate synthetic harness48/48 does not establish product correctness.

## Next step and completion boundaries

At2026-09-17 09:51KST, a fresh approved direct-DeepSeek read-only scout at the Phase5 close commit `a5409c55a9c596df9d3cd84a209432bd44934846` again failed with `402 Payment Required: Insufficient Balance` after its built-in retries. The scout returned no source findings and reported inner explorer exit1. An ancillary Context7 authentication warning also appeared; the model request itself failed for insufficient balance. No fallback role/model or main-agent source exploration was used. The supplied Explorer Model Policy requires fail-closed handling. This was the prior blocking condition. The user subsequently authorized replacing exploration with Luna/medium/fast. Three native read-only Codex scouts at source `b79cea5faa8324a0ec78fe1d18834a4945316eb2` completed successfully, verifying action/task transaction seams, recovery/retention and protected action presentation. The task-local invocations explicitly selected gpt-5.6-luna, medium effort and fast service; provider-tier metadata was not separately exposed. Global agent configuration remains unchanged. Phase6 now proceeds to independent PLAN review and direct implementation after that gate.

- Full implementation and deterministic acceptance: **not complete**; Phases7–9 remain.
- Actual Google/OpenAI conversation quality evaluation: **deferred**; no paid product-model evaluation performed.
- Environment-branch merge, deployment and operational activation: **not performed**.
- No actual SMS or external business effects were performed. Local DB checks use isolated synthetic data and vendor stubs.

Detailed accepted decisions, phase audits and correction history: [implementation record](2026-09-16-bjj-conversation-v1.md).

### Phase6 implementation candidate (2026-09-17)

- SOL PLAN re-review APPROVE/HIGH at phase base `3b8ace335df3788b9a4d1eaf0426590657f4954a`; live-operation amendment accepted. Actual state label is `confirming_target`.
- DIRECT main candidate: closed task/action live operations; immutable review binding; preparation/revalidation before locks; atomic claim audit and event; separate inactive recovery; scheduled seven-day terminal retention; safe linked result projection.
- A narrow evaluation adapter compatibility change explicitly refuses unsupported action persistence instead of fabricating evidence. No fixture/oracle/score changes.
- Local read-only scout E: Luna/medium/configured fast, exit0. No global config edits.
- Candidate is not Phase6 close: frozen checks, guarded PostgreSQL barriers, cumulative independent SOL FINAL remain pending. Later Phase7–9 and paid quality/activation remain pending.

### Phase6 conversation bridge amendment

- Additional SOL PLAN APPROVE/HIGH at `09f03f9d489c4a939e3f4ce20ee318b57db85b8c`: awaiting-review corrections and bounded explicit review/task-cancel utterances. No model command/approval tool.
- Internal command marker is reconstructed only from committed `command:prepare-review` / `command:cancel` receipts, including first responses and retries; historical intake receipts never gain new command authority.
- Busy/malformed task and command turns suppress model writes while retaining safe task references and read tools. Model task selection checks current session/capability before resolving references.
- Candidate2 gates: shared25/backend502 across31 suites, all app types/build/manifest47/vendor PASS; lint0errors93baselinewarnings0changed. DB9suites112 passed. CI partition6task+3other covers9 with no overlap.
- First DB run recorded94passed/10failed:8 test owner-shape errors and one stale test barrier corrected. A separate HTTP426 was not explained by current source; baseline runtime14 and later current full112 tests passed. No speculative version-header/product fix was applied. Preserve this transient verification limitation.
- Postwrite-refusal correction at `c64d9f3d6c80929556a4cae49585a614988abadf`: focused real DB20/20 passed. Latest conversation bridge now awaits integrated frozen checks, DB and SOL FINAL. Phase6 remains OPEN.

### Phase6 close (2026-09-17)

Exact source `4dd69251ebde09ed1a2eaf8228c2a08080a73bef`, phase base `3b8ace335df3788b9a4d1eaf0426590657f4954a`, received independent cumulative SOL **SHIP/HIGH**, no blockers or required corrections. Earlier candidate/pending statements above are historical and superseded by this close.

Frozen parent evidence: shared25; backend535 across32 suites; guarded real PostgreSQL/HTTP/AppModule9 suites114 tests (including21 task/action concurrency/recovery tests); all four app/shared type gates; backend build; manifest47; generated/installed vendor31; diff; lint0errors93baselinewarnings0changedwarnings. CI discovery6task+3other=9, complete and disjoint. Hosted CI not run.

Review covers immutable task/action review binding, atomic correction/cancel/claim and audit attribution, inactive result recovery, seven-day terminal retention, safe linked transcript projection, and committed-operation conversational command replay. Provider effects remain outside task locks. Legacy unlinked actions remain compatible. No schema/dependency/auth-core/UI/provider/automation changes occurred in Phase6.

The transient earlier HTTP426 remains unexplained; unchanged baseline runtime14 and latest cumulative114 pass. No speculative protocol fix was made. The product CLI still honestly exits1 at0/48 passed: fixture grammar, no-tool driver and missing action/authority/provider instrumentation remain disclosed; it is not Phase6 acceptance or model-quality evidence.

Phase7 proceeds as DIRECT main / heavy / local / SOL. Luna medium configured-fast read-only scouts identified existing private rule recipes, intent deletion, payload-replacement/retry boundaries and scheduler regeneration. Task-specific no/noSend must cover subsequent task-caused scheduling without imposing a global customer messaging ban. No Phase7 implementation or operational activation is claimed yet.

### Phase7 foundation checkpoint (2026-09-17, not a phase close)

Phase base `caffb18f1599e36dfe3bf63c36d92044fdad4394`. Concrete [Phase7 contract](2026-09-17-bjj-conversation-phase7.md) and its narrow read-capability amendment received SOL PLAN APPROVE/HIGH. The implementation remains DIRECT main/local; independent SOL FINAL is still required.

Implemented foundation: strict aggregate automation-question contracts and safe count-only transcript projection; digest-only effect/append-only-chain validation and strict storage parsers; optional private effect-receipt references constrained to the executing action's reviewed task/revision. Hashes provide integrity only; these helpers do not independently establish send authority. The customer/task planner, durable record writer, strong review policy and materialization/dispatch/retry enforcement are not wired yet.

Extracted existing client/assignment recipes without changing recipient, calendar, variable-minimization or schedule-fingerprint semantics. Preview can reuse these pure recipes; the existing materializer already does. `automation.list` now resolves persisted rules and effective overrides without default provisioning. Ordinary management listing retains default provisioning. New real-AppModule two-client DB regression includes a positive ordinary-provisioning control; execution evidence will be recorded after source freeze.

Development checks: shared28; agent/client/message/read/recipe group528 across32 suites; existing messaging/retry363 across8 suites; backend types passed. Initial recipe regression exposed12 tests calling the removed private variable builder; those tests now call the extracted real builder with unchanged assertions and pass. No runtime compatibility shim was added solely for the tests. A removed shared calendar helper call was found by type checking and corrected. Full frozen checks/DB proof/FINAL remain pending. Generated declaration ordering changed with the emitter; installed vendor parity will be rechecked at freeze.

Task-specific user authorization continues Luna/medium/read-only exploration (native role, configured fast/priority); no global settings changed. Vault search still fails because the local vault CLI cannot resolve `@covenant-labs/vault-contracts`; no successful retrieval/capture is claimed or vault files edited. No paid product-model calls, external messages, environment merge or activation.

Frozen foundation source `38ca86543d8cfda70df0d5c1b00df00f260b484d`: shared28; backend agent/client/repository545 across35 suites; messaging429 across11 suites; all shared/backend/frontend/mobile types; backend build; lint0errors93baselinewarnings0changedwarnings; generated and installed vendor31; diff checks passed. Real AppModule/synthetic PostgreSQL readonly/default-provisioning controls2/2 passed. The initial manifest check correctly failed on the changed message-provider source digest; generated manifest was refreshed (digest-only diff, same47 capabilities) and its separate check passed. This checkpoint is not full Phase7 acceptance or SOL FINAL.

### Phase7 question state and approved schedule identity correction

Implemented server question helpers with canonical whole-set references, stale-answer refusal, same-impact consent continuity and noSend reset rules. Optional protected question/descriptor state round-trips through the task repository with strict validation; owned snapshots project only the public question. Malformed present state fails closed instead of becoming a legacy task. These helpers are not yet wired into task evaluation/approval; stale refresh transactions and natural-language grounding remain pending.

Independent SOL scope review identified that schedule rows had no immutable creation identity. The user explicitly approved the exact [UUID column/index/immutability-trigger proposal](2026-09-17-bjj-conversation-schedule-identity-proposal.md), and corrected SOL PLAN returned APPROVE/HIGH. Private authority scopes now distinguish rule and recipient and carry schedule identity. Identity-free lineage keys detect known provenance even if a numeric ID is reused; full scope comparison then refuses a new incarnation. This replaces only Phase7's previous no-schema assumption.

Added migration `20260917000000_add_schedule_incarnation_identity`. Prisma generated successfully without new dependencies. Against the guarded synthetic database, source/applied migration inventory proved this was the only pending migration (71 existing), then migrate deploy applied it successfully (72 total). An isolated schema probe ran the exact migration over pre-existing rows and verified backfill/default/uniqueness/immutability/recreation/rollback/catalog checks; the probe schema was removed. No other database was altered. Real schedule E2E and cumulative DB regression will be recorded after source freeze.

Current development checks: question/scope/storage/repository42 passed; broader agent/repository431 across30 suites passed; backend types and changed-file lint passed. Remaining Phase7 work includes the actual impact planner, owned refresh/event operations, effective strong approval, committed consent storage, ordinary supersession, intent/materialization and dispatch/retry fences. Full Phase7 FINAL remains pending.

### Phase7 foundation review and correction (not a phase close)

Frozen source `2ddc37ff0618955328f2719da6e7e3576e1b7c31`: shared28, backend557 across36 suites, messaging429 across11 suites, real synthetic PostgreSQL/HTTP/AppModule120 across11 suites passed. Shared/backend/frontend/mobile types, backend build, manifest47, generated/installed vendor31, diff and lint0errors93baselinewarnings0changedwarnings passed. CI discovery8task+3other=11 was complete/disjoint; hosted CI remains unrun.

Independent scoped SOL FINAL returned **FIX_REQUIRED/HIGH** with two medium blockers: denial/noSend must match the current recipe and member before suppression; protected effect parsing must enforce each kind's canonical rule/template/recipient ownership. Corrections now require nonempty affected denial sets, validate source/member before either allow or suppress, and reject forged client/employee/service-record combinations using existing catalog and dedicated rule constants. Regression cases cover stale deny/noSend, empty denial, substituted member and cross-kind questions/storage. This is a foundation correction, not approval of the unwired Phase7 execution path.

Also extracted the existing client-write normalization into one descriptor used by create, update inspection, ordinary capability execution and approved-target execution. Canonical voucher lookup remains in its existing read path; partial updates retain omission semantics, explicit clears and contracted duration rules. Added focused input tests for Korean holidays, offset calendar dates, voucher pricing and metadata exclusion. Development provider/normalization74 tests passed; a test-only unsupported `Object.hasOwn` usage was replaced without changing compiler configuration. Type checking then identified an unnamed exported return type; an explicit existing return-type reference fixes declaration emission. Frozen correction verification and independent re-review are next.

The correction at `e0f15f6658e12c0aba6f4beceb555b1b0f332db1` received fresh scoped SOL **SHIP/HIGH**, no remaining findings. Exact evidence: shared28, backend571 across37 suites, messaging429 across11 suites, guarded DB/AppModule120 across11 suites, all types/build/manifest47/vendor31/diff, lint0errors93baseline0changed, CI partition8+3 complete. This resolves the preceding two foundation blockers and approves the normalization correction scope only; Phase7 remains open.

### Phase7 read-only planning inputs and recipe descriptor

Added read-only settings/source methods on the existing trigger service. Default detection shares the ordinary provisioner's branch-owned/template matching; a global internal marker cannot masquerade as a branch default. The existing materializer now reads through the same customer-source method. Settings/schema absence is distinguished from disabled policy; no preview path provisions defaults.

Added the client-rule descriptor building block using the existing pure materialization recipe and actual canonical SMS renderer. It hashes relevant source, recipient, rendered content, template/config versions, scheduling recipe and supplied policy; it returns no raw customer/body/phone data. Creation-time scheduling is a bounded recipe, so preview time and a temporary client ID do not change consent identity. Missing sender identity, unsupported content or required generated links cannot grant positive consent. The caller still must supply trusted provider identity, account for pending cancellations/schedule effects and bind the complete set into task persistence; this helper is not the complete impact planner or an execution authority.

Development tests for this layer and existing message-trigger behavior:235 across3 suites passed; backend types passed. Extended real-AppModule proof will check source/settings/rendering without customer/settings/rule/job/log writes, model calls or SMS. The full planner, stale refresh, durable authority and delivery enforcement remain pending; no Phase7 close or UI integration is claimed.


The read-only input/recipe source at `eb063c08adf5ed99801730a22a6d6a631ec9d8cc` passed frozen shared28, backend571/37, messaging440/12, guarded PostgreSQL/AppModule121/11, all types/build/manifest47/vendor31/diff and lint0errors93baseline0changed. A source/diff security scan found no new secret patterns or env/dependency files; this is not a vulnerability certification. Independent review of this incremental read-only layer remains pending.

### Phase7 configured sender identity

The existing Aligo adapter now exposes an optional strict read-only default-sender policy. It hashes the actual cached normalized sender and configured provider endpoint, never returns raw configuration or credentials, and performs no provider request. Unconfigured, malformed, throwing and legacy adapters report unavailable. A small exported Aligo module service reads only the selected adapter; explicit-sender requests and existing sending behavior are unchanged. No new environment variable, dependency or auth-core change.

Existing E2E vendor stubs use a distinct synthetic `stub` identity namespace, so required positive controls can exercise the actual AppModule while a stub descriptor cannot match live delivery. The AppModule read-only test now obtains this actual configured stub identity instead of a supplied digest. Development sender/Aligo/stub/send-usecase checks26/4 and backend types pass. Frozen verification and independent review remain pending. This seam alone grants no consent or send authority; rollback removes the optional method/service while leaving existing delivery intact.
