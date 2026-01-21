# Bug Reports: Oh My Lord OpenCode Edition

This document tracks incidents, bugs, and violations discovered in the Oh My Lord OpenCode system (Paul orchestrator + subagents).

---

## Incident #001: Subagent Scope Violation & Wrong Agent Delegation

**Date**: 2026-01-20
**Severity**: ~~HIGH~~ → MEDIUM (after investigation)
**Status**: OPEN → INVESTIGATING

### Post-Investigation Update (2026-01-20)

**Original Report**: Claimed Sisyphus-Junior modified 20+ unauthorized files and deleted plan documents.

**Actual Finding**: Upon filesystem verification:
- All "deleted" files still exist
- Source code changes are **legitimate feature implementation** (Tasks 3.2, 3.3)
- Sisyphus-Junior's response was **misleading** - showed cumulative/stale changes, not actual task changes
- The unit tests were created correctly

**Root Issue Changed**: From "subagent scope violation" to "subagent response reliability"

### Summary

During the "Editable Proprietary Templates" feature testing phase, Paul delegated a unit test creation task to the wrong agent (`Sisyphus-Junior` via `category="quick"`) instead of the designated agent (`Peter`). The subagent completed the task correctly, but its **response was misleading** - it reported file changes that were actually from previous implementation sessions, not from the current task.

### Timeline

1. Paul needed to create backend unit tests for `SystemTemplateEntity`
2. Paul delegated via `delegate_task(category="quick", ...)` instead of `agent="Peter"`
3. **Sisyphus-Junior** (session: `ses_425caf0e1ffeD6DkqGJmbo9L3B`) was assigned
4. Subagent **correctly created unit tests** (19 tests, all passing)
5. Subagent's response **falsely claimed** it modified 20+ source files and deleted plan documents
6. Paul initially believed the response, leading to incorrect bug report
7. Upon filesystem verification: all "deleted" files exist, source changes are from earlier legitimate implementation

### Violations

#### 1. Paul: Wrong Agent Delegation

**Paul's TDD Chain Protocol**:
```
Phase 1: TDD Chain (The Only Way to Write Code)
1. Plan: planner-paul → Timothy (Review)
2. Specs: Solomon (Test Specs) → Thomas (Review)
3. Red: Peter (Unit Tests) / John (E2E Tests)  <-- SHOULD USE THESE
4. Green: Delegate implementation
5. Verify: Joshua (Test Runner)
```

**What Paul Did**:
```typescript
delegate_task(
  category="quick",  // WRONG - used generic quick agent
  description="Create Backend Domain Unit Tests for SystemTemplateEntity",
  ...
)
```

**What Paul Should Have Done**:
```typescript
delegate_task(
  agent="Peter",  // CORRECT - Peter handles Unit Tests
  description="Create Backend Domain Unit Tests for SystemTemplateEntity",
  ...
)
```

**Similarly for E2E tests**, Paul should have used `agent="John"` instead of background tasks with `category="quick"`.

#### 2. Sisyphus-Junior: Misleading Response (CORRECTED)

**Task Instructions (MUST NOT DO)**:
```
- Don't modify any source files
- Don't create integration tests (already done)
```

**What Sisyphus-Junior's Response Claimed**:
```
Modified files: (20+ files listed)
Deleted files: .paul/plans/*.md, .paul/standards.md
```

**CORRECTION - Upon Investigation**:

After reviewing the actual git diff and filesystem:

1. **Files were NOT deleted** - All `.paul/plans/*.md` files (24 total) and `.paul/standards.md` still exist
2. **Source code changes are LEGITIMATE** - They are from earlier implementation tasks (Phase 3: Migration):
   - `*MessageForm.tsx` changes = Task 3.2 (Refactor forms to use new system)
   - `*Msg.ts` deprecation comments = Task 3.3 (Add deprecation notices)
   - `messages/page.tsx` = Feature enhancement (dropdown with system templates)
   - `backend/app.module.ts` = Task 1.6 (Adding new modules)

3. **Subagent response was MISLEADING** - The "file changes summary" appears to be from:
   - Previous implementation session state
   - Boulder state showing cumulative changes
   - NOT from the current unit test task

**Actual Violation**: Sisyphus-Junior's response misrepresented what it actually did during the task. The unit tests were created correctly, but the response included unrelated file change data.

#### 3. Paul: Incomplete Verification

Paul verified:
- [x] Tests pass
- [x] Builds pass
- [x] LSP diagnostics clean

Paul did NOT verify:
- [ ] Subagent only modified expected files
- [ ] No unauthorized source changes
- [ ] Plan files still intact

### Impact (CORRECTED)

| Impact Area | Description |
|-------------|-------------|
| ~~Source Code~~ | ~~Unauthorized modifications to 20+ files~~ **CORRECTED**: Changes are legitimate feature implementation |
| ~~Documentation~~ | ~~16+ plan files deleted~~ **CORRECTED**: All files intact (24 plan files exist) |
| ~~Standards~~ | ~~.paul/standards.md deleted~~ **CORRECTED**: File exists |
| Trust | Subagent response cannot be trusted - reported false/misleading file changes |
| Confusion | Misleading response caused incorrect bug report, wasted investigation time |

### Root Cause Analysis

1. **Paul bypassed TDD Chain**: Used generic `category="quick"` instead of designated `agent="Peter"` for unit tests
2. **Sisyphus-Junior lacks constraints**: The "quick" category agent doesn't have strict scope enforcement
3. **Verification gap**: Paul's verification checklist doesn't include "file scope audit"
4. **Agent availability unclear**: Paul's rules define specialized agents (Peter, John, Joshua, etc.) for TDD workflow, but the system reports "No specialized agents available" - suggesting these agents may not be implemented yet or require different invocation

> **Note**: This incident reveals a potential gap between Paul's documented TDD Chain (which references Peter/John/Joshua) and the actual available agents in the system. Paul should clarify whether these agents exist and how to invoke them, or update the TDD Chain to use available categories/agents.

### Corrective Actions

#### Immediate
- [x] ~~Revert unauthorized source file changes~~ **NOT NEEDED**: Changes are legitimate
- [x] ~~Restore deleted `.paul/plans/*.md` files~~ **NOT NEEDED**: Files were never deleted
- [x] ~~Restore `.paul/standards.md`~~ **NOT NEEDED**: File exists
- [ ] Investigate why Sisyphus-Junior's response contained false file change data
- [ ] Check if boulder state is leaking into task responses

#### Process Improvements
- [ ] Paul MUST use designated agents from TDD Chain:
  - Unit Tests → `agent="Peter"`
  - E2E Tests → `agent="John"`
  - Test Runner → `agent="Joshua"`
- [ ] Add verification step: "Check subagent modified ONLY expected files"
- [ ] Sisyphus-Junior needs stricter scope constraints

#### Open Questions
- [ ] **Are Peter/John/Joshua implemented?** Paul's rules reference these agents but system says "No specialized agents available". Need to:
  - Verify if these agents exist in the oh-my-lord-opencode system
  - If not, either implement them OR update Paul's TDD Chain to use existing agents/categories
  - Document the correct way to invoke TDD-specific agents

### Responsibility Attribution (CORRECTED)

| Party | Responsibility | Reason |
|-------|---------------|--------|
| **Paul** | 30% | Used wrong agent category (`quick` instead of `Peter`), didn't verify response accuracy |
| **Sisyphus-Junior** | 40% | Returned misleading response with false file change data |
| **System/Boulder** | 30% | May have leaked cumulative session state into task response |

### Lessons Learned

1. **Follow the TDD Chain** - The designated agents exist for a reason
2. **Subagent responses can be MISLEADING** - The "file changes" list may not reflect actual task changes
3. **Verify response against filesystem** - Don't trust response summaries; check `git status` and `git diff` yourself
4. **Boulder state may leak** - Task responses may include cumulative changes from previous sessions
5. **Generic agents have less context isolation** - `category="quick"` may inherit stale session data

---

## Incident #002: Planner Agent Creates Execution Todos Causing Infinite Loop

**Date**: 2026-01-20  
**Severity**: MEDIUM  
**Status**: OPEN

### Summary

`planner-paul` (the planning agent) created execution todos using `mcp_todowrite` at the end of its planning phase. These todos were meant for `Paul` (orchestrator) to execute, but they were registered in the **planner's session**. The system's automated TODO continuation loop then repeatedly prompted the planner to complete these tasks, creating an infinite loop since the planner cannot execute code.

### Timeline

1. User requested a "Chat History Persistence" feature
2. `planner-paul` completed all planning tasks:
   - Nathan analysis ✅
   - Codebase research ✅
   - Requirements interview ✅
   - Implementation plan (`.paul/plans/chat-history-persistence.md`) ✅
   - Timothy review → APPROVED ✅
   - Solomon test planning (`.paul/plans/chat-history-persistence-tests.md`) ✅
3. `planner-paul` used `mcp_todowrite` to create 9 execution todos for Paul:
   ```
   exec-1: Update ChatSessionEntity for pagination...
   exec-2: Create GetChatHistoryUseCase...
   ...
   exec-9: Final QA & Requirements Audit...
   ```
4. System's automated TODO continuation directive fired:
   ```
   [SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION]
   Incomplete tasks remain in your todo list...
   [Status: 0/9 completed, 9 remaining]
   ```
5. `planner-paul` correctly refused to execute (per its ABSOLUTE EXECUTION PROHIBITION)
6. Loop continued 30+ times until user intervened

### Violations

#### 1. planner-paul: Created Todos in Wrong Session

**planner-paul's Workflow (Phase 3 Step 3)**:
```
3. **SETUP EXECUTION TODOS (MANDATORY FINAL STEP)**:
   - Read your own plan `.paul/plans/{name}.md`.
   - Extract the TODO items from the `## TODOs` section.
   - Use `todowrite` to create the **execution todo list** for Paul.
```

**The Problem**: The workflow instructs planner to create todos "for Paul", but `mcp_todowrite` creates todos **in the current agent's session**. There is no mechanism to create todos for a different agent.

**What planner-paul Did**:
```typescript
mcp_todowrite(todos=[
  { id: "exec-1", content: "Update ChatSessionEntity...", status: "pending", ... },
  // ... 8 more execution tasks
])
```

**What Should Happen**:
- Option A: planner-paul should NOT create execution todos (just document them in plan.md)
- Option B: A mechanism to create todos for another agent should exist
- Option C: planner-paul's workflow should be updated to remove this step

#### 2. System: TODO Continuation Loop Has No Agent-Type Awareness

The `[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION]` system:
- Sees incomplete todos
- Prompts the current agent to complete them
- Does NOT check if the todos are within the agent's permitted scope
- Does NOT have a circuit breaker for repeated refusals

### Impact

| Impact Area | Description |
|-------------|-------------|
| User Experience | User had to manually intervene after 30+ loop iterations |
| Token Waste | Each loop iteration consumed tokens for the prompt and refusal response |
| Agent Confusion | planner-paul's workflow says to create todos, but doing so causes a loop |
| Session Stuck | Agent session cannot proceed until todos are cleared or user switches |

### Root Cause Analysis

1. **Workflow Design Flaw**: planner-paul's instructions say to create execution todos "for Paul", but `mcp_todowrite` has no cross-agent capability
2. **TODO System Lacks Context**: The continuation system doesn't understand agent roles/constraints
3. **No Escape Hatch**: planner-paul cannot clear/cancel todos it created, and the system keeps prompting

### Corrective Actions

#### Immediate
- [ ] Update `planner-paul` workflow to REMOVE the "create execution todos" step
- [ ] Document that execution todos should be created by `Paul` when it reads the plan

#### System Improvements
- [ ] Add agent-type awareness to TODO continuation system:
  - If agent is `planner-*`, skip execution todos
  - Or: Add `todo.assignedAgent` field to route todos correctly
- [ ] Add circuit breaker: After 3 refusals, stop prompting and notify user
- [ ] Consider: `mcp_todowrite` could have an `assignTo` parameter for cross-agent todos

#### Documentation
- [ ] Update planner-paul's SKILL.md to clarify:
  - "Do NOT use `mcp_todowrite` for execution tasks"
  - "Document execution tasks in the plan file only"
  - "Paul will create its own todos when executing"

### Responsibility Attribution

| Party | Responsibility | Reason |
|-------|---------------|--------|
| **planner-paul (Agent)** | 20% | Followed its workflow instructions which said to create todos |
| **planner-paul (Workflow)** | 40% | Workflow design instructs planner to create todos without cross-agent mechanism |
| **TODO Continuation System** | 40% | No agent-type awareness, no circuit breaker, keeps looping |

### Lessons Learned

1. **Todos are session-scoped**: `mcp_todowrite` creates todos for the CURRENT agent, not for named agents
2. **Planner agents should not create execution todos**: Document execution steps in plan files instead
3. **System loops need escape hatches**: Automated prompts should have circuit breakers
4. **Agent role constraints should be system-aware**: The TODO system should understand that planners can't execute
5. **Cross-agent handoffs need explicit mechanisms**: Currently there's no way for planner to "hand off" todos to Paul

---

## Template for Future Incidents

```markdown
## Incident #XXX: [Title]

**Date**: YYYY-MM-DD
**Severity**: LOW | MEDIUM | HIGH | CRITICAL
**Status**: OPEN | INVESTIGATING | RESOLVED

### Summary
[Brief description]

### Timeline
1. [Step 1]
2. [Step 2]

### Violations
[List of rule violations]

### Impact
[What was affected]

### Root Cause Analysis
[Why it happened]

### Corrective Actions
[What to do about it]

### Responsibility Attribution
[Who is at fault and why]

### Lessons Learned
[What to remember]
```

---

*This document is maintained by Paul (Lord Edition v2) for quality assurance purposes.*
