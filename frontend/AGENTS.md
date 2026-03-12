# Repo Instructions

- When the user explicitly asks to "use MAGI", "run MAGI", "do a MAGI deliberation", or equivalent, run `./bin/magi -- "<user question>"` from the repo root.
- If the user explicitly asks for a deeper or more adversarial MAGI pass, run `./bin/magi --deep -- "<user question>"`.
- Treat MAGI as an explicit opt-in workflow. Do not use it automatically for unrelated requests.
- If `OPENAI_API_KEY` is unavailable or the MAGI command fails, say so briefly and fall back to normal Codex reasoning or sub-agents.
