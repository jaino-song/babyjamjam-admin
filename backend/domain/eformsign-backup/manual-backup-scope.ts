export const MANUAL_BACKUP_CONTRACT_MILESTONES = Object.freeze([
    "created", "sent", "opened", "signed", "reviewed", "completed",
] as const);
export const MANUAL_BACKUP_RECORD_MILESTONES = Object.freeze([
    "created", "sent", "reviewed", "completed",
] as const);

export type ContractMilestone = typeof MANUAL_BACKUP_CONTRACT_MILESTONES[number];
export type RecordMilestone = typeof MANUAL_BACKUP_RECORD_MILESTONES[number];
export type ManualBackupKind = "all" | "contract" | "record";
export type ManualBackupPeriod = "all" | "7" | "30" | "custom";

export interface ManualBackupScope {
    readonly period: ManualBackupPeriod;
    readonly start: string;
    readonly end: string;
    readonly kind: ManualBackupKind;
    readonly contractStages: readonly ContractMilestone[];
    readonly recordStages: readonly RecordMilestone[];
}

export interface ManualBackupScopeIssue {
    readonly path: string;
    readonly message: string;
}

export type ManualBackupScopeResult =
    | { readonly ok: true; readonly value: ManualBackupScope }
    | { readonly ok: false; readonly issues: readonly ManualBackupScopeIssue[] };

export type ManualBackupDocument =
    | { readonly kind: "contract"; readonly currentMilestone: ContractMilestone | null; readonly createdAt: Date }
    | { readonly kind: "record"; readonly currentMilestone: RecordMilestone | null; readonly createdAt: Date };

export interface ManualBackupScopeDecision {
    readonly matches: boolean;
    readonly reason: null | "kind-filter" | "date-filter" | "stage-filter" | "stage-unverified" | "invalid-date";
}

const SCOPE_KEYS = ["period", "start", "end", "kind", "contractStages", "recordStages"] as const;
const MAX_STAGE_ITEMS = 32;
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function calendarDayMs(value: string): number | undefined {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return undefined;
    const date = new Date(`${value}T00:00:00.000Z`);
    const timestamp = date.getTime();
    if (!Number.isFinite(timestamp) || date.toISOString().slice(0, 10) !== value) return undefined;
    return timestamp;
}

function parseStages<Milestone extends string>(
    input: unknown,
    allowed: readonly Milestone[],
    path: "contractStages" | "recordStages",
    issues: ManualBackupScopeIssue[],
): Milestone[] {
    if (!Array.isArray(input)) {
        issues.push({ path, message: "단계 목록을 입력하세요" });
        return [];
    }
    if (input.length > MAX_STAGE_ITEMS) {
        issues.push({ path, message: "단계는 최대 32개까지 입력하세요" });
        return [];
    }
    const selected = new Set<Milestone>();
    for (let index = 0; index < input.length; index += 1) {
        const value: unknown = input[index];
        const milestone = allowed.find((id) => id === value);
        if (milestone === undefined) {
            issues.push({ path: `${path}.${index}`, message: "올바른 단계를 선택하세요" });
        } else {
            selected.add(milestone);
        }
    }
    return allowed.filter((id) => selected.has(id));
}

function parseScope(input: unknown): ManualBackupScopeResult {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
        return { ok: false, issues: [{ path: "", message: "백업 범위 객체를 입력하세요" }] };
    }
    const prototype: unknown = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
        return { ok: false, issues: [{ path: "", message: "백업 범위 객체를 입력하세요" }] };
    }

    const issues: ManualBackupScopeIssue[] = [];
    // Do not echo unknown keys: even a property name can contain personal data.
    if (Reflect.ownKeys(input).some((key) => !SCOPE_KEYS.some((allowed) => key === allowed))) {
        issues.push({ path: "", message: "허용되지 않은 필드가 있습니다" });
    }
    const fields: Partial<Record<typeof SCOPE_KEYS[number], unknown>> = {};
    for (const key of SCOPE_KEYS) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor) {
            issues.push({ path: key, message: "필수 항목을 입력하세요" });
        } else if (!("value" in descriptor)) {
            issues.push({ path: key, message: "올바른 값을 입력하세요" });
        } else {
            fields[key] = descriptor.value;
        }
    }

    const { period, start, end, kind } = fields;
    const validPeriod = period === "all" || period === "7" || period === "30" || period === "custom";
    const validKind = kind === "all" || kind === "contract" || kind === "record";
    if (!validPeriod) issues.push({ path: "period", message: "올바른 기간을 선택하세요" });
    if (!validKind) issues.push({ path: "kind", message: "올바른 문서 종류를 선택하세요" });
    if (typeof start !== "string") issues.push({ path: "start", message: "날짜 문자열을 입력하세요" });
    if (typeof end !== "string") issues.push({ path: "end", message: "날짜 문자열을 입력하세요" });

    const contractStages = parseStages(fields.contractStages, MANUAL_BACKUP_CONTRACT_MILESTONES, "contractStages", issues);
    const recordStages = parseStages(fields.recordStages, MANUAL_BACKUP_RECORD_MILESTONES, "recordStages", issues);
    if (validKind && kind !== "record" && contractStages.length === 0) {
        issues.push({ path: "contractStages", message: "계약서 단계를 선택하세요" });
    }
    if (validKind && kind !== "contract" && recordStages.length === 0) {
        issues.push({ path: "recordStages", message: "제공기록지 단계를 선택하세요" });
    }

    if (!validPeriod || !validKind || typeof start !== "string" || typeof end !== "string") {
        return { ok: false, issues };
    }
    const startMs = start === "" ? undefined : calendarDayMs(start);
    const endMs = end === "" ? undefined : calendarDayMs(end);
    if (start !== "" && startMs === undefined) issues.push({ path: "start", message: "올바른 날짜를 입력하세요" });
    if (end !== "" && endMs === undefined) issues.push({ path: "end", message: "올바른 날짜를 입력하세요" });
    if (period === "all") {
        if (start !== "") issues.push({ path: "start", message: "전체 기간의 시작일은 비워주세요" });
        if (end !== "") issues.push({ path: "end", message: "전체 기간의 종료일은 비워주세요" });
    }
    if (startMs !== undefined && endMs !== undefined && startMs > endMs) {
        issues.push({ path: "end", message: "종료일은 시작일 이후로 선택하세요" });
    }
    if (period === "7" || period === "30") {
        if (start === "") issues.push({ path: "start", message: "시작일을 입력하세요" });
        if (end === "") issues.push({ path: "end", message: "종료일을 입력하세요" });
        // Posted visible bounds are frozen; do not consult the current clock.
        if (startMs !== undefined && endMs !== undefined && (endMs - startMs) / DAY_MS + 1 !== Number(period)) {
            issues.push({ path: "end", message: "선택한 기간과 날짜 범위가 일치하지 않습니다" });
        }
    }
    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, value: { period, start, end, kind, contractStages, recordStages } };
}

export function parseManualBackupScope(input: unknown): ManualBackupScopeResult {
    try {
        return parseScope(input);
    } catch {
        // Unknown JS values may be proxies or arrays with throwing accessors.
        return { ok: false, issues: [{ path: "", message: "올바른 백업 범위를 입력하세요" }] };
    }
}

function validatedScope(scope: ManualBackupScope): ManualBackupScope {
    const parsed = parseManualBackupScope(scope);
    if (!parsed.ok) throw new RangeError("올바른 백업 범위를 입력하세요");
    return parsed.value;
}

function kstRange(scope: ManualBackupScope): { gte?: Date; lt?: Date } {
    if (scope.period === "all") return {};
    const range: { gte?: Date; lt?: Date } = {};
    // Scope was validated above; ISO date-only parsing and day math use UTC.
    if (scope.start !== "") range.gte = new Date(new Date(`${scope.start}T00:00:00.000Z`).getTime() - KST_OFFSET_MS);
    if (scope.end !== "") range.lt = new Date(new Date(`${scope.end}T00:00:00.000Z`).getTime() + DAY_MS - KST_OFFSET_MS);
    return range;
}

/** createdDate bounds: KST start midnight inclusive, next-day midnight exclusive. */
export function manualBackupKstRange(scope: ManualBackupScope): { gte?: Date; lt?: Date } {
    return kstRange(validatedScope(scope));
}

/** Stable serialization for later application-level request fingerprinting. */
export function canonicalManualBackupScope(scope: ManualBackupScope): string {
    return JSON.stringify(validatedScope(scope));
}

/** Caller projects the current milestone and enforces branch/purge authorization. */
export function decideManualBackupScope(scope: ManualBackupScope, document: ManualBackupDocument): ManualBackupScopeDecision {
    const normalized = validatedScope(scope);
    const createdAtMs = document.createdAt.getTime();
    if (!Number.isFinite(createdAtMs)) return { matches: false, reason: "invalid-date" };
    if (normalized.kind !== "all" && normalized.kind !== document.kind) return { matches: false, reason: "kind-filter" };
    const range = kstRange(normalized);
    if ((range.gte && createdAtMs < range.gte.getTime()) || (range.lt && createdAtMs >= range.lt.getTime())) {
        return { matches: false, reason: "date-filter" };
    }
    const selected: readonly string[] = document.kind === "contract" ? normalized.contractStages : normalized.recordStages;
    if (document.currentMilestone === null) {
        const all = document.kind === "contract" ? MANUAL_BACKUP_CONTRACT_MILESTONES : MANUAL_BACKUP_RECORD_MILESTONES;
        return { matches: all.every((id) => selected.includes(id)), reason: "stage-unverified" };
    }
    return selected.includes(document.currentMilestone)
        ? { matches: true, reason: null }
        : { matches: false, reason: "stage-filter" };
}
