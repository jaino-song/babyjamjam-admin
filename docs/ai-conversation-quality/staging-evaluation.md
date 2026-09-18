# Staging synthetic conversation evaluation

`evals/conversation/staging-evaluation-runner.ts` is the opt-in runner for comparing the current and improved context profiles against the 48 synthetic fixtures in `evals/conversation/cases.ts`. It imports only the fixture and provider codec layers. It does not load product runtime services, customer data, a database, or SMS providers.

## Dry run

Dry run validates the provider/profile/model matrix and prints a redacted plan. It does not require keys and never creates a transport:

```bash
pnpm --filter ./backend exec ts-node --transpile-only --compiler-options '{"module":"CommonJS"}' ../evals/conversation/staging-evaluation-runner.ts \
  --dry-run \
  --provider both \
  --google-current-profile google-current \
  --google-improved-profile google-improved \
  --google-current-model gemini-2.5-flash \
  --google-improved-model gemini-2.5-flash \
  --openai-current-profile openai-current \
  --openai-improved-profile openai-improved \
  --openai-current-model gpt-4.1-mini \
  --openai-improved-model gpt-4.1-mini
```

## Explicit live evaluation

Live calls require `--execute`, both profile/model pairs, a provider key, and an output path. The default repeat count is 3; `--repeat` is bounded to 1–20. Use `--partition development` or `--partition holdout` to limit the fixture set.

```bash
export CONVERSATION_EVAL_GOOGLE_API_KEY='…'
export CONVERSATION_EVAL_OPENAI_API_KEY='…'
pnpm --filter ./backend exec ts-node --transpile-only --compiler-options '{"module":"CommonJS"}' ../evals/conversation/staging-evaluation-runner.ts \
  --execute \
  --provider both \
  --google-current-profile google-current \
  --google-improved-profile google-improved \
  --google-current-model gemini-2.5-flash \
  --google-improved-model gemini-2.5-flash \
  --openai-current-profile openai-current \
  --openai-improved-profile openai-improved \
  --openai-current-model gpt-4.1-mini \
  --openai-improved-model gpt-4.1-mini \
  --repeat 3 \
  --partition holdout \
  --output /tmp/bjj-conversation-evaluation.json
```

The same values can be supplied with flags or environment variables. Provider-specific variables take precedence over generic variables: `CONVERSATION_EVAL_<PROVIDER>_CURRENT_PROFILE`, `..._IMPROVED_PROFILE`, `..._CURRENT_MODEL`, `..._IMPROVED_MODEL`, `..._API_KEY`, and `..._REASONING_CONTINUATION`. `GOOGLE_API_KEY` and `OPENAI_API_KEY` are accepted as fallback key names. The runner never prints or writes key values.

## Cost rates

Provider pricing is deliberately not baked into the evaluator. To estimate cost in the JSON report, configure both rates for each provider as USD per 1,000 tokens:

```bash
export CONVERSATION_EVAL_GOOGLE_INPUT_USD_PER_1K='0.0001'
export CONVERSATION_EVAL_GOOGLE_OUTPUT_USD_PER_1K='0.0004'
export CONVERSATION_EVAL_OPENAI_INPUT_USD_PER_1K='0.00015'
export CONVERSATION_EVAL_OPENAI_OUTPUT_USD_PER_1K='0.0006'
```

The equivalent flags are `--google-input-rate`, `--google-output-rate`, `--openai-input-rate`, and `--openai-output-rate`. If either rate for a provider is absent, that provider's estimated cost is recorded as `"unavailable"`. Rates are operator-supplied and should be refreshed when provider pricing changes.

## 2026-09-18 staging result

- Google `gemini-2.5-flash`, current/improved context, all 48 synthetic cases × 3 repeats: **288 runs**; 278 responses and 10 errors (9 transport failures, 1 malformed response).
- Required synthetic token matches: **213/324 (65.7%)**. Structured-event matches: **179/576 (31.1%)**. These results are below the proposed 95% verification threshold and do not qualify as a model-quality pass.
- Outcomes: 108 text, 170 tool-call responses, 10 errors. Latency: p50 **2,207 ms**, p95 **8,254 ms**, max **10,002 ms**. Provider usage/cost was recorded as unavailable when the provider response did not expose a complete usage tuple.
- Holdout partition: 96 runs, 7 errors, required tokens **58/96**, structured events **67/186**. Development partition: 192 runs, 3 errors, required tokens **155/228**, structured events **112/390**.
- Fixture digest `24ab8fb9498ba7472972c6d3a66b2d19274bc47787f96e5f34e9d8a1abc97d4a`, assertion digest `8c6070f04f167f22e211d113d0fe6e64b2af8491057f861609f8d5d8c2042af4`, selection digest `b5d04ef30ce7401ad279b966b1d2ad4d3f2f1dc5292584967ef7e2d3d4ec801a`.
- Redacted artifact: [`2026-09-18-google-all.json`](./artifacts/2026-09-18-google-all.json). It contains no raw prompts, responses, headers, keys, or customer data.
- OpenAI execution was attempted in the same staging runner but refused before transport creation with `MISSING_API_KEY`; no OpenAI artifact or network request was produced. A key must be supplied before the Google/OpenAI comparison is complete.

## Artifact boundary

The output is `conversation-staging-evaluation-v1` JSON. It includes the fixture, assertion, and selected-case digests. Each record contains the synthetic case ID and partition, provider/profile/model metadata, deterministic fixture/prompt/context versions, repeat index, latency, bounded usage, outcome, required-token and structured-event scores, and a SHA-256 response hash. Aggregate counts, latency percentiles, usage totals, and optional estimated cost are included. Raw prompts, responses, headers, keys, and provider error bodies are never recorded.
