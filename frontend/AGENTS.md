# Repo Instructions

- Treat the primary checkout as the `preview` anchor checkout. Do not use the primary checkout for day-to-day feature development unless the task is specifically about `preview` synchronization, repo maintenance, or worktree management.
- Prefer one worktree per active branch/task when work is expected to live longer than a quick edit, when you need to switch contexts frequently, or when the task may overlap with another in-progress branch.
- Create feature worktrees as sibling directories outside the primary checkout, preferably under a shared `worktrees/` folder. Use a filesystem-safe folder name derived from the branch name by replacing `/` with `-`.
- If a dedicated `dev` worktree is used, reserve it for the single current primary development branch only. Do not treat `dev` as a general-purpose shared worktree for unrelated branches.
- Keep the number of active worktrees small. Prefer roughly 3-5 active worktrees. Remove merged or abandoned worktrees promptly instead of keeping them around indefinitely.
- Before deleting a worktree, check whether it is dirty. If it contains uncommitted changes, either commit them, move them to a backup branch, or stash them intentionally. Do not discard dirty worktrees casually.
- After a branch is merged, remove its worktree and then delete the local branch if it is no longer needed. Also run `git worktree prune` periodically to clear stale metadata.
- When the primary repository path is renamed or moved manually, repair linked worktrees from the primary checkout with `git worktree repair <path>...` before doing other Git operations.
- Recommended worktree commands:
  - Create a new worktree from `preview`:
    `git worktree add -b <branch> ../worktrees/<branch-slug> preview`
  - Attach an existing branch:
    `git worktree add ../worktrees/<branch-slug> <branch>`
  - Remove a clean worktree:
    `git worktree remove ../worktrees/<branch-slug>`
  - Clean stale metadata:
    `git worktree prune`

- When the user explicitly asks to "use MAGI", "run MAGI", "do a MAGI deliberation", or equivalent, run `./bin/magi -- "<user question>"` from the repo root.
- If the user explicitly asks for a deeper or more adversarial MAGI pass, run `./bin/magi --deep -- "<user question>"`.
- Treat MAGI as an explicit opt-in workflow. Do not use it automatically for unrelated requests.
- If `OPENAI_API_KEY` is unavailable or the MAGI command fails, say so briefly and fall back to normal Codex reasoning or sub-agents.
