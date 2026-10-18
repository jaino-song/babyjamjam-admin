import type { ServiceRecordEditJsonValue } from "domain/repositories/service-record-edit.repository.interface";
import type {
    ServiceRecordRevisionChangesResponse,
    ServiceRecordRevisionChangeValue,
    ServiceRecordRevisionFieldChange,
} from "interface/dto/admin-service-record-edit.dto";
import { serviceRecordSignatureFingerprint } from "application/utils/service-record-signature-fingerprint";

type Json = ServiceRecordEditJsonValue;
type ObjectValue = { [key: string]: Json };

function object(value: Json | undefined): ObjectValue {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function canonical(value: Json | undefined): Json {
    if (value == null) return null;
    if (Array.isArray(value)) return value.map(canonical);
    if (typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function stable(value: Json | undefined): string {
    return JSON.stringify(canonical(value));
}

// Values are projected from an allowlist, not a serialized payload. Also redact
// data URIs in free-text/JSON values so an embedded image cannot escape it.
function safe(value: Json): Json {
    if (typeof value === "string") return /data:[^,\s]*,/i.test(value) ? "[redacted]" : value;
    if (Array.isArray(value)) return value.map(safe);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safe(item)]));
    }
    return value;
}

function changeValue(value: Json | undefined): ServiceRecordRevisionChangeValue {
    const sanitized = safe(value ?? null);
    if (sanitized === null || typeof sanitized !== "object") return sanitized;
    if (Array.isArray(sanitized) && sanitized.every((item) => typeof item === "string")) return sanitized as string[];
    return stable(sanitized);
}

function nonEmpty(value: Json | undefined): boolean {
    return value != null && value !== "" && !(typeof value === "object" && Object.keys(value).length === 0);
}

function keys(left: ObjectValue, right: ObjectValue): string[] {
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
}

function indexed(value: Json | undefined): Map<number, ObjectValue> {
    const result = new Map<number, ObjectValue>();
    for (const entry of Array.isArray(value) ? value : []) {
        const row = object(entry);
        if (typeof row["sessionIndex"] === "number" && Number.isInteger(row["sessionIndex"])) result.set(row["sessionIndex"], row);
    }
    return result;
}

function date(row: ObjectValue | undefined, planned: ObjectValue | undefined): string | null {
    const value = row?.["serviceDate"] ?? planned?.["serviceDate"];
    return typeof value === "string" ? value.slice(0, 10) : null;
}

export function buildServiceRecordRevisionChanges(revision: {
    id: string;
    revisionNumber: number;
    confirmedAt: Date;
    formVersionAtConfirm: number;
    beforeSnapshot: Json | null;
    payload: Json;
    plannedSessions: Json;
}): ServiceRecordRevisionChangesResponse {
    const response: ServiceRecordRevisionChangesResponse = {
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        confirmedAt: revision.confirmedAt.toISOString(),
        formVersion: revision.formVersionAtConfirm,
        beforeAvailable: revision.beforeSnapshot !== null,
        basicInfo: [],
        sessions: [],
    };
    if (revision.beforeSnapshot === null) return response;
    const before = object(revision.beforeSnapshot);
    const after = object(revision.payload);
    const push = (changes: ServiceRecordRevisionFieldChange[], path: string, left: Json | undefined, right: Json | undefined) => {
        if (stable(left) !== stable(right)) changes.push({ path, before: changeValue(left), after: changeValue(right) });
    };
    for (const key of ["startDate", "endDate"]) push(response.basicInfo, `period.${key}`, before[key], after[key]);
    const headerBefore = object(before["header"]);
    const headerAfter = object(after["header"]);
    for (const key of keys(headerBefore, headerAfter)) push(response.basicInfo, `header.${key}`, headerBefore[key], headerAfter[key]);

    const rowsBefore = indexed(before["sessions"]);
    const rowsAfter = indexed(after["sessions"]);
    const plansBefore = indexed(before["plannedSessions"]);
    const plansAfter = indexed(revision.plannedSessions);
    const indices = [...new Set([...rowsBefore.keys(), ...rowsAfter.keys(), ...plansBefore.keys(), ...plansAfter.keys()])].sort((a, b) => a - b);
    for (const sessionIndex of indices) {
        const left = rowsBefore.get(sessionIndex);
        const right = rowsAfter.get(sessionIndex);
        const serviceDateBefore = date(left, plansBefore.get(sessionIndex));
        const serviceDateAfter = date(right, plansAfter.get(sessionIndex));
        const kind = !left && right ? "added" : left && !right ? "removed" : "changed";
        const changes: ServiceRecordRevisionFieldChange[] = [];
        if (!left && !right) {
            push(changes, "session.serviceDate", serviceDateBefore, serviceDateAfter);
        } else {
            const field = (path: string, oldValue: Json | undefined, newValue: Json | undefined) => {
                if (kind !== "changed") {
                    if (!nonEmpty(left ? oldValue : newValue)) return;
                    push(changes, path, left ? oldValue : null, right ? newValue : null);
                } else push(changes, path, oldValue, newValue);
            };
            field("session.serviceDate", left ? serviceDateBefore : null, right ? serviceDateAfter : null);
            const answersBefore = object(left?.["answers"]);
            const answersAfter = object(right?.["answers"]);
            for (const key of keys(answersBefore, answersAfter)) field(`session.answers.${key}`, answersBefore[key], answersAfter[key]);
            for (const key of ["etcService", "notes", "paymentConfirmed"]) field(`session.${key}`, left?.[key], right?.[key]);
            if (stable(left?.["employeeId"]) !== stable(right?.["employeeId"])) {
                field("session.employee", left?.["employeeNameSnapshot"], right?.["employeeNameSnapshot"]);
                // Different employees can share the same display name.
                if (!changes.some((change) => change.path === "session.employee")) {
                    changes.push({ path: "session.employee", before: changeValue(left?.["employeeNameSnapshot"]), after: changeValue(right?.["employeeNameSnapshot"]) });
                }
            }
            const oldSignature = left?.["clientSignatureFingerprint"] ?? null;
            const newSignature = serviceRecordSignatureFingerprint(typeof right?.["clientSignature"] === "string" ? right["clientSignature"] : null);
            if (oldSignature !== newSignature) {
                changes.push({
                    path: "session.clientSignature",
                    before: left ? oldSignature ? "present" : "absent" : null,
                    after: right ? newSignature ? oldSignature ? "replaced" : "present" : "absent" : null,
                });
            }
        }
        if (changes.length) response.sessions.push({ sessionIndex, kind, serviceDateBefore, serviceDateAfter, changes });
    }
    return response;
}
