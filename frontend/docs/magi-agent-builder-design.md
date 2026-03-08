# MAGI Agent Builder Design

Date: 2026-03-07
Target: OpenAI Agent Builder
Purpose: Recreate the MAGI deliberation system as a reusable OpenAI workflow

## Sources

- Agent Builder guide: https://platform.openai.com/docs/guides/agent-builder
- Node reference: https://platform.openai.com/docs/guides/node-reference
- Agents guide: https://platform.openai.com/docs/guides/agents

## Goal

Build a reusable decision workflow that:

- accepts a technical question plus optional context
- runs three perspectives in parallel
- halts when confidence is uniformly low
- challenges unanimous results with a devil's advocate pass
- synthesizes a final verdict
- optionally persists the verdict externally later via MCP or app code

## MAGI Roles

### MELCHIOR

- Lens: logic, evidence, tradeoffs, architecture, sequencing
- Default stance: skeptical of broad changes without strong justification

### BALTHASAR

- Lens: user intent, safeguards, reversibility, failure containment
- Default stance: protect the user and operational safety first

### CASPAR

- Lens: ecosystem reality, trends, practical momentum, community fit
- Default stance: evaluate what is durable in the real world, not just elegant in theory

## Workflow Shape

### Inputs

- `question`: required string
- `context`: optional string
- `deep_mode`: boolean, default `false`
- `skip_context_builder`: boolean, default `false`

### Shared structured output schema

```json
{
  "type": "object",
  "properties": {
    "vote": {
      "type": "string",
      "enum": ["SHIP", "REWORK", "HOLD"]
    },
    "confidence": {
      "type": "number",
      "minimum": 0,
      "maximum": 1
    },
    "summary": { "type": "string" },
    "recommendation": { "type": "string" },
    "keyPoints": {
      "type": "array",
      "items": { "type": "string" }
    },
    "risks": {
      "type": "array",
      "items": { "type": "string" }
    },
    "reasoning": { "type": "string" }
  },
  "required": [
    "vote",
    "confidence",
    "summary",
    "recommendation",
    "keyPoints",
    "risks",
    "reasoning"
  ],
  "additionalProperties": false
}
```

## Node Graph

### 1. Start

Collect:

- `question`
- `context`
- `deep_mode`
- `skip_context_builder`

### 2. If/else: Skip context builder?

- If `skip_context_builder == true`, continue directly to Phase 1
- Else run Context Builder

### 3. Agent: Context Builder

Purpose:

- decide whether the question is specific enough
- if vague, ask for 1-2 targeted clarifications
- otherwise normalize the provided question and context into a sharper form

Output shape:

```json
{
  "needs_clarification": true,
  "refined_question": "string",
  "refined_context": "string",
  "clarifying_questions": ["string"]
}
```

### 4. If/else: clarification required?

- If `needs_clarification == true`, stop with questions for the user
- Else continue with `refined_question` and `refined_context`

### 5. Parallel Agent Nodes: Phase 1

Run in parallel:

- MELCHIOR Phase 1
- BALTHASAR Phase 1
- CASPAR Phase 1

All three use the shared schema above.

### 6. Transform: Phase 1 aggregate

Produce:

- `phase1.melchior`
- `phase1.balthasar`
- `phase1.caspar`
- `vote_counts`
- `all_low_confidence`
- `is_unanimous`

### 7. If/else: all low confidence?

- If all three `confidence < 0.5`, halt with a low-confidence message
- Else continue

### 8. If/else: deep mode?

- If `deep_mode == false`, skip to Devil's Advocate check
- Else run deep deliberation

### 9. Parallel Agent Nodes: Phase 2 Cross-Examination

Run in parallel:

- MELCHIOR Phase 2
- BALTHASAR Phase 2
- CASPAR Phase 2

Each sees:

- the original question and context
- its own Phase 1 result
- the other two Phase 1 results

### 10. Parallel Agent Nodes: Phase 3 Debate & Defense

Run in parallel:

- MELCHIOR Phase 3
- BALTHASAR Phase 3
- CASPAR Phase 3

Each sees:

- the original question and context
- its own Phase 1 result
- the Phase 2 criticisms from the other two agents

### 11. Transform: final analysis aggregate

If deep mode:

- use Phase 3 outputs as final analyses

If not deep mode:

- use Phase 1 outputs as final analyses

Compute:

- `final_vote_counts`
- `final_is_unanimous`
- `majority_vote`
- `consensus_percent`

### 12. If/else: unanimous?

- If not unanimous, skip to Synthesis
- If unanimous, run Devil's Advocate

### 13. Agent: Devil's Advocate

Recommended role:

- MELCHIOR-derived skeptic agent

Purpose:

- argue the strongest realistic opposite case
- not a strawman

Uses the same structured schema.

### 14. Agent: Synthesis

Input:

- question and context
- final three analyses
- computed vote counts
- devil's advocate result if present

Output:

```json
{
  "direction": "SHIP | REWORK | HOLD | SPLIT",
  "consensus_percent": 0,
  "minority_report": "string",
  "execution_recommendation": "string",
  "validation_checklist": ["string"],
  "verdict_markdown": "string"
}
```

### 15. Optional human approval

Use if you want a required user checkpoint before:

- invoking downstream tools
- writing to external systems
- triggering follow-on implementation workflows

### 16. Optional MCP / tool step

Later extension:

- save verdicts to Notion
- append to a journal store
- create project tasks from the recommendation

## Prompt Drafts

### Context Builder

```text
You are the MAGI Context Builder.

Your job is to determine whether the user's technical question is specific enough for meaningful multi-agent deliberation.

Return JSON with:
- needs_clarification: boolean
- refined_question: string
- refined_context: string
- clarifying_questions: string[]

Rules:
- Ask at most 2 clarifying questions.
- Only ask questions if missing context would materially weaken the verdict.
- If the question is already sharp enough, set needs_clarification to false and rewrite the question/context into cleaner, more precise language.
```

### MELCHIOR

```text
You are MELCHIOR, The Analyst, in the MAGI deliberation system.

Lens:
- logic
- evidence
- architecture
- sequencing
- measurable tradeoffs

You must:
- name critical assumptions
- distinguish required work from optional follow-up
- highlight missing information that could materially change the conclusion
- prefer incremental approaches unless broader change is clearly justified

Return valid JSON matching the required schema.
```

### BALTHASAR

```text
You are BALTHASAR, The Guardian, in the MAGI deliberation system.

Lens:
- user intent
- safety
- reversibility
- operational safeguards

You must:
- center the user's actual need
- identify ways the plan can fail dangerously or irreversibly
- prefer reversible rollout paths and explicit guardrails
- separate essential protections from optional polish

Return valid JSON matching the required schema.
```

### CASPAR

```text
You are CASPAR, The Sensor, in the MAGI deliberation system.

Lens:
- ecosystem reality
- trends
- adoption signal
- practical delivery momentum

You must:
- distinguish durable signal from hype
- call out when team familiarity or ecosystem maturity materially changes the answer
- identify adoption and maintenance risks
- keep recommendations practical rather than novelty-seeking

Return valid JSON matching the required schema.
```

### Devil's Advocate

```text
You are running the MAGI Devil's Advocate challenge.

The existing verdict is unanimous. Your job is to argue the strongest realistic opposite case.

Rules:
- Do not produce a strawman.
- Focus on assumptions shared by all three agents that may be wrong.
- Show the concrete scenario in which the unanimous verdict would look careless in hindsight.

Return valid JSON matching the required schema.
```

### Synthesis

```text
You are the MAGI Synthesizer.

You are neutral. Do not add your own opinion beyond synthesizing the agents' outputs.

Inputs:
- question
- context
- final analyses from MELCHIOR, BALTHASAR, and CASPAR
- vote counts
- consensus percent
- devil's advocate output if present

Tasks:
- determine final direction: SHIP, REWORK, HOLD, or SPLIT
- preserve dissent clearly
- write a practical execution recommendation
- create a short validation checklist
- produce the final verdict as markdown
```

## State Variables

- `question`
- `context`
- `refined_question`
- `refined_context`
- `deep_mode`
- `skip_context_builder`
- `phase1`
- `phase2`
- `phase3`
- `final_analyses`
- `vote_counts`
- `consensus_percent`
- `is_unanimous`
- `devils_advocate`
- `verdict`

## Recommended V1 Scope

For the first Agent Builder version:

- include Context Builder
- include Phase 1
- include low-confidence halt
- include unanimous Devil's Advocate
- include Synthesis
- skip deep mode initially if the canvas gets too heavy

Then add:

- Phase 2 cross-exam
- Phase 3 debate
- persistence via MCP

## Practical Note

Agent Builder is a good abstraction layer for MAGI as a reusable workflow, but it is not the same as a Codex CLI internal agent team. Treat it as a productized deliberation service that can later be deployed through ChatKit, an app backend, or SDK code.
