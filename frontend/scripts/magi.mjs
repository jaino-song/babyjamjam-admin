#!/usr/bin/env node

import { Agent, MemorySession, run, webSearchTool } from "@openai/agents";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { z } from "zod";

const DEFAULT_JOURNAL_DIR = path.join(os.homedir(), ".codex", "magi", "journal");
const DEFAULT_MODEL = "gpt-5.4";
const VALID_VOTES = ["SHIP", "REWORK", "HOLD"];
const AGENT_ORDER = ["melchior", "balthasar", "caspar"];
const AGENTS = {
  melchior: {
    label: "MELCHIOR",
    title: "The Analyst",
    theme: "logic, evidence, sequencing, architectural fit",
    webSearchMode: "disabled",
    guidance: [
      "Name the critical assumptions you are making.",
      "Distinguish required work from optional follow-up.",
      "Highlight missing information that could materially change the conclusion.",
      "Prefer incremental approaches unless a broader change is clearly justified.",
      "Propose measurable success criteria or checkpoints where relevant.",
    ],
  },
  balthasar: {
    label: "BALTHASAR",
    title: "The Guardian",
    theme: "user intent, safety, operational protection, rollout safeguards",
    webSearchMode: "disabled",
    guidance: [
      "Center the user's actual intent and likely operational constraints.",
      "Call out where the plan could create avoidable damage or irreversible risk.",
      "Prefer reversible rollout paths and explicit guardrails.",
      "Separate essential protections from nice-to-have polish.",
      "State the safeguards that must exist before shipping.",
    ],
  },
  caspar: {
    label: "CASPAR",
    title: "The Sensor",
    theme: "ecosystem trends, community pulse, practical momentum, real-world fit",
    webSearchMode: "live",
    guidance: [
      "Look for current platform guidance, ecosystem trends, and toolchain momentum when relevant.",
      "Differentiate durable signal from hype.",
      "Call out where team familiarity or ecosystem maturity materially changes the answer.",
      "Highlight adoption risks, maintenance burden, and community support signals.",
      "Keep recommendations grounded in practical delivery, not novelty.",
    ],
  },
};

const ANALYSIS_SCHEMA = z.object({
  vote: z.enum(VALID_VOTES),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  recommendation: z.string(),
  keyPoints: z.array(z.string()).min(2),
  risks: z.array(z.string()),
  reasoning: z.string(),
});

function printHelp() {
  console.log(`MAGI for Codex CLI

Usage:
  pnpm magi -- "Should we split this service?"
  ./bin/magi --deep "Should we adopt SwiftUI for the new app?"

Options:
  --deep               Run cross-examination and debate phases.
  --skip-context       Skip the optional interactive context prompt.
  --no-search          Disable CASPAR's live web search for faster or offline runs.
  --context TEXT       Attach additional context up front.
  --cwd DIR            Attach a working-directory hint to the deliberation context. Defaults to the current directory.
  --journal-dir DIR    Where verdict markdown files are stored.
  --model MODEL        Override the Agents SDK model for all agent threads.
  --help               Show this message.
`);
}

function parseArgs(argv) {
  const options = {
    deep: false,
    skipContext: false,
    search: true,
    context: "",
    cwd: process.cwd(),
    journalDir: DEFAULT_JOURNAL_DIR,
    model: undefined,
  };
  const questionParts = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (token === "--deep") {
      options.deep = true;
      continue;
    }
    if (token === "--skip-context") {
      options.skipContext = true;
      continue;
    }
    if (token === "--no-search") {
      options.search = false;
      continue;
    }
    if (token === "--context") {
      index += 1;
      options.context = argv[index] ?? "";
      continue;
    }
    if (token === "--cwd") {
      index += 1;
      options.cwd = path.resolve(argv[index] ?? process.cwd());
      continue;
    }
    if (token === "--journal-dir") {
      index += 1;
      options.journalDir = path.resolve(argv[index] ?? DEFAULT_JOURNAL_DIR);
      continue;
    }
    if (token === "--model") {
      index += 1;
      options.model = argv[index];
      continue;
    }
    questionParts.push(token);
  }

  return {
    options,
    question: questionParts.join(" ").trim(),
  };
}

async function promptForContext(existingContext) {
  if (existingContext) {
    return existingContext.trim();
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return "";
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const stack = await rl.question("Stack or codebase context (optional): ");
    const constraints = await rl.question("Constraints or non-negotiables (optional): ");
    return [stack.trim(), constraints.trim()].filter(Boolean).join("\n");
  } finally {
    rl.close();
  }
}

function renderGuidance(agent) {
  return AGENTS[agent].guidance.map((line) => `- ${line}`).join("\n");
}

function renderSharedPrompt(agentKey) {
  const agent = AGENTS[agentKey];
  return [
    `You are ${agent.label}, ${agent.title}, in the MAGI deliberation system.`,
    `Your lens is: ${agent.theme}.`,
    "Return a careful technical judgment using the provided JSON schema.",
    "Do not wrap JSON in code fences.",
    renderGuidance(agentKey),
  ].join("\n");
}

function serialize(result) {
  return JSON.stringify(result, null, 2);
}

function renderPhaseOnePrompt(agentKey, question, context) {
  return `${renderSharedPrompt(agentKey)}

MAGI DELIBERATION - Phase 1: Independent Analysis

Question:
${question}

Context:
${context || "No additional context provided."}

Analyze this technical task from your assigned perspective only. Do not speculate about what the other agents might say.`;
}

function renderCrossExaminationPrompt(agentKey, question, context, analyses) {
  const own = analyses[agentKey];
  const others = AGENT_ORDER.filter((key) => key !== agentKey)
    .map((key) => `--- ${AGENTS[key].label} ---\n${serialize(analyses[key])}`)
    .join("\n\n");

  return `${renderSharedPrompt(agentKey)}

MAGI DELIBERATION - Phase 2: Cross-Examination

Question:
${question}

Context:
${context || "No additional context provided."}

Your Phase 1 analysis:
${serialize(own)}

Other agents' analyses:
${others}

Review the other agents' analyses. Identify blind spots, unsupported claims, hidden complexity, or missing safeguards. If they changed your view, reflect that honestly.`;
}

function renderDebatePrompt(agentKey, question, context, phaseOne, phaseTwo) {
  const criticisms = AGENT_ORDER.filter((key) => key !== agentKey)
    .map((key) => `--- ${AGENTS[key].label} ---\n${serialize(phaseTwo[key])}`)
    .join("\n\n");

  return `${renderSharedPrompt(agentKey)}

MAGI DELIBERATION - Phase 3: Debate and Defense

Question:
${question}

Context:
${context || "No additional context provided."}

Your Phase 1 analysis:
${serialize(phaseOne[agentKey])}

Critiques from the other agents:
${criticisms}

Defend your position where it still holds. If a criticism exposes a real flaw, revise your stance rather than arguing past it.`;
}

function renderDevilsAdvocatePrompt(question, context, unanimousVote, analyses) {
  const oppositeVote = unanimousVote === "SHIP" ? "HOLD" : "SHIP";
  return `${renderSharedPrompt("melchior")}

MAGI DELIBERATION - Devil's Advocate Challenge

Question:
${question}

Context:
${context || "No additional context provided."}

All three agents voted: ${unanimousVote}

Existing analyses:
${serialize(analyses)}

Argue the opposite position as strongly and honestly as possible. This is not a strawman exercise. Find the strongest realistic case for ${oppositeVote}, especially the assumptions that could make the unanimous verdict look careless in hindsight. Set your vote to ${oppositeVote}.`;
}

function normalizeStructuredResult(rawValue, agentKey) {
  const parsed =
    typeof rawValue === "string"
      ? ANALYSIS_SCHEMA.parse(
          JSON.parse(rawValue.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "")),
        )
      : ANALYSIS_SCHEMA.parse(rawValue);

  return {
    agent: agentKey,
    vote: parsed.vote,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5))),
    summary: String(parsed.summary ?? parsed.recommendation ?? ""),
    recommendation: String(parsed.recommendation ?? ""),
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(String) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
    reasoning: String(parsed.reasoning ?? ""),
  };
}

function buildAgentInstructions(agentKey) {
  return [
    renderSharedPrompt(agentKey),
    "",
    "Output requirements:",
    '- Return valid JSON matching the schema with keys: "vote", "confidence", "summary", "recommendation", "keyPoints", "risks", and "reasoning".',
    "- Keep confidence between 0 and 1.",
    "- `keyPoints` should contain 2-5 concise bullets in sentence form.",
    "- `risks` should contain concrete failure modes or verification concerns.",
  ].join("\n");
}

function createAgentRuntime(agentKey, options) {
  const tools = [];
  if (agentKey === "caspar" && options.search) {
    tools.push(webSearchTool({ searchContextSize: "medium" }));
  }

  return {
    agent: new Agent({
      name: AGENTS[agentKey].label,
      instructions: buildAgentInstructions(agentKey),
      outputType: ANALYSIS_SCHEMA,
      model: options.model ?? DEFAULT_MODEL,
      tools,
    }),
    session: new MemorySession(),
  };
}

async function runPrompt(runtime, prompt, agentKey) {
  const result = await run(runtime.agent, prompt, {
    session: runtime.session,
    maxTurns: runtime.agent.tools.length > 0 ? 8 : 4,
  });
  return normalizeStructuredResult(result.finalOutput, agentKey);
}

async function runPhaseOne(threads, question, context) {
  const results = await Promise.all(
    AGENT_ORDER.map(async (agentKey) => {
      const analysis = await runPrompt(threads[agentKey], renderPhaseOnePrompt(agentKey, question, context), agentKey);
      return [agentKey, analysis];
    }),
  );

  return Object.fromEntries(results);
}

async function runPhaseTwo(threads, question, context, analyses) {
  const results = await Promise.all(
    AGENT_ORDER.map(async (agentKey) => {
      const analysis = await runPrompt(
        threads[agentKey],
        renderCrossExaminationPrompt(agentKey, question, context, analyses),
        agentKey,
      );
      return [agentKey, analysis];
    }),
  );

  return Object.fromEntries(results);
}

async function runPhaseThree(threads, question, context, phaseOne, phaseTwo) {
  const results = await Promise.all(
    AGENT_ORDER.map(async (agentKey) => {
      const analysis = await runPrompt(
        threads[agentKey],
        renderDebatePrompt(agentKey, question, context, phaseOne, phaseTwo),
        agentKey,
      );
      return [agentKey, analysis];
    }),
  );

  return Object.fromEntries(results);
}

function countVotes(analyses) {
  return AGENT_ORDER.reduce((counts, agentKey) => {
    const vote = analyses[agentKey].vote;
    counts[vote] = (counts[vote] ?? 0) + 1;
    return counts;
  }, {});
}

function formatVoteTally(analyses) {
  return AGENT_ORDER.map((agentKey) => `${AGENTS[agentKey].label} ${analyses[agentKey].vote}`).join("  ");
}

function calculateConsensus(voteCounts) {
  return Math.round((Math.max(...Object.values(voteCounts)) / AGENT_ORDER.length) * 100);
}

function determineDirection(analyses, devilsAdvocate) {
  const voteCounts = countVotes(analyses);
  const entries = Object.entries(voteCounts).sort((left, right) => right[1] - left[1]);
  const [leadingVote, leadingCount] = entries[0];
  const unanimous = leadingCount === AGENT_ORDER.length;

  if (entries.length === AGENT_ORDER.length) {
    return { direction: "SPLIT", voteCounts, consensus: calculateConsensus(voteCounts), unanimous: false };
  }

  let direction = leadingVote;
  if (unanimous && devilsAdvocate && devilsAdvocate.confidence >= 0.7) {
    direction = leadingVote === "SHIP" ? "REWORK" : "SPLIT";
  }

  return { direction, voteCounts, consensus: calculateConsensus(voteCounts), unanimous };
}

function uniqueStrings(values) {
  const seen = new Set();
  const nextValues = [];
  for (const value of values) {
    const trimmed = String(value).trim();
    if (!trimmed) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    nextValues.push(trimmed);
  }
  return nextValues;
}

function renderAgentSection(agentKey, result) {
  const details = uniqueStrings([result.summary, ...result.keyPoints]).slice(0, 3);
  return [
    `--- ${AGENTS[agentKey].label} (${AGENTS[agentKey].title}) ---`,
    `Vote: ${result.vote} (confidence: ${result.confidence.toFixed(2)})`,
    details.join("\n"),
  ].join("\n");
}

function renderMinorityReport(analyses, decision, devilsAdvocate) {
  if (decision.unanimous) {
    if (!devilsAdvocate) {
      return "No dissent. Unanimous verdict recorded without a devil's advocate pass.";
    }
    if (devilsAdvocate.confidence >= 0.7) {
      return `${AGENTS.melchior.label} challenged the unanimous verdict with a strong ${devilsAdvocate.vote} case: ${devilsAdvocate.summary}`;
    }
    return "No dissent. Unanimous verdict survived the devil's advocate challenge.";
  }

  const voteCounts = countVotes(analyses);
  const winningVote = Object.entries(voteCounts).sort((left, right) => right[1] - left[1])[0][0];
  const dissenters = AGENT_ORDER.filter((agentKey) => analyses[agentKey].vote !== winningVote);
  return dissenters
    .map((agentKey) => `${AGENTS[agentKey].label}: ${analyses[agentKey].summary}`)
    .join("\n");
}

function renderExecutionRecommendation(analyses, decision) {
  const voteCounts = countVotes(analyses);
  const leadingVote = Object.entries(voteCounts).sort((left, right) => right[1] - left[1])[0][0];
  const winners = AGENT_ORDER.filter((agentKey) => analyses[agentKey].vote === leadingVote);
  const dissenters = AGENT_ORDER.filter((agentKey) => analyses[agentKey].vote !== leadingVote);
  const lines = winners.map((agentKey) => `${AGENTS[agentKey].label}: ${analyses[agentKey].recommendation}`);

  for (const agentKey of dissenters) {
    lines.push(`Preserve ${AGENTS[agentKey].label}'s warning: ${analyses[agentKey].recommendation}`);
  }

  if (decision.direction === "SPLIT") {
    lines.unshift("Break this into smaller decisions or add context before committing to one path.");
  }

  return uniqueStrings(lines).join("\n");
}

function renderValidationChecklist(analyses) {
  const items = uniqueStrings(
    AGENT_ORDER.flatMap((agentKey) => analyses[agentKey].risks).map((risk) => `- Verify: ${risk}`),
  ).slice(0, 6);
  return items.length > 0 ? items.join("\n") : "- Verify the chosen direction against real constraints before shipping.";
}

function renderVerdict(question, modeLabel, analyses, decision, devilsAdvocate) {
  const date = new Date().toISOString().slice(0, 10);
  const sections = [
    "===========================================",
    "  MAGI VERDICT",
    "===========================================",
    "",
    `Task: "${question}"`,
    `Mode: ${modeLabel}`,
    `Date: ${date}`,
    "",
    `Direction: ${decision.direction}`,
    `Vote: ${formatVoteTally(analyses)}`,
    `Consensus: ${decision.consensus}%`,
    "",
    renderAgentSection("melchior", analyses.melchior),
    "",
    renderAgentSection("balthasar", analyses.balthasar),
    "",
    renderAgentSection("caspar", analyses.caspar),
    "",
    "--- MINORITY REPORT ---",
    renderMinorityReport(analyses, decision, devilsAdvocate),
    "",
    "--- EXECUTION RECOMMENDATION ---",
    renderExecutionRecommendation(analyses, decision),
    "",
    "--- VALIDATION CHECKLIST ---",
    renderValidationChecklist(analyses),
    "",
    "===========================================",
    "This is a decision-support tool. Final",
    "judgment is always yours.",
    "===========================================",
  ];

  return sections.join("\n");
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "untitled";
}

async function saveVerdict(journalDir, question, verdict) {
  await fs.mkdir(journalDir, { recursive: true });
  const filename = `${new Date().toISOString().slice(0, 10)}-${slugify(question)}.md`;
  const filePath = path.join(journalDir, filename);
  await fs.writeFile(filePath, `${verdict}\n`, "utf8");
  return filePath;
}

function renderConfidenceHalt(analyses) {
  return [
    "===========================================",
    "  MAGI - DELIBERATION HALTED",
    "===========================================",
    "",
    "All three agents reported low confidence.",
    "Provide more context about the stack, constraints,",
    "migration needs, or rollout conditions and retry.",
    "",
    `MELCHIOR: ${analyses.melchior.confidence.toFixed(2)}`,
    `BALTHASAR: ${analyses.balthasar.confidence.toFixed(2)}`,
    `CASPAR: ${analyses.caspar.confidence.toFixed(2)}`,
    "",
    "===========================================",
  ].join("\n");
}

async function maybeRunDevilsAdvocate(options, question, context, analyses, decision) {
  if (!decision.unanimous) {
    return null;
  }

  const unanimousVote = analyses.melchior.vote;
  const runtime = createAgentRuntime("melchior", options);
  return runPrompt(runtime, renderDevilsAdvocatePrompt(question, context, unanimousVote, analyses), "melchior");
}

export async function main(argv = process.argv.slice(2)) {
  const { options, question } = parseArgs(argv);

  if (options.help) {
    printHelp();
    return 0;
  }

  if (!question) {
    printHelp();
    return 1;
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required to run MAGI.");
    return 1;
  }

  const suppliedContext = options.skipContext ? options.context.trim() : await promptForContext(options.context.trim());
  const context = uniqueStrings([suppliedContext, `Working directory hint: ${options.cwd}`]).join("\n");
  const threads = Object.fromEntries(AGENT_ORDER.map((agentKey) => [agentKey, createAgentRuntime(agentKey, options)]));
  const phaseOne = await runPhaseOne(threads, question, context);

  let finalAnalyses = phaseOne;
  if (Object.values(phaseOne).every((result) => result.confidence < 0.5)) {
    console.log(renderConfidenceHalt(phaseOne));
    return 2;
  }

  if (options.deep) {
    const phaseTwo = await runPhaseTwo(threads, question, context, phaseOne);
    finalAnalyses = await runPhaseThree(threads, question, context, phaseOne, phaseTwo);
  }

  const initialDecision = determineDirection(finalAnalyses, null);
  const devilsAdvocate = await maybeRunDevilsAdvocate(options, question, context, finalAnalyses, initialDecision);
  const finalDecision = determineDirection(finalAnalyses, devilsAdvocate);
  const verdict = renderVerdict(
    question,
    options.deep ? "Deep Deliberation" : "Streamlined",
    finalAnalyses,
    finalDecision,
    devilsAdvocate,
  );
  const journalPath = await saveVerdict(options.journalDir, question, verdict);

  console.log(verdict);
  console.log(`\nJournal: ${journalPath}`);
  return 0;
}
