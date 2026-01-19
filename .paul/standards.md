# planner-paul Operating Standards

## Complexity Determination (Task-Based)

| Complexity | Task Count |
|------------|------------|
| **Simple** | < 4 tasks |
| **Complex** | 4+ tasks |

---

## planner-paul Rules

### 1. NO SIMPLE PATH - ALWAYS COMPLEX

Every request is treated as Complex, regardless of task count.

**Reason**: Simple path would contradict mandatory TDD enforcement.

### 2. NATHAN IS MANDATORY

Nathan (Request Analyst) must be invoked for EVERY request before planning begins.

**Mandatory Workflow**:
```
Nathan (MANDATORY) → planner-paul → Timothy → Solomon → Paul executes
```

| Step | Agent | Required | Purpose |
|------|-------|----------|---------|
| 1 | Nathan | MANDATORY | Classify intent, gather context, generate guardrails |
| 2 | planner-paul | MANDATORY | Create implementation plan |
| 3 | Timothy | MANDATORY | Review implementation plan |
| 4 | Solomon | MANDATORY | Create test specifications |
| 5 | Paul | MANDATORY | Execute with TDD |

### 3. TDD IS ALWAYS ENFORCED

- No exceptions
- No "this is too simple for testing"
- Every code change gets test specifications from Solomon

---

## Paul (Executor) Rules

### Complexity Thresholds Apply

Paul uses Simple/Complex thresholds for task categorization:
- **Simple**: < 4 tasks
- **Complex**: 4+ tasks

### MANDATORY Testing Rule (NON-NEGOTIABLE)

**Regardless of Simple or Complex**, if there are **code or architectural changes**:

> **ALWAYS run testing agents. No exceptions.**

| Complexity | Code/Arch Changes? | Testing Agents Required? |
|------------|-------------------|--------------------------|
| Simple (< 4 tasks) | YES | **MANDATORY** |
| Simple (< 4 tasks) | NO | Not required |
| Complex (4+ tasks) | YES | **MANDATORY** |
| Complex (4+ tasks) | NO | Not required |

### Testing Agent Workflow

When code/architectural changes are present:

| Step | Agent | Action |
|------|-------|--------|
| 1 | Peter | Write unit tests (.test.ts) |
| 2 | John | Write E2E tests (.spec.ts) |
| 3 | Joshua | Run all tests and verify |

```
Any Task with Code/Arch Changes (Simple OR Complex):
  Peter (write tests) → John (write E2E) → Joshua (run & verify)
```

### When Testing Agents Are NOT Required

- Documentation-only changes
- Configuration-only changes (no code logic)
- Non-code file updates (README, comments, etc.)

---

## MANDATORY Agent Utilization (ALL Complexities)

**For ALL tasks (Simple AND Complex)**, Paul MUST utilize these agents via `delegate_task()` for maximum efficiency:

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| **explore** | Codebase exploration | Find patterns, existing implementations, file structures |
| **librarian** | External research | Official docs, GitHub examples, OSS references |
| **document-writer** | Documentation | README updates, API docs, code comments |
| **git-master** | Git operations | ALL commits, branch management |

### Usage Rules

1. **explore**: Always search codebase BEFORE implementing
   ```
   delegate_task(agent="explore", prompt="Find existing patterns for [feature]")
   ```

2. **librarian**: Always check external docs for unfamiliar libraries
   ```
   delegate_task(agent="librarian", prompt="Find official docs for [library]")
   ```

3. **document-writer**: Always document significant changes
   ```
   delegate_task(agent="document-writer", prompt="Update docs for [feature]")
   ```

4. **git-master**: ALWAYS use for git operations (never commit directly)
   ```
   delegate_task(agent="git-master", prompt="Commit changes with message: [description]")
   ```

### Parallel Execution for Efficiency

Launch multiple agents in parallel when tasks are independent:

```
// Parallel research phase
delegate_task(agent="explore", prompt="Find codebase patterns for X", background=true)
delegate_task(agent="librarian", prompt="Find official docs for Y", background=true)

// Continue implementation after gathering context
```

### No Exceptions

| Complexity | explore | librarian | document-writer | git-master |
|------------|---------|-----------|-----------------|------------|
| Simple | MANDATORY | MANDATORY | MANDATORY | MANDATORY |
| Complex | MANDATORY | MANDATORY | MANDATORY | MANDATORY |

---

## Summary

### planner-paul

| Rule | Status |
|------|--------|
| Complexity | Always Complex (no Simple path) |
| Nathan | **MANDATORY** |
| TDD | **MANDATORY** |

### Paul (Executor)

| Rule | Simple (< 4 tasks) | Complex (4+ tasks) |
|------|-------------------|-------------------|
| Testing (code/arch changes) | **MANDATORY** | **MANDATORY** |
| explore agent | **MANDATORY** | **MANDATORY** |
| librarian agent | **MANDATORY** | **MANDATORY** |
| document-writer agent | **MANDATORY** | **MANDATORY** |
| git-master agent | **MANDATORY** | **MANDATORY** |

### Agent Quick Reference

| Agent | Purpose |
|-------|---------|
| Nathan | Pre-planning analysis (planner-paul only) |
| explore | Codebase patterns and structures |
| librarian | External docs, OSS references |
| Peter | Write unit tests |
| John | Write E2E tests |
| Joshua | Run and verify tests |
| document-writer | Documentation updates |
| git-master | ALL git operations |

---

*Last updated: 2026-01-19*
