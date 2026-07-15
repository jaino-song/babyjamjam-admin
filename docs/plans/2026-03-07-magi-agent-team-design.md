# MAGI Agent Team — Design Document

**Date:** 2026-03-07
**Status:** Approved
**Type:** Claude Code Plugin (Agent Team)
**Location:** `~/.claude/plugins/magi/`

## Overview

MAGI (Multi-Agent Governance Intelligence) is a Claude Code agent team that provides multi-perspective deliberation on decisions. Inspired by Evangelion's MAGI system, three agents with distinct value lenses independently analyze a question, then their perspectives are synthesized into a structured verdict.

## Plugin Structure

```
~/.claude/plugins/magi/
├── plugin.json
├── agents/
│   ├── melchior.md          # The Analyst
│   ├── balthasar.md         # The Guardian
│   └── caspar.md            # The Sensor
├── skills/
│   ├── magi.md              # /magi — main deliberation
│   └── magi-journal.md      # /magi-journal — review past decisions
└── journal/                 # Auto-created, stores verdict history
```

## Agents

### MELCHIOR — The Analyst

- **Value Lens:** Data, logic, evidence, risk quantification
- **Tools:** Read, Grep, Glob
- **Traits:** Evidence-based, risk-quantifying, logical, structured
- **Output:** Quantified risk assessment, evidence-backed reasoning, measurable success criteria

### BALTHASAR — The Guardian

- **Value Lens:** User intent, protection, caution, safeguards
- **Tools:** Read
- **Traits:** User-aligned, protective, cautious, nurturing yet firm
- **Output:** User intent analysis, support with cautionary layers, recommended safeguards

### CASPAR — The Sensor

- **Value Lens:** Intuition, trends, public sentiment, community pulse
- **Tools:** WebSearch, WebFetch, Read
- **Traits:** Intuitive, trend-sensitive, community-aware, emotionally perceptive
- **Output:** Real-time sentiment data, trend analysis, community perspectives

## Deliberation Flow

### Streamlined Mode (default)

1. **Context Builder** — Evaluates question quality, asks 1-2 sharpening questions if vague
2. **Phase 1: Independent Analysis** — 3 parallel agent dispatches
3. **Confidence Gate** — Halts if all agents < 0.5 confidence
4. **Devil's Advocate** — Triggers if vote is 3:0 unanimous
5. **Synthesis** — Merges into MAGI Verdict

### Deep Mode (`--deep`)

1. **Context Builder** — Same as above
2. **Phase 1: Independent Analysis** — 3 parallel agent dispatches
3. **Phase 2: Cross-Examination** — Each agent reviews the other two
4. **Phase 3: Debate & Defense** — Each defends against Phase 2 criticisms
5. **Confidence Gate** — Halts if all agents < 0.5 confidence
6. **Devil's Advocate** — Triggers if vote is 3:0 unanimous
7. **Synthesis** — Merges into MAGI Verdict

## Safety Mechanisms

### Context Builder Pre-Check

Before dispatching agents, the orchestrator evaluates if the question has enough context. Vague questions produce weak analysis. The orchestrator asks 1-2 sharpening questions before running deliberation. Skippable with `--skip-context`.

### Confidence Gate

If all 3 agents report confidence below 0.5, synthesis is halted. The user is told the question may need more context or should be broken into sub-decisions.

### Devil's Advocate Protocol

On unanimous (3:0) votes, MELCHIOR is dispatched to argue the opposite position. If the unanimous verdict survives the challenge, confidence is confirmed. If weakened, the verdict is downgraded to CONDITIONAL.

### Disclaimer

Every verdict includes: "This is a decision-support tool. Final judgment is always yours."

## Agent Output Schema

Each agent outputs structured JSON:

```json
{
  "vote": "APPROVE | REJECT | CONDITIONAL",
  "confidence": 0.0-1.0,
  "recommendation": "...",
  "keyPoints": ["..."],
  "risks": ["..."],
  "reasoning": "..."
}
```

## Verdict Format

```
═══════════════════════════════════════════
  MAGI VERDICT
═══════════════════════════════════════════

Question: "<user's question>"
Mode: Streamlined | Deep Deliberation
Date: YYYY-MM-DD

Decision: APPROVE | REJECT | CONDITIONAL | SPLIT
Vote: 2:1 (MELCHIOR _  BALTHASAR _  CASPAR _)
Consensus: XX%

─── MELCHIOR (The Analyst) ───────────────
Vote: ... (confidence: X.XX)
[2-3 line summary]

─── BALTHASAR (The Guardian) ─────────────
Vote: ... (confidence: X.XX)
[2-3 line summary]

─── CASPAR (The Sensor) ─────────────────
Vote: ... (confidence: X.XX)
[2-3 line summary]

─── MINORITY REPORT ─────────────────────
[Dissenting view, if applicable]

─── RECOMMENDATION ──────────────────────
[Synthesized action plan]

═══════════════════════════════════════════
This is a decision-support tool. Final
judgment is always yours.
═══════════════════════════════════════════
```

## Skill Commands

| Command | Description |
|---------|-------------|
| `/magi "question"` | Streamlined deliberation |
| `/magi --deep "question"` | Full 4-phase deliberation |
| `/magi --deep --skip-context "question"` | Deep mode, skip context builder |
| `/magi-journal` | List past decisions |
| `/magi-journal --last N` | Show last N decisions |

## Decision Journal

Every verdict is auto-saved to `~/.claude/plugins/magi/journal/YYYY-MM-DD-<slug>.md`. The `/magi-journal` command lists and reviews past decisions.

## Language

Agents respond in the same language as the user's question (auto-detect).
