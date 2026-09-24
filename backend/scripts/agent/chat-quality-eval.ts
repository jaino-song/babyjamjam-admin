/**
 * Chat-quality evaluation harness: pure logic and orchestration for scoring
 * the same Korean scenarios against (a) the new agent endpoint
 * (`POST /ai/agent/chat`) and (b) the legacy chat endpoint
 * (`POST /ai/chat/stream`), with a judge model plus deterministic checks.
 *
 * Follows the house style of `jev-evaluation.ts`: this module performs no I/O
 * of its own. Every network call, clock read, and sleep is accepted as an
 * injected function so the whole pipeline is unit-testable with stubs. The
 * CLI (`run-chat-quality-eval.ts`) wires the real `fetch`, a real judge
 * caller, and `process.env`.
 *
 * Stream framing reference (confirmed against ai@6.0.116's UIMessageChunk
 * union and the legacy `AIChatController`/`AIChatService`):
 *  - New agent: an AI SDK UI-message SSE stream, `data: {json}` lines,
 *    terminated by `data: [DONE]`. Relevant chunk types: text-start/delta/end,
 *    reasoning-start/delta/end, tool-input-available (toolCallId, toolName,
 *    input), tool-input-error, tool-output-available (toolCallId, output,
 *    preliminary?) — NO toolName, tool-output-error, tool-output-denied,
 *    data-action-proposal, data-task-snapshot, data-form, data-entity-choice,
 *    data-entity-select, data-error, error(errorText), plus structural
 *    start/finish/abort/message-metadata/start-step/finish-step/source-url/
 *    source-document/file chunks this module does not need to interpret.
 *  - Legacy: `event: message|error` framing wrapping
 *    `data: {type:'chunk'|'tool_call'|'confirmation'|'done'|'error', ...}`
 *    JSON payloads (AIChatService.chatStream). No [DONE] marker; the stream
 *    simply ends.
 *
 * Approval-card definition (agent-runtime.service.ts:870-871,
 * packages/shared/src/agent/task-types.ts): a write proposal is a
 * `data-action-proposal` chunk (non-task capabilities) OR a
 * `data-task-snapshot` chunk whose `data.state` is `review_ready` or
 * `awaiting_approval` (task capabilities: clients.create, clients.update).
 * A `data-task-snapshot` in state `collecting` is a structured clarification,
 * equivalent to a question for `expectQuestion` purposes.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Scenario schema
// ---------------------------------------------------------------------------

const NonEmptyString = z.string().trim().min(1);

export const SCENARIO_CATEGORIES = [
    "vague",
    "implicit",
    "lookup",
    "synthesis",
    "count",
    "follow-up",
    "ambiguous",
    "write",
    "out-of-scope",
    "smalltalk",
    "mixed",
] as const;
export const ScenarioCategorySchema = z.enum(SCENARIO_CATEGORIES);
export type ScenarioCategory = z.infer<typeof ScenarioCategorySchema>;

/** Scenario categories excluded from the legacy target: legacy confirms writes via chat by design. */
export const LEGACY_EXCLUDED_CATEGORIES: readonly ScenarioCategory[] = ["write"];

const ScenarioChecksSchema = z.object({
    expectToolsAnyOf: z.array(NonEmptyString).min(1).optional(),
    forbidToolsAnyOf: z.array(NonEmptyString).min(1).optional(),
    forbidSearchQueries: z.array(NonEmptyString).min(1).optional(),
    expectNoTools: z.literal(true).optional(),
    expectQuestion: z.literal(true).optional(),
    expectProposal: z.literal(true).optional(),
    forbidChatConfirmation: z.literal(true).optional(),
}).strict();
export type ScenarioChecks = z.infer<typeof ScenarioChecksSchema>;
export type ScenarioCheckKey = keyof ScenarioChecks;

export const ScenarioSchema = z.object({
    id: NonEmptyString,
    category: ScenarioCategorySchema,
    turns: z.array(NonEmptyString).min(1).max(10),
    intent: NonEmptyString,
    rubric: NonEmptyString,
    checks: ScenarioChecksSchema,
}).strict();
export type Scenario = z.infer<typeof ScenarioSchema>;

export const ScenarioFileSchema = z.object({
    version: z.literal("v1"),
    scenarios: z.array(ScenarioSchema).min(1),
}).strict();
export type ScenarioFile = z.infer<typeof ScenarioFileSchema>;

export class ScenarioValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ScenarioValidationError";
    }
}

/** Strictly validates a scenario file and rejects duplicate scenario ids. */
export function parseScenarioFile(raw: unknown): ScenarioFile {
    const parsed = ScenarioFileSchema.parse(raw);
    const seen = new Set<string>();
    for (const scenario of parsed.scenarios) {
        if (seen.has(scenario.id)) {
            throw new ScenarioValidationError(`Duplicate scenario id "${scenario.id}"`);
        }
        seen.add(scenario.id);
    }
    return parsed;
}

/** Parses the capability name set out of a decoded `agent-manifest.json` document. */
export function extractManifestCapabilityNames(raw: unknown): Set<string> {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("agent-manifest.json root must be a JSON object");
    }
    const capabilities = (raw as Record<string, unknown>)["capabilities"];
    if (!Array.isArray(capabilities)) {
        throw new Error('agent-manifest.json field "capabilities" must be an array');
    }
    const names = new Set<string>();
    for (const entry of capabilities) {
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
            const name = (entry as Record<string, unknown>)["name"];
            if (typeof name === "string" && name.length > 0) names.add(name);
        }
    }
    return names;
}

function scenarioCapabilityReferences(checks: ScenarioChecks): string[] {
    return [...(checks.expectToolsAnyOf ?? []), ...(checks.forbidToolsAnyOf ?? [])];
}

/** Returns every capability name referenced by `expectToolsAnyOf`/`forbidToolsAnyOf` that is not in the manifest. */
export function findUnknownCapabilities(
    scenarios: readonly Scenario[],
    manifestCapabilities: ReadonlySet<string>,
): string[] {
    const unknown = new Set<string>();
    for (const scenario of scenarios) {
        for (const capability of scenarioCapabilityReferences(scenario.checks)) {
            if (!manifestCapabilities.has(capability)) unknown.add(capability);
        }
    }
    return [...unknown].sort();
}

// ---------------------------------------------------------------------------
// Shared SSE data-line extraction (both endpoints frame `data: {json}` lines)
// ---------------------------------------------------------------------------

export type RawStreamEvent = Record<string, unknown>;

/**
 * Extracts JSON payloads from `data: ...` SSE lines. Shared by both endpoints:
 * the agent stream frames `data: {json}` lines terminated by `data: [DONE]`;
 * the legacy stream frames `event: ...\ndata: {json}\n\n` blocks with the same
 * `data:` line shape and no terminator. Non-JSON or non-object lines are
 * dropped silently — they are not structured evidence.
 */
export function extractSseDataEvents(body: string): RawStreamEvent[] {
    const events: RawStreamEvent[] = [];
    for (const rawLine of body.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const value = line.slice(5).trim();
        if (!value || value === "[DONE]") continue;
        try {
            const parsed = JSON.parse(value) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                events.push(parsed as RawStreamEvent);
            }
        } catch {
            // Non-JSON keepalive/comment lines are not structured evidence.
        }
    }
    return events;
}

function stringField(event: RawStreamEvent, field: string): string | null {
    const value = event[field];
    return typeof value === "string" ? value : null;
}

// ---------------------------------------------------------------------------
// Agent (new runtime) turn assembly
// ---------------------------------------------------------------------------

export type ToolOutputStatus = "available" | "error" | "denied" | "pending";

export interface AgentToolCallRecord {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly capability: string;
    readonly input: unknown;
    readonly output: unknown;
    readonly outputStatus: ToolOutputStatus;
    readonly outputErrorText: string | null;
}

export interface AgentProposalRecord {
    readonly source: "action-proposal" | "task-snapshot";
    readonly capability: string | null;
    readonly taskState: string | null;
    readonly raw: unknown;
}

export interface AgentTurnObservation {
    readonly finalText: string;
    readonly toolCalls: readonly AgentToolCallRecord[];
    readonly proposals: readonly AgentProposalRecord[];
    readonly formRequestCount: number;
    readonly entityChoiceCount: number;
    readonly entitySelectCount: number;
    readonly taskSnapshotStates: readonly string[];
    readonly hasReasoning: boolean;
    readonly errors: readonly string[];
    readonly chunkTypesSeen: readonly string[];
}

/** Task-snapshot states that count as an emitted approval card (task-mode write capabilities). */
const TASK_SNAPSHOT_APPROVAL_STATES = new Set(["review_ready", "awaiting_approval"]);
/** Task-snapshot state that counts as a structured clarification (equivalent to a question). */
const TASK_SNAPSHOT_CLARIFICATION_STATE = "collecting";

/**
 * Maps a tool name (as reported on `tool-input-available`, e.g. `clients_search`)
 * to its capability name (e.g. `clients.search`) by looking up the dot-joined
 * form in the manifest capability set. An unmapped name is kept raw, per E3.
 */
export function mapToolNameToCapability(toolName: string, manifestCapabilities: ReadonlySet<string>): string {
    const mapped = toolName.replaceAll("_", ".");
    return manifestCapabilities.has(mapped) ? mapped : toolName;
}

interface MutableToolCall {
    toolName: string;
    input: unknown;
    output: unknown;
    outputStatus: ToolOutputStatus;
    outputErrorText: string | null;
}

function emptyToolCall(toolName = "unknown"): MutableToolCall {
    return { toolName, input: null, output: null, outputStatus: "pending", outputErrorText: null };
}

/** Assembles one turn's parsed agent-stream events into a structured observation. */
export function assembleAgentTurn(
    events: readonly RawStreamEvent[],
    manifestCapabilities: ReadonlySet<string>,
): AgentTurnObservation {
    const textOrder: string[] = [];
    const textById = new Map<string, string>();
    const toolCallsById = new Map<string, MutableToolCall>();
    const proposals: AgentProposalRecord[] = [];
    let formRequestCount = 0;
    let entityChoiceCount = 0;
    let entitySelectCount = 0;
    const taskSnapshotStates: string[] = [];
    let hasReasoning = false;
    const errors: string[] = [];
    const chunkTypesSeen = new Set<string>();

    for (const event of events) {
        const type = stringField(event, "type");
        if (type === null) continue;
        chunkTypesSeen.add(type);

        switch (type) {
            case "text-start": {
                const id = stringField(event, "id");
                if (id !== null && !textById.has(id)) {
                    textById.set(id, "");
                    textOrder.push(id);
                }
                break;
            }
            case "text-delta": {
                const id = stringField(event, "id");
                const delta = stringField(event, "delta") ?? "";
                if (id !== null) {
                    if (!textById.has(id)) textOrder.push(id);
                    textById.set(id, (textById.get(id) ?? "") + delta);
                }
                break;
            }
            case "text-end":
                break;
            case "reasoning-start":
            case "reasoning-delta":
            case "reasoning-end":
                hasReasoning = true;
                break;
            case "tool-input-available": {
                const toolCallId = stringField(event, "toolCallId");
                const toolName = stringField(event, "toolName") ?? "unknown";
                if (toolCallId !== null) {
                    const existing = toolCallsById.get(toolCallId) ?? emptyToolCall(toolName);
                    toolCallsById.set(toolCallId, { ...existing, toolName, input: event["input"] });
                }
                break;
            }
            case "tool-input-error": {
                const toolCallId = stringField(event, "toolCallId");
                const toolName = stringField(event, "toolName") ?? "unknown";
                const errorText = stringField(event, "errorText") ?? "tool input error";
                if (toolCallId !== null) {
                    toolCallsById.set(toolCallId, {
                        toolName,
                        input: event["input"],
                        output: null,
                        outputStatus: "error",
                        outputErrorText: errorText,
                    });
                }
                errors.push(errorText);
                break;
            }
            case "tool-output-available": {
                const toolCallId = stringField(event, "toolCallId");
                if (toolCallId !== null) {
                    const existing = toolCallsById.get(toolCallId) ?? emptyToolCall();
                    // preliminary intermediate outputs are overwritten by later
                    // outputs for the same toolCallId; the last write wins.
                    toolCallsById.set(toolCallId, {
                        ...existing,
                        output: event["output"],
                        outputStatus: "available",
                        outputErrorText: null,
                    });
                }
                break;
            }
            case "tool-output-error": {
                const toolCallId = stringField(event, "toolCallId");
                const errorText = stringField(event, "errorText") ?? "tool output error";
                if (toolCallId !== null) {
                    const existing = toolCallsById.get(toolCallId) ?? emptyToolCall();
                    toolCallsById.set(toolCallId, {
                        ...existing,
                        output: null,
                        outputStatus: "error",
                        outputErrorText: errorText,
                    });
                }
                errors.push(errorText);
                break;
            }
            case "tool-output-denied": {
                const toolCallId = stringField(event, "toolCallId");
                if (toolCallId !== null) {
                    const existing = toolCallsById.get(toolCallId) ?? emptyToolCall();
                    toolCallsById.set(toolCallId, { ...existing, outputStatus: "denied" });
                }
                break;
            }
            case "data-action-proposal": {
                const data = event["data"];
                const capability = data && typeof data === "object" && !Array.isArray(data)
                    ? stringField(data as RawStreamEvent, "capability")
                    : null;
                proposals.push({ source: "action-proposal", capability, taskState: null, raw: data });
                break;
            }
            case "data-task-snapshot": {
                const data = event["data"];
                const record = data && typeof data === "object" && !Array.isArray(data) ? data as RawStreamEvent : null;
                const state = record ? stringField(record, "state") : null;
                const capability = record ? stringField(record, "capabilityId") : null;
                if (state !== null) {
                    taskSnapshotStates.push(state);
                    if (TASK_SNAPSHOT_APPROVAL_STATES.has(state)) {
                        proposals.push({ source: "task-snapshot", capability, taskState: state, raw: data });
                    }
                }
                break;
            }
            case "data-form":
                formRequestCount += 1;
                break;
            case "data-entity-choice":
                entityChoiceCount += 1;
                break;
            case "data-entity-select":
                entitySelectCount += 1;
                break;
            case "data-error": {
                const data = event["data"];
                const message = data && typeof data === "object" && !Array.isArray(data)
                    ? stringField(data as RawStreamEvent, "message") ?? JSON.stringify(data)
                    : JSON.stringify(data ?? null);
                errors.push(message);
                break;
            }
            case "error": {
                errors.push(stringField(event, "errorText") ?? "stream error");
                break;
            }
            default:
                break;
        }
    }

    const finalText = textOrder.map((id) => textById.get(id) ?? "").join("");
    const toolCalls: AgentToolCallRecord[] = [...toolCallsById.entries()].map(([toolCallId, record]) => ({
        toolCallId,
        toolName: record.toolName,
        capability: mapToolNameToCapability(record.toolName, manifestCapabilities),
        input: record.input,
        output: record.output,
        outputStatus: record.outputStatus,
        outputErrorText: record.outputErrorText,
    }));

    return {
        finalText,
        toolCalls,
        proposals,
        formRequestCount,
        entityChoiceCount,
        entitySelectCount,
        taskSnapshotStates,
        hasReasoning,
        errors,
        chunkTypesSeen: [...chunkTypesSeen],
    };
}

/** Whether an agent turn's task-snapshot states include the structured-clarification state. */
export function agentTurnHasStructuredClarification(turn: AgentTurnObservation): boolean {
    return turn.formRequestCount > 0
        || turn.entityChoiceCount > 0
        || turn.entitySelectCount > 0
        || turn.taskSnapshotStates.includes(TASK_SNAPSHOT_CLARIFICATION_STATE);
}

// ---------------------------------------------------------------------------
// Legacy turn assembly
// ---------------------------------------------------------------------------

export interface LegacyConfirmationRecord {
    readonly confirmationMessage: string | null;
    readonly confirmationIntentId: string | null;
}

export interface LegacyTurnObservation {
    readonly finalText: string;
    readonly toolNames: readonly string[];
    readonly legacyConfirmation: LegacyConfirmationRecord | null;
    readonly sessionId: string | null;
    readonly errors: readonly string[];
}

/** Assembles one turn's parsed legacy-stream events into a structured observation. */
export function assembleLegacyTurn(events: readonly RawStreamEvent[]): LegacyTurnObservation {
    let finalText = "";
    const toolNames: string[] = [];
    let legacyConfirmation: LegacyConfirmationRecord | null = null;
    let sessionId: string | null = null;
    const errors: string[] = [];

    for (const event of events) {
        const type = stringField(event, "type");
        switch (type) {
            case "chunk":
                finalText += stringField(event, "content") ?? "";
                break;
            case "tool_call": {
                const toolName = stringField(event, "toolName");
                if (toolName !== null) toolNames.push(toolName);
                break;
            }
            case "confirmation":
                legacyConfirmation = {
                    confirmationMessage: stringField(event, "confirmationMessage"),
                    confirmationIntentId: stringField(event, "confirmationIntentId"),
                };
                break;
            case "done":
                sessionId = stringField(event, "sessionId") ?? sessionId;
                break;
            case "error":
                errors.push(stringField(event, "error") ?? "legacy stream error");
                break;
            default:
                break;
        }
    }

    return { finalText, toolNames: [...new Set(toolNames)], legacyConfirmation, sessionId, errors };
}

// ---------------------------------------------------------------------------
// expectQuestion heuristic
// ---------------------------------------------------------------------------

/**
 * Documented heuristic: normalize the fullwidth `？` to `?`, then look only
 * at the *last paragraph* of the answer (text after the final blank line),
 * so a `?` appearing in an earlier paragraph (e.g. quoting the user's own
 * message back to them) never counts. If that last paragraph is nothing but
 * a markdown table or list (no actual sentence), fall back to the paragraph
 * before it; if the chosen paragraph is a lead-in sentence followed by a
 * markdown table/list (e.g. "선택해 주세요:" followed by bullet options),
 * the trailing table/list lines are dropped so the lead-in sentence is what
 * gets checked as the paragraph's real final sentence.
 *
 * Within the chosen paragraph, split into sentences on `. ! ?` and line
 * breaks. Any sentence that asks a question counts, so a clarifying question
 * followed by an offer or example still counts (e.g. "어느 산모님을
 * 찾으시나요? 이름을 알려주시면 찾아드릴게요."). The one exception is a
 * question the next sentence continues as a quote (it starts with 하고,
 * 라고, 라며, 라는, 고 물…), e.g. "고객님이 언제 오나요? 하고 물으셨던 건은
 * 처리했어요." — that `?` is reported speech, not a question to the user.
 *
 * A sentence "asks a question" if it ends with a literal `?` or one of the
 * Korean asking-sentence endings this app's clarifying questions use in
 * practice (까요, 나요, 인가요/은가요/는가요/던가요, 할래요/을래요/주실래요,
 * 주세요/주시겠어요, 인지요/는지요, or the formal "-습니까 / -ㅂ니까"
 * question form, e.g. 됩니까/합니까), or if it contains one of the request
 * forms the app uses to ask for missing input, "알려/말씀해 주시면" or
 * "알려/말씀해 주세요" (e.g. "성함을 알려주시면 변경해 드릴게요.",
 * "성함을 알려주세요. 확인 후 처리해 드릴게요!") — ignoring trailing markdown emphasis
 * (`*`, `_`), punctuation (`:`, `^`, `…`, `~`, `.`, `!`), closing quotes,
 * trailing ㅎ/ㅋ laughter runs, and emoji (including skin-tone modifiers and
 * ZWJ sequences), plus whitespace, when checking the ending. Bare "니까"
 * (e.g. "...했으니까."), bare "가요" (e.g. "내일 가요."), and bare "래요" as
 * reported speech (e.g. "하래요.") intentionally do NOT count — only the
 * specific asking forms above do. Any other "주세요" is additionally
 * restricted to only count when it ends the paragraph's actual final sentence —
 * any-sentence matching was too loose for it, since it is a common closing courtesy on plain
 * statements too (e.g. "고객님께 전화해 주세요. 감사합니다!" is not a
 * question).
 */
const KOREAN_QUESTION_ENDINGS = [
    "까요",
    "나요",
    "인가요",
    "은가요",
    "는가요",
    "던가요",
    "할래요",
    "을래요",
    "주세요",
    "주시겠어요",
    "주실래요",
    "인지요",
    "는지요",
] as const;

/** The one ending above that only counts when it ends the paragraph's actual final sentence (see doc comment above). */
const FINAL_SENTENCE_ONLY_ENDING = "주세요";

// Trailing characters ignored when checking a sentence's ending: markdown
// emphasis (`*`, `_`), `.`, `!`, `~`, `:`, `^`, `…`, closing quotes (ASCII +
// Korean brackets + curly quotes), trailing ㅎ/ㅋ laughter runs, emoji
// (including skin-tone modifiers `\p{Emoji_Modifier}` and ZWJ `‍` /
// combining-enclosing-keycap `⃣` sequence parts), and whitespace.
// Deliberately excludes `?`, which is itself a marker we check for.
const TRAILING_FILLER_RE =
    /[.!~*_:^…"'“”‘’「」『』)\]\s\p{Extended_Pictographic}\p{Emoji_Modifier}‍⃣ㅎㅋ️]+$/u;

const TABLE_OR_LIST_LINE_RE = /^(\|.*\||[-*+]\s+.*|\d+[.)]\s+.*|[-:|\s]+)$/;

/** A sentence that starts like this continues the previous sentence's `?` as reported speech (see doc comment above). */
const QUOTATIVE_CONTINUATION_RE = /^(?:하고|라고|라며|라는|이라고|고\s*물)/u;

/** The request forms the app uses to ask for missing input, in any sentence (see doc comment above). */
const CONDITIONAL_REQUEST_RE = /(?:알려|말씀해)\s*주(?:시면|세요)/u;

/** A Hangul syllable with the "ㅂ" final consonant (batchim), e.g. 습/됩/합. */
function hasBieupBatchim(char: string | undefined): boolean {
    if (!char) return false;
    const code = char.codePointAt(0);
    if (code === undefined) return false;
    if (code < 0xac00 || code > 0xd7a3) return false;
    return (code - 0xac00) % 28 === 17;
}

function splitParagraphs(text: string): string[] {
    return text
        .split(/\n\s*\n+/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length > 0);
}

function isTableOrListOnly(paragraph: string): boolean {
    const lines = paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    if (lines.length === 0) return false;
    return lines.every((line) => TABLE_OR_LIST_LINE_RE.test(line));
}

/**
 * Drops trailing markdown table/list lines from a paragraph that mixes a
 * lead-in sentence with a list (e.g. "선택해 주세요:\n- A\n- B"), so the
 * lead-in sentence — not the last bullet — is treated as the paragraph's
 * real final sentence. A paragraph that is ENTIRELY list/table lines is left
 * untouched here; `isTableOrListOnly` already handles that case by falling
 * back to the previous paragraph.
 */
function stripTrailingListLines(paragraph: string): string {
    const lines = paragraph.split("\n");
    let end = lines.length;
    while (end > 0 && TABLE_OR_LIST_LINE_RE.test((lines[end - 1] as string).trim())) {
        end -= 1;
    }
    return end === 0 ? paragraph : lines.slice(0, end).join("\n");
}

function splitSentences(paragraph: string): string[] {
    return paragraph
        .split(/(?<=[.!?])\s+|\n+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 0);
}

/** @param isFinalSentence Whether `sentence` is the paragraph's actual final sentence (see FINAL_SENTENCE_ONLY_ENDING). */
function sentenceAsksQuestion(sentence: string, isFinalSentence: boolean): boolean {
    const core = sentence.replace(TRAILING_FILLER_RE, "");
    if (core.length === 0) return false;
    if (core.endsWith("?")) return true;
    for (const ending of KOREAN_QUESTION_ENDINGS) {
        if (ending === FINAL_SENTENCE_ONLY_ENDING && !isFinalSentence) continue;
        if (core.endsWith(ending)) return true;
    }
    if (core.endsWith("니까") && hasBieupBatchim(core[core.length - 3])) return true;
    return CONDITIONAL_REQUEST_RE.test(core);
}

function paragraphAsksQuestion(paragraph: string): boolean {
    const sentences = splitSentences(paragraph);
    return sentences.some((sentence, index) => {
        const isFinalSentence = index === sentences.length - 1;
        if (!sentenceAsksQuestion(sentence, isFinalSentence)) return false;
        const next = sentences[index + 1];
        return next === undefined || !QUOTATIVE_CONTINUATION_RE.test(next);
    });
}

export function heuristicHasQuestion(text: string): boolean {
    const trimmed = text.replace(/？/g, "?").trim();
    if (trimmed.length === 0) return false;

    const paragraphs = splitParagraphs(trimmed);
    if (paragraphs.length === 0) return false;

    let target = paragraphs[paragraphs.length - 1] as string;
    if (paragraphs.length > 1 && isTableOrListOnly(target)) {
        target = paragraphs[paragraphs.length - 2] as string;
    }
    target = stripTrailingListLines(target);

    return paragraphAsksQuestion(target);
}

// ---------------------------------------------------------------------------
// Deterministic checks
// ---------------------------------------------------------------------------

export type CheckStatus = "pass" | "fail" | "n/a";
export type CheckResults = Partial<Record<ScenarioCheckKey, CheckStatus>>;

export interface DeterministicFacts {
    readonly target: "agent" | "legacy";
    readonly finalText: string;
    /** null exactly when target === "legacy" (no capability visibility, per E4). */
    readonly capabilitiesUsed: readonly string[] | null;
    readonly searchQueries: readonly string[];
    readonly proposalPresent: boolean;
    readonly structuredClarificationPresent: boolean;
    readonly chatConfirmationPatternPresent: boolean;
}

const SEARCH_CAPABILITIES = new Set(["clients.search", "employees.search"]);
const CHAT_CONFIRMATION_PATTERNS = ['"네"라고', "진행할까요", "확인해 주시면 진행"];

function inputQuery(input: unknown): string | null {
    if (input && typeof input === "object" && !Array.isArray(input)) {
        const query = (input as Record<string, unknown>)["query"];
        return typeof query === "string" ? query : null;
    }
    return null;
}

export function deterministicFactsFromAgentTurn(turn: AgentTurnObservation): DeterministicFacts {
    const capabilitiesUsed = turn.toolCalls.map((call) => call.capability);
    const searchQueries = turn.toolCalls
        .filter((call) => SEARCH_CAPABILITIES.has(call.capability))
        .map((call) => inputQuery(call.input))
        .filter((value): value is string => value !== null);
    return {
        target: "agent",
        finalText: turn.finalText,
        capabilitiesUsed,
        searchQueries,
        proposalPresent: turn.proposals.length > 0,
        structuredClarificationPresent: agentTurnHasStructuredClarification(turn),
        chatConfirmationPatternPresent: CHAT_CONFIRMATION_PATTERNS.some((pattern) => turn.finalText.includes(pattern)),
    };
}

export function deterministicFactsFromLegacyTurn(turn: LegacyTurnObservation): DeterministicFacts {
    return {
        target: "legacy",
        finalText: turn.finalText,
        capabilitiesUsed: null,
        searchQueries: [],
        proposalPresent: false,
        structuredClarificationPresent: false,
        chatConfirmationPatternPresent: false,
    };
}

/** No observation reached (e.g. a transport error truncated the scenario before any turn completed). */
export function emptyDeterministicFacts(target: "agent" | "legacy"): DeterministicFacts {
    return {
        target,
        finalText: "",
        capabilitiesUsed: target === "agent" ? [] : null,
        searchQueries: [],
        proposalPresent: false,
        structuredClarificationPresent: false,
        chatConfirmationPatternPresent: false,
    };
}

/**
 * Evaluates the scenario's declared checks against the last turn's facts.
 * Capability-based checks (expectToolsAnyOf, forbidToolsAnyOf,
 * forbidSearchQueries, expectNoTools) are "n/a" for the legacy target, which
 * exposes no capability visibility (E4). expectProposal and
 * forbidChatConfirmation are also "n/a" for legacy: legacy has no approval
 * card and confirms writes over chat by design, and write-category scenarios
 * are excluded from the legacy target entirely (see LEGACY_EXCLUDED_CATEGORIES).
 */
export function evaluateChecks(checks: ScenarioChecks, facts: DeterministicFacts): CheckResults {
    const results: CheckResults = {};
    const legacy = facts.target === "legacy";

    if (checks.expectToolsAnyOf) {
        const expectToolsAnyOf = checks.expectToolsAnyOf;
        results["expectToolsAnyOf"] = legacy
            ? "n/a"
            : (facts.capabilitiesUsed ?? []).some((c) => expectToolsAnyOf.includes(c)) ? "pass" : "fail";
    }
    if (checks.forbidToolsAnyOf) {
        const forbidToolsAnyOf = checks.forbidToolsAnyOf;
        results["forbidToolsAnyOf"] = legacy
            ? "n/a"
            : (facts.capabilitiesUsed ?? []).some((c) => forbidToolsAnyOf.includes(c)) ? "fail" : "pass";
    }
    if (checks.forbidSearchQueries) {
        const forbidSearchQueries = checks.forbidSearchQueries;
        results["forbidSearchQueries"] = legacy
            ? "n/a"
            : facts.searchQueries.some((q) => forbidSearchQueries.includes(q)) ? "fail" : "pass";
    }
    if (checks.expectNoTools) {
        results["expectNoTools"] = legacy
            ? "n/a"
            : (facts.capabilitiesUsed ?? []).length === 0 ? "pass" : "fail";
    }
    if (checks.expectQuestion) {
        const hasQuestion = heuristicHasQuestion(facts.finalText) || facts.structuredClarificationPresent;
        results["expectQuestion"] = hasQuestion ? "pass" : "fail";
    }
    if (checks.expectProposal) {
        results["expectProposal"] = legacy ? "n/a" : (facts.proposalPresent ? "pass" : "fail");
    }
    if (checks.forbidChatConfirmation) {
        results["forbidChatConfirmation"] = legacy
            ? "n/a"
            : (facts.proposalPresent || !facts.chatConfirmationPatternPresent) ? "pass" : "fail";
    }
    return results;
}

/** Marks every declared check as "fail" — used when a transport error truncated the scenario (E6: never n/a, never excluded). */
export function transportFailureCheckResults(checks: ScenarioChecks): CheckResults {
    const results: CheckResults = {};
    for (const key of Object.keys(checks) as ScenarioCheckKey[]) {
        results[key] = "fail";
    }
    return results;
}

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

export const JudgeScoreSchema = z.object({
    // Gemini structured output rejects numeric literal enums, so scores are
    // bounded integers instead of unions of literals.
    intent: z.number().int().min(0).max(2),
    depth: z.number().int().min(0).max(2),
    grounding: z.number().int().min(0).max(2),
    format: z.number().int().min(0).max(1),
    // The prompt asks for <= 400 chars; a longer rationale must not turn a
    // valid score into a judgeError.
    rationale: z.string().trim().min(1).max(2000),
}).strict();
export type JudgeScore = z.infer<typeof JudgeScoreSchema>;

/** The zero score recorded for a scenario the transport never let complete (E6). */
export const TRANSPORT_FAILURE_JUDGE_SCORE: JudgeScore = {
    intent: 0,
    depth: 0,
    grounding: 0,
    format: 0,
    rationale: "Transport error interrupted the scenario before the judge could see a transcript.",
};

export interface TranscriptToolCall {
    readonly capability: string;
    readonly input: unknown;
    readonly output: unknown;
}

export interface TranscriptProposal {
    readonly source: "action-proposal" | "task-snapshot";
    readonly taskState: string | null;
}

export interface TranscriptTurn {
    readonly userText: string;
    readonly assistantText: string;
    readonly toolCalls: readonly TranscriptToolCall[];
    readonly proposals: readonly TranscriptProposal[];
}

const MAX_TOOL_TEXT_CHARS = 3000;

function truncateForJudge(value: unknown): string {
    const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
    return text.length > MAX_TOOL_TEXT_CHARS ? `${text.slice(0, MAX_TOOL_TEXT_CHARS)}…(truncated)` : text;
}

export const JUDGE_SYSTEM_PROMPT = [
    "You are grading a Korean customer-operations chat assistant for a postpartum-care staffing app (BabyJamJam).",
    "Score strictly using the rubric below. Respond with only the requested structured fields, nothing else.",
    "",
    "intent (0-2): 2 = did what the user actually meant, including asking ONE precise clarifying question when a "
    + "required fact is genuinely missing; 1 = partially or roundabout; 0 = misread the request (e.g. a literal "
    + "search for a category word, the wrong domain, or a pointless question when the info given was already sufficient).",
    "depth (0-2): 2 = leads with the direct answer and summarizes or highlights what matters / a useful next step "
    + "where appropriate; 1 = correct but a raw dump or too bare; 0 = unhelpful. For greetings, out-of-scope replies, "
    + "or clarifying questions, judge appropriateness and brevity, not volume.",
    "grounding (0-2): 2 = every factual claim is supported by a tool output shown in the transcript (or is general "
    + "knowledge about the app itself); 1 = one minor unsupported detail; 0 = an invented record/number, or a claim "
    + "that a write happened without an approved result to back it up.",
    "format (0-1): 1 = Korean (matching the user), readable, using markdown tables or bullets for lists; 0 otherwise.",
    "",
    "An approval card is the correct and only way a write is confirmed on the agent target: either a "
    + "data-action-proposal chunk, or a data-task-snapshot chunk in state review_ready or awaiting_approval — both "
    + "are shown to you in the transcript as \"Proposal:\" lines. If the assistant instead asks in chat, e.g. "
    + '"진행할까요?" or "네라고 답해주세요", instead of producing a card, that is a defect: score intent 0 for a '
    + "write scenario on the agent target.",
    "The legacy assistant has no approval card and confirms writes through chat by design — never penalize the "
    + "legacy target for a chat confirmation.",
].join("\n");

/** Pure judge prompt construction; the caller supplies JUDGE_SYSTEM_PROMPT as the system message. */
export function buildJudgePrompt(scenario: Scenario, transcript: readonly TranscriptTurn[]): string {
    const transcriptText = transcript.map((turn, index) => {
        const lines = [`Turn ${index + 1}`, `User: ${turn.userText}`, `Assistant: ${turn.assistantText || "(empty)"}`];
        for (const call of turn.toolCalls) {
            lines.push(`Tool call: ${call.capability} input=${truncateForJudge(call.input)} output=${truncateForJudge(call.output)}`);
        }
        for (const proposal of turn.proposals) {
            lines.push(`Proposal: source=${proposal.source} state=${proposal.taskState ?? "n/a"}`);
        }
        return lines.join("\n");
    }).join("\n\n");

    return [
        `Scenario id: ${scenario.id}`,
        `Category: ${scenario.category}`,
        `User intent: ${scenario.intent}`,
        `Rubric: ${scenario.rubric}`,
        "",
        "Transcript:",
        transcriptText,
    ].join("\n");
}

export type JudgeCaller = (prompt: string) => Promise<JudgeScore>;
export type SleepFn = (ms: number) => Promise<void>;

/** Retries a judge call up to 2 times on transient errors (3 attempts total); returns null if every attempt failed. */
export async function callJudgeWithRetry(judgeCall: JudgeCaller, prompt: string, sleep: SleepFn): Promise<JudgeScore | null> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await judgeCall(prompt);
        } catch {
            if (attempt === maxAttempts) return null;
            await sleep(0);
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// HTTP turn transport
// ---------------------------------------------------------------------------

export interface HttpHeadersLike {
    get(name: string): string | null;
}
export interface HttpResponseLike {
    readonly ok: boolean;
    readonly status: number;
    readonly headers: HttpHeadersLike;
    text(): Promise<string>;
}
export type FetchLike = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    redirect: "error";
}) => Promise<HttpResponseLike>;

export interface TransportError {
    readonly status: number;
    readonly code: string | null;
    readonly message: string;
}

/**
 * Resolves the bearer token immediately before use. A constant closure is
 * fine for a short run; `--token-file`/AGENT_EVAL_TOKEN_FILE wires a function
 * that re-reads the file on every call, because the access token this suite
 * authenticates with expires after 15 minutes (ACCESS_TOKEN_EXPIRES_IN) and a
 * full run can outlast that.
 */
export type TokenProvider = () => Promise<string> | string;

export interface SendTurnOptions {
    readonly baseUrl: string;
    readonly getToken: TokenProvider;
    readonly target: "agent" | "legacy";
    readonly message: string;
    readonly sessionId: string | null;
    readonly turnId: string;
    readonly fetchImpl: FetchLike;
    readonly sleepImpl: SleepFn;
    readonly maxRateLimitRetries?: number;
}

export interface SendTurnResult {
    readonly ok: boolean;
    readonly status: number;
    readonly body: string;
    /** Agent target only: the `X-Agent-Session-Id` response header. Null for legacy (its session id lives in the body). */
    readonly headerSessionId: string | null;
    readonly latencyMs: number;
    readonly transportError: TransportError | null;
    readonly rateLimitRetries: number;
}

const DEFAULT_RETRY_AFTER_MS = 15000;

function agentRequestBody(message: string, sessionId: string | null, turnId: string): string {
    return JSON.stringify({
        locale: "ko",
        ...(sessionId ? { sessionId } : {}),
        messages: [{ id: turnId, role: "user", parts: [{ type: "text", text: message }] }],
    });
}

function legacyRequestBody(message: string, sessionId: string | null): string {
    return JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) });
}

function parseProblemCode(body: string): string | null {
    try {
        const parsed = JSON.parse(body) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const record = parsed as Record<string, unknown>;
            if (typeof record["code"] === "string") return record["code"];
            const errors = record["errors"];
            if (Array.isArray(errors) && errors.length > 0) {
                const first = errors[0];
                if (first && typeof first === "object" && !Array.isArray(first)) {
                    const code = (first as Record<string, unknown>)["code"];
                    if (typeof code === "string") return code;
                }
            }
        }
    } catch {
        // non-JSON error body
    }
    return null;
}

/**
 * Sends one turn's message to the given target endpoint. Retries on 429 up to
 * `maxRateLimitRetries` times (default 3), honoring `Retry-After` when present
 * and falling back to 15s (E5). Any other non-2xx status is a transport error,
 * never parsed as SSE (E5). Every request rejects redirects.
 */
export async function sendTurn(options: SendTurnOptions): Promise<SendTurnResult> {
    const url = options.target === "agent" ? `${options.baseUrl}/ai/agent/chat` : `${options.baseUrl}/ai/chat/stream`;
    const body = options.target === "agent"
        ? agentRequestBody(options.message, options.sessionId, options.turnId)
        : legacyRequestBody(options.message, options.sessionId);
    const maxRetries = options.maxRateLimitRetries ?? 3;

    const start = Date.now();
    let rateLimitRetries = 0;
    for (;;) {
        // Re-resolved on every attempt (including retries): a long run can
        // outlast the 15-minute access token, so the token must never be
        // captured once and reused for the whole scenario.
        const token = await options.getToken();
        const response = await options.fetchImpl(url, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body,
            redirect: "error",
        });
        if (response.status === 429 && rateLimitRetries < maxRetries) {
            rateLimitRetries += 1;
            const retryAfterHeader = response.headers.get("retry-after");
            const retryAfterSeconds = retryAfterHeader !== null ? Number(retryAfterHeader) : Number.NaN;
            const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
                ? retryAfterSeconds * 1000
                : DEFAULT_RETRY_AFTER_MS;
            await response.text().catch(() => "");
            await options.sleepImpl(waitMs);
            continue;
        }

        const text = await response.text();
        const latencyMs = Date.now() - start;
        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                body: text,
                headerSessionId: options.target === "agent" ? response.headers.get("x-agent-session-id") : null,
                latencyMs,
                transportError: {
                    status: response.status,
                    code: parseProblemCode(text),
                    message: `Transport error: HTTP ${response.status}`,
                },
                rateLimitRetries,
            };
        }
        return {
            ok: true,
            status: response.status,
            body: text,
            headerSessionId: options.target === "agent" ? response.headers.get("x-agent-session-id") : null,
            latencyMs,
            transportError: null,
            rateLimitRetries,
        };
    }
}

// ---------------------------------------------------------------------------
// Scenario / suite orchestration
// ---------------------------------------------------------------------------

export interface TurnResult {
    readonly userText: string;
    readonly latencyMs: number;
    readonly assistantText: string;
    readonly transportError: TransportError | null;
    readonly agent: AgentTurnObservation | null;
    readonly legacy: LegacyTurnObservation | null;
    readonly rateLimitRetries: number;
}

export interface ScenarioRunResult {
    readonly scenarioId: string;
    readonly category: ScenarioCategory;
    readonly target: "agent" | "legacy";
    readonly turns: readonly TurnResult[];
    readonly checkResults: CheckResults;
    readonly judge: JudgeScore | null;
    readonly judgeError: string | null;
    readonly hadTransportError: boolean;
}

export interface RunScenarioOptions {
    readonly scenario: Scenario;
    readonly target: "agent" | "legacy";
    readonly baseUrl: string;
    readonly getToken: TokenProvider;
    readonly manifestCapabilities: ReadonlySet<string>;
    readonly fetchImpl: FetchLike;
    readonly sleepImpl: SleepFn;
    readonly judgeCall: JudgeCaller;
}

/** Runs every turn of one scenario sequentially against one target, then checks and judges the last turn. */
export async function runScenario(options: RunScenarioOptions): Promise<ScenarioRunResult> {
    const { scenario, target } = options;
    let sessionId: string | null = null;
    const turns: TurnResult[] = [];
    const transcript: TranscriptTurn[] = [];
    let hadTransportError = false;
    let lastAgentTurn: AgentTurnObservation | null = null;
    let lastLegacyTurn: LegacyTurnObservation | null = null;

    for (let index = 0; index < scenario.turns.length; index += 1) {
        const message = scenario.turns[index];
        if (message === undefined) continue;
        const sendResult = await sendTurn({
            baseUrl: options.baseUrl,
            getToken: options.getToken,
            target,
            message,
            sessionId,
            turnId: `${scenario.id}-turn-${index + 1}`,
            fetchImpl: options.fetchImpl,
            sleepImpl: options.sleepImpl,
        });

        if (!sendResult.ok) {
            hadTransportError = true;
            turns.push({
                userText: message,
                latencyMs: sendResult.latencyMs,
                assistantText: "",
                transportError: sendResult.transportError,
                agent: null,
                legacy: null,
                rateLimitRetries: sendResult.rateLimitRetries,
            });
            transcript.push({ userText: message, assistantText: "", toolCalls: [], proposals: [] });
            // A failed turn leaves no session to continue from; stop the scenario here.
            break;
        }

        const events = extractSseDataEvents(sendResult.body);
        if (target === "agent") {
            const agentTurn = assembleAgentTurn(events, options.manifestCapabilities);
            lastAgentTurn = agentTurn;
            sessionId = sendResult.headerSessionId ?? sessionId;
            turns.push({
                userText: message,
                latencyMs: sendResult.latencyMs,
                assistantText: agentTurn.finalText,
                transportError: null,
                agent: agentTurn,
                legacy: null,
                rateLimitRetries: sendResult.rateLimitRetries,
            });
            transcript.push({
                userText: message,
                assistantText: agentTurn.finalText,
                toolCalls: agentTurn.toolCalls.map((call) => ({ capability: call.capability, input: call.input, output: call.output })),
                proposals: agentTurn.proposals.map((proposal) => ({ source: proposal.source, taskState: proposal.taskState })),
            });
        } else {
            const legacyTurn = assembleLegacyTurn(events);
            lastLegacyTurn = legacyTurn;
            sessionId = legacyTurn.sessionId ?? sessionId;
            turns.push({
                userText: message,
                latencyMs: sendResult.latencyMs,
                assistantText: legacyTurn.finalText,
                transportError: null,
                agent: null,
                legacy: legacyTurn,
                rateLimitRetries: sendResult.rateLimitRetries,
            });
            transcript.push({ userText: message, assistantText: legacyTurn.finalText, toolCalls: [], proposals: [] });
        }
    }

    const facts = hadTransportError
        ? emptyDeterministicFacts(target)
        : target === "agent" && lastAgentTurn !== null
            ? deterministicFactsFromAgentTurn(lastAgentTurn)
            : lastLegacyTurn !== null
                ? deterministicFactsFromLegacyTurn(lastLegacyTurn)
                : emptyDeterministicFacts(target);

    // A transport error is a deterministic failure on every declared check and
    // a zero judge score on every metric — never excluded from averages (E6).
    const checkResults = hadTransportError
        ? transportFailureCheckResults(scenario.checks)
        : evaluateChecks(scenario.checks, facts);

    let judge: JudgeScore | null;
    let judgeError: string | null = null;
    if (hadTransportError) {
        judge = TRANSPORT_FAILURE_JUDGE_SCORE;
    } else {
        const prompt = buildJudgePrompt(scenario, transcript);
        judge = await callJudgeWithRetry(options.judgeCall, prompt, options.sleepImpl);
        if (judge === null) judgeError = "Judge call failed after retries";
    }

    return {
        scenarioId: scenario.id,
        category: scenario.category,
        target,
        turns,
        checkResults,
        judge,
        judgeError,
        hadTransportError,
    };
}

/** Legacy excludes `write`-category scenarios entirely (chat confirmation is its official mechanism). */
export function selectScenarios(
    scenarios: readonly Scenario[],
    target: "agent" | "legacy",
    only?: readonly string[],
): Scenario[] {
    let selected = only && only.length > 0
        ? scenarios.filter((scenario) => only.includes(scenario.id))
        : [...scenarios];
    if (target === "legacy") {
        selected = selected.filter((scenario) => !LEGACY_EXCLUDED_CATEGORIES.includes(scenario.category));
    }
    return selected;
}

export interface RunSuiteOptions {
    readonly scenarios: readonly Scenario[];
    readonly target: "agent" | "legacy";
    readonly baseUrl: string;
    readonly getToken: TokenProvider;
    readonly manifestCapabilities: ReadonlySet<string>;
    readonly fetchImpl: FetchLike;
    readonly sleepImpl: SleepFn;
    readonly judgeCall: JudgeCaller;
    readonly concurrency: number;
    readonly only?: readonly string[];
}

/** Runs scenarios sequentially within each scenario (turn order) and up to `concurrency` scenarios in parallel. */
export async function runSuite(options: RunSuiteOptions): Promise<ScenarioRunResult[]> {
    const selected = selectScenarios(options.scenarios, options.target, options.only);
    const results: ScenarioRunResult[] = new Array(selected.length);
    let nextIndex = 0;
    const concurrency = Math.max(1, Math.floor(options.concurrency));

    async function worker(): Promise<void> {
        for (;;) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= selected.length) return;
            const scenario = selected[index];
            if (scenario === undefined) continue;
            results[index] = await runScenario({
                scenario,
                target: options.target,
                baseUrl: options.baseUrl,
                getToken: options.getToken,
                manifestCapabilities: options.manifestCapabilities,
                fetchImpl: options.fetchImpl,
                sleepImpl: options.sleepImpl,
                judgeCall: options.judgeCall,
            });
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(selected.length, 1)) }, () => worker()));
    return results;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface MetricMeans {
    readonly intent: number | null;
    readonly depth: number | null;
    readonly grounding: number | null;
    readonly format: number | null;
}

export interface AggregateReport {
    readonly overall: MetricMeans;
    readonly byCategory: Readonly<Record<string, MetricMeans>>;
    /** pass / (pass + fail) over every declared check across every scenario; n/a checks are excluded from both. */
    readonly deterministicPassRate: number | null;
    readonly deterministicPassCount: number;
    readonly deterministicFailCount: number;
    readonly deterministicNaCount: number;
    readonly turnLatencyP50: number | null;
    readonly turnLatencyP95: number | null;
    readonly judgeErrorCount: number;
    readonly transportErrorCount: number;
    readonly judgedScenarioCount: number;
    readonly totalScenarioCount: number;
}

function mean(values: readonly number[]): number | null {
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sortedAscending: readonly number[], p: number): number | null {
    if (sortedAscending.length === 0) return null;
    const index = Math.min(sortedAscending.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAscending.length) - 1));
    return sortedAscending[index] ?? null;
}

function metricMeansOf(results: readonly ScenarioRunResult[]): MetricMeans {
    const scored = results.filter((result): result is ScenarioRunResult & { judge: JudgeScore } => result.judge !== null);
    return {
        intent: mean(scored.map((result) => result.judge.intent)),
        depth: mean(scored.map((result) => result.judge.depth)),
        grounding: mean(scored.map((result) => result.judge.grounding)),
        format: mean(scored.map((result) => result.judge.format)),
    };
}

/**
 * Aggregates a suite run. judgeError scenarios are excluded from the judge
 * metric means (they contribute no score) but are counted in judgeErrorCount;
 * a transport-error scenario always carries the zero judge score, so it is
 * included in the means (per E6, it is never excluded).
 */
export function aggregateResults(results: readonly ScenarioRunResult[]): AggregateReport {
    const categories = [...new Set(results.map((result) => result.category))].sort();
    const byCategory: Record<string, MetricMeans> = {};
    for (const category of categories) {
        byCategory[category] = metricMeansOf(results.filter((result) => result.category === category));
    }

    let pass = 0;
    let fail = 0;
    let na = 0;
    for (const result of results) {
        for (const status of Object.values(result.checkResults)) {
            if (status === "pass") pass += 1;
            else if (status === "fail") fail += 1;
            else na += 1;
        }
    }

    const latencies = results.flatMap((result) => result.turns.map((turn) => turn.latencyMs)).sort((a, b) => a - b);

    return {
        overall: metricMeansOf(results),
        byCategory,
        deterministicPassRate: pass + fail === 0 ? null : pass / (pass + fail),
        deterministicPassCount: pass,
        deterministicFailCount: fail,
        deterministicNaCount: na,
        turnLatencyP50: percentile(latencies, 50),
        turnLatencyP95: percentile(latencies, 95),
        judgeErrorCount: results.filter((result) => result.judgeError !== null).length,
        transportErrorCount: results.filter((result) => result.hadTransportError).length,
        judgedScenarioCount: results.filter((result) => result.judge !== null).length,
        totalScenarioCount: results.length,
    };
}

// ---------------------------------------------------------------------------
// Report + markdown rendering
// ---------------------------------------------------------------------------

export interface RunReport {
    readonly schemaVersion: 1;
    readonly target: "agent" | "legacy";
    readonly label: string;
    readonly judgeModel: string;
    readonly scenarioVersion: string;
    readonly gitSha: string | null;
    readonly generatedAt: string;
    readonly results: readonly ScenarioRunResult[];
    readonly aggregate: AggregateReport;
}

export interface BuildRunReportParams {
    readonly target: "agent" | "legacy";
    readonly label: string;
    readonly judgeModel: string;
    readonly scenarioVersion: string;
    readonly gitSha: string | null;
    readonly now: () => Date;
    readonly results: readonly ScenarioRunResult[];
}

export function buildRunReport(params: BuildRunReportParams): RunReport {
    return {
        schemaVersion: 1,
        target: params.target,
        label: params.label,
        judgeModel: params.judgeModel,
        scenarioVersion: params.scenarioVersion,
        gitSha: params.gitSha,
        generatedAt: params.now().toISOString(),
        results: params.results,
        aggregate: aggregateResults(params.results),
    };
}

function fmtScore(value: number | null): string {
    return value === null ? "n/a" : value.toFixed(2);
}

function fmtRate(value: number | null): string {
    return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function renderMarkdownTranscript(report: RunReport): string {
    const lines: string[] = [];
    const a = report.aggregate;
    lines.push(`# Chat quality report — ${report.label} (${report.target})`);
    lines.push("");
    lines.push(`Generated: ${report.generatedAt}  `);
    lines.push(`Judge model: ${report.judgeModel}  `);
    lines.push(`Scenario version: ${report.scenarioVersion}  `);
    lines.push(`Git SHA: ${report.gitSha ?? "unknown"}`);
    lines.push("");
    lines.push("## Aggregate");
    lines.push(`- Overall means — intent: ${fmtScore(a.overall.intent)}, depth: ${fmtScore(a.overall.depth)}, grounding: ${fmtScore(a.overall.grounding)}, format: ${fmtScore(a.overall.format)}`);
    lines.push(`- Deterministic pass rate: ${fmtRate(a.deterministicPassRate)} (pass ${a.deterministicPassCount} / fail ${a.deterministicFailCount} / n/a ${a.deterministicNaCount})`);
    lines.push(`- Turn latency p50/p95: ${a.turnLatencyP50 ?? "n/a"}ms / ${a.turnLatencyP95 ?? "n/a"}ms`);
    lines.push(`- judgeError: ${a.judgeErrorCount}, transportError: ${a.transportErrorCount}, judged ${a.judgedScenarioCount}/${a.totalScenarioCount}`);
    lines.push("");
    lines.push("## Per category");
    for (const [category, means] of Object.entries(a.byCategory)) {
        lines.push(`- ${category}: intent ${fmtScore(means.intent)}, depth ${fmtScore(means.depth)}, grounding ${fmtScore(means.grounding)}, format ${fmtScore(means.format)}`);
    }
    lines.push("");
    lines.push("## Scenarios");
    for (const result of report.results) {
        lines.push(`### ${result.scenarioId} (${result.category})`);
        if (result.judge) {
            lines.push(`Judge — intent ${result.judge.intent}, depth ${result.judge.depth}, grounding ${result.judge.grounding}, format ${result.judge.format}: ${result.judge.rationale}`);
        }
        if (result.judgeError) lines.push(`Judge error: ${result.judgeError}`);
        lines.push(`Checks: ${JSON.stringify(result.checkResults)}`);
        result.turns.forEach((turn, index) => {
            lines.push(`- Turn ${index + 1} (${turn.latencyMs}ms) — User: ${turn.userText}`);
            lines.push(`  Assistant: ${turn.assistantText || "(no text)"}`);
            if (turn.transportError) lines.push(`  Transport error: HTTP ${turn.transportError.status}${turn.transportError.code ? ` (${turn.transportError.code})` : ""}`);
        });
        lines.push("");
    }
    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Compare-table rendering
// ---------------------------------------------------------------------------

export interface ComparisonInput {
    readonly label: string;
    readonly report: RunReport;
}

/** Judge means over the intersection of scenario ids judged in every compared run (E6). */
export function computeIntersectionMeans(inputs: readonly ComparisonInput[]): Readonly<Record<string, MetricMeans>> {
    const judgedIdSets = inputs.map((input) => new Set(
        input.report.results.filter((result) => result.judge !== null).map((result) => result.scenarioId),
    ));
    const first = judgedIdSets[0];
    const intersection = first === undefined
        ? new Set<string>()
        : judgedIdSets.reduce((acc, set) => new Set([...acc].filter((id) => set.has(id))), first);

    const out: Record<string, MetricMeans> = {};
    for (const { label, report } of inputs) {
        const subset = report.results.filter((result) => intersection.has(result.scenarioId));
        out[label] = metricMeansOf(subset);
    }
    return out;
}

function truncatePreview(text: string, maxChars: number): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
}

/** Renders the `--compare` side-by-side markdown table: per-scenario scores + a 300-char answer preview, plus aggregates. */
export function renderCompareMarkdown(inputs: readonly ComparisonInput[]): string {
    const lines: string[] = [];
    lines.push(`# Chat quality comparison: ${inputs.map((i) => i.label).join(" vs ")}`);
    lines.push("");
    lines.push("## Aggregate");
    lines.push("| Run | Judged | Deterministic pass rate (n/a) | intent | depth | grounding | format |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const { label, report } of inputs) {
        const a = report.aggregate;
        lines.push(
            `| ${label} | ${a.judgedScenarioCount}/${a.totalScenarioCount} `
            + `(judgeError ${a.judgeErrorCount}, transportError ${a.transportErrorCount}) `
            + `| ${fmtRate(a.deterministicPassRate)} (n/a ${a.deterministicNaCount}) `
            + `| ${fmtScore(a.overall.intent)} | ${fmtScore(a.overall.depth)} | ${fmtScore(a.overall.grounding)} | ${fmtScore(a.overall.format)} |`,
        );
    }
    lines.push("");
    lines.push("## Judge means over scenarios judged in every run (intersection)");
    const intersectionMeans = computeIntersectionMeans(inputs);
    lines.push("| Run | intent | depth | grounding | format |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const { label } of inputs) {
        const means = intersectionMeans[label] ?? { intent: null, depth: null, grounding: null, format: null };
        lines.push(`| ${label} | ${fmtScore(means.intent)} | ${fmtScore(means.depth)} | ${fmtScore(means.grounding)} | ${fmtScore(means.format)} |`);
    }
    lines.push("");
    lines.push("## Per scenario");
    const scenarioIds = [...new Set(inputs.flatMap((input) => input.report.results.map((result) => result.scenarioId)))].sort();
    lines.push(`| Scenario | ${inputs.map((i) => i.label).join(" | ")} |`);
    lines.push(`| --- | ${inputs.map(() => "---").join(" | ")} |`);
    for (const scenarioId of scenarioIds) {
        const cells = inputs.map(({ report }) => {
            const result = report.results.find((r) => r.scenarioId === scenarioId);
            if (!result) return "(not run)";
            const scoreText = result.judge
                ? `I${result.judge.intent}/D${result.judge.depth}/G${result.judge.grounding}/F${result.judge.format}`
                : result.judgeError ? "judgeError" : "n/a";
            const lastTurn = result.turns[result.turns.length - 1];
            const preview = lastTurn ? truncatePreview(lastTurn.assistantText, 300) : "";
            return `${scoreText} — ${preview}`;
        });
        lines.push(`| ${scenarioId} | ${cells.join(" | ")} |`);
    }
    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Base-URL loopback guard (E8)
// ---------------------------------------------------------------------------

export class LoopbackGuardError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "LoopbackGuardError";
    }
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * Refuses any base URL whose host is not `127.0.0.1`/`localhost`/`::1`. This
 * guard ensures the bearer token is only ever sent to a local backend; it
 * does NOT identify which database that backend is pointed at (E8).
 */
export function validateLoopbackBaseUrl(raw: string): URL {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw new LoopbackGuardError(`AGENT_EVAL_BASE_URL "${raw}" is not a valid URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new LoopbackGuardError(`AGENT_EVAL_BASE_URL must use http or https, got protocol "${parsed.protocol}"`);
    }
    if (parsed.username !== "" || parsed.password !== "") {
        throw new LoopbackGuardError("AGENT_EVAL_BASE_URL must not contain embedded credentials");
    }
    if (!LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
        throw new LoopbackGuardError(
            `AGENT_EVAL_BASE_URL host "${parsed.hostname}" is not local (127.0.0.1/localhost/::1). `
            + "This guard ensures the token is only ever sent to a local backend; it does not identify "
            + "which database that backend is pointed at. Refusing to send credentials to a non-loopback host.",
        );
    }
    return parsed;
}
