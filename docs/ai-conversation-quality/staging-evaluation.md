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

## Artifact boundary

The output is `conversation-staging-evaluation-v1` JSON. It includes the fixture, assertion, and selected-case digests. Each record contains the synthetic case ID and partition, provider/profile/model metadata, deterministic fixture/prompt/context versions, repeat index, latency, bounded usage, outcome, required-token and structured-event scores, and a SHA-256 response hash. Aggregate counts, latency percentiles, usage totals, and optional estimated cost are included. Raw prompts, responses, headers, keys, and provider error bodies are never recorded.
