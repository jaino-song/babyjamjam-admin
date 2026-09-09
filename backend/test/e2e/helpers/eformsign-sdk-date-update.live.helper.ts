import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FrameLocator } from "playwright-core";

import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { EFORMSIGN_END_DATE_FIELD_IDS } from "application/usecases/eformsign-doc/eformsign-end-date-field-ids";
import {
    assertEformsignSdkDocumentIdentity,
    getAdvertisedOperationalActions,
    hashPdfBody,
    sanitizeActionCallback,
    type EformsignSdkDocumentSnapshot,
    type SanitizedEformsignAction,
    type SanitizedEformsignActionCallback,
} from "./eformsign-sdk-capability.live.helper";

export const EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID =
    "27e3c3287859433dbd8a680525c5338d";
export const EFORMSIGN_SDK_DATE_UPDATE_TEMPLATE_ID =
    "27f092d3bdba4777835187facd7468a6";
export const EFORMSIGN_SDK_DATE_UPDATE_USER_EMAIL = "forchildrenbysongs@gmail.com";
export const EFORMSIGN_SDK_DATE_UPDATE_RECIPIENT_ID =
    "142f6049d9af43e19b32ddf4c5139120";
/** The detail API uses `insider` for an internal member recipient. */
export const EFORMSIGN_SDK_DATE_UPDATE_RECIPIENT_TYPE = "insider";
export const EFORMSIGN_SDK_DATE_UPDATE_PDF_SHA256 =
    "d1eadbae10ca458751044f8c7829d4118d09b14f1900eb2d182e7493682f6509";
export const EFORMSIGN_SDK_DATE_UPDATE_BASELINE_PDF_SHA256 = EFORMSIGN_SDK_DATE_UPDATE_PDF_SHA256;

export const EFORMSIGN_SDK_DATE_UPDATE_IFRAME_ID = "eformsign_sdk_date_update_iframe";
export const EFORMSIGN_SDK_DATE_UPDATE_DISPATCH_BRIDGE =
    "__eformsignSdkDateUpdateDispatchCurrentParticipantSend";

export const EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STATUS_TYPE = "071";
export const EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STEP_TYPE = "05";
export const EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STEP_INDEX = "3";
export const EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STEP_GROUP = 4;
export const EFORMSIGN_SDK_DATE_UPDATE_AFTER_STATUS_TYPE = "070";
export const EFORMSIGN_SDK_DATE_UPDATE_AFTER_STEP_TYPE = "06";
export const EFORMSIGN_SDK_DATE_UPDATE_AFTER_STEP_INDEX = "4";
export const EFORMSIGN_SDK_DATE_UPDATE_AFTER_STEP_GROUP = 5;

export const EFORMSIGN_SDK_DATE_UPDATE_BASELINE_END_DATE = "2027-01-05";
export const EFORMSIGN_SDK_DATE_UPDATE_TARGET_END_DATE = "2027-01-06";
export const EFORMSIGN_SDK_DATE_UPDATE_BASELINE_RECEIPT_PERIOD = "20260709~20270105";
export const EFORMSIGN_SDK_DATE_UPDATE_TARGET_RECEIPT_PERIOD = "20260709~20270106";
export const EFORMSIGN_SDK_DATE_UPDATE_PAYMENT_DATE = "2026-07-09";
export const EFORMSIGN_SDK_DATE_UPDATE_MONEY = {
    "서비스 비용": "1464000",
    "정부지원금": "1002000",
    "본인부담금": "462000",
} as const;

export const EFORMSIGN_SDK_DATE_UPDATE_SEND_ACTION = {
    type: "01",
    code: "22",
} as const;

const DATE_UPDATE_FIELD_IDS = [
    EFORMSIGN_END_DATE_FIELD_IDS.year,
    EFORMSIGN_END_DATE_FIELD_IDS.month,
    EFORMSIGN_END_DATE_FIELD_IDS.day,
    "서비스 기간",
] as const;
const SECURE_DIRECTORY_MODE = 0o700;
const SECURE_FILE_MODE = 0o600;
const MAX_ACTION_LABEL_LENGTH = 160;
const MAX_ACTION_CODE_LENGTH = 64;
const MAX_ACTIONS_PER_CALLBACK = 20;

export interface DateUpdatePrefillField {
    id: string;
    value: string;
    enabled: true;
    required: false;
}

export const EFORMSIGN_SDK_DATE_UPDATE_PREFILL_FIELDS: readonly DateUpdatePrefillField[] = [
    { id: EFORMSIGN_END_DATE_FIELD_IDS.year, value: "27", enabled: true, required: false },
    { id: EFORMSIGN_END_DATE_FIELD_IDS.month, value: "01", enabled: true, required: false },
    { id: EFORMSIGN_END_DATE_FIELD_IDS.day, value: "06", enabled: true, required: false },
    { id: "서비스 기간", value: "20260709 ~ 20270106", enabled: true, required: false },
];

export interface DateUpdateSdkProbeState {
    documentConfigured: boolean;
    openInvoked: boolean;
    opened: boolean;
    bootError: boolean;
    errorCallbackSeen: boolean;
    actionCallbacks: SanitizedEformsignActionCallback[];
    successCodes: string[];
    sendActionAttempted: boolean | null;
    sendActionCount: number | null;
    sendActionType: string | null;
    sendActionCode: string | null;
    sendActionErrorCode: string | null;
}

export interface DateUpdateSdkStageExpectation {
    statusType: string;
    stepType: string;
    stepIndex: string;
    stepGroup: number;
}

export interface SecurePdfArtifact {
    path: string;
    sha256: string;
    byteLength: number;
}

export interface DateUpdatePdfReader {
    downloadDocumentFile(
        accessToken: string,
        documentId: string,
        fileType?: "document" | "audit_trail",
    ): Promise<{
        status: number;
        contentType: string;
        contentDisposition: string | null;
        body: Buffer;
    }>;
}

export type DateUpdateModalSelector = "input-comment-popup" | "request-send-popup" | "unknown";
export type DateUpdateModalTarget = "not-observed" | "uncertain";
export type DateUpdateControl = "send" | "cancel" | "confirm" | "back" | "unknown";

export interface DateUpdateModalInventory {
    visible: boolean;
    selector: DateUpdateModalSelector;
    target: DateUpdateModalTarget;
    visibleDialogCount: number;
    controls: DateUpdateControl[];
    inspectionError: boolean;
}

export class DateUpdateNotVerifiedError extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = "DateUpdateNotVerifiedError";
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function boundedString(value: unknown, maxLength: number): string {
    if (typeof value === "string") return value.trim().slice(0, maxLength);
    if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, maxLength);
    return "";
}

function stableJson(value: unknown): string {
    return JSON.stringify(value) ?? "";
}

function normalizePeriod(value: string): string {
    return value.replace(/[\s-]/g, "");
}

function normalizeMoney(value: string): string {
    return value.replace(/[\s,₩원]/g, "");
}

function fieldsForId(document: EformsignApiDocumentResponse, id: string): Array<{ value: string; type: string }> {
    return (document.fields ?? [])
        .filter((field) => field.id === id)
        .map((field) => ({ value: String(field.value ?? ""), type: String(field.type ?? "") }));
}

function oneFieldValue(document: EformsignApiDocumentResponse, id: string): string {
    const fields = fieldsForId(document, id);
    if (fields.length !== 1) {
        throw new DateUpdateNotVerifiedError(`field ${id} did not have exactly one API value`);
    }
    return fields[0]!.value.trim();
}

function fieldFingerprint(document: EformsignApiDocumentResponse, excludedIds: ReadonlySet<string>): string {
    return stableJson((document.fields ?? [])
        .filter((field) => !excludedIds.has(field.id))
        .map((field) => ({
            id: String(field.id ?? ""),
            value: String(field.value ?? ""),
            type: String(field.type ?? ""),
        }))
        .sort((left, right) => stableJson(left).localeCompare(stableJson(right))));
}

export function normalizeDateUpdateSdkProbeState(value: unknown): DateUpdateSdkProbeState {
    const state = asRecord(value) ?? {};
    const actionCallbacks = Array.isArray(state["actionCallbacks"])
        ? state["actionCallbacks"].flatMap((item): SanitizedEformsignActionCallback[] => {
            const sanitized = sanitizeActionCallback(item);
            return sanitized ? [sanitized] : [];
        })
        : [];
    const successCodes = Array.isArray(state["successCodes"])
        ? state["successCodes"]
            .map((code) => boundedString(code, 32))
            .filter(Boolean)
            .slice(0, MAX_ACTIONS_PER_CALLBACK)
        : [];
    const sendActionAttempted = typeof state["sendActionAttempted"] === "boolean"
        ? state["sendActionAttempted"]
        : null;
    const sendActionCount = typeof state["sendActionCount"] === "number"
        && Number.isInteger(state["sendActionCount"])
        && state["sendActionCount"] >= 0
        ? state["sendActionCount"]
        : null;
    return {
        documentConfigured: state["documentConfigured"] === true,
        openInvoked: state["openInvoked"] === true,
        opened: state["opened"] === true,
        bootError: state["bootError"] === true,
        errorCallbackSeen: state["errorCallbackSeen"] === true,
        actionCallbacks,
        successCodes,
        sendActionAttempted,
        sendActionCount,
        sendActionType: boundedString(state["sendActionType"], 16) || null,
        sendActionCode: boundedString(state["sendActionCode"], MAX_ACTION_CODE_LENGTH) || null,
        sendActionErrorCode: boundedString(state["sendActionErrorCode"], 64) || null,
    };
}

export function getAdvertisedCurrentParticipantSendActions(
    callbacks: readonly SanitizedEformsignActionCallback[],
): SanitizedEformsignAction[] {
    return getAdvertisedOperationalActions(callbacks)
        .filter((action) => action.code === EFORMSIGN_SDK_DATE_UPDATE_SEND_ACTION.code);
}

export function assertCurrentParticipantSendAdvertised(
    callbacks: readonly SanitizedEformsignActionCallback[],
): SanitizedEformsignAction[] {
    const actions = getAdvertisedCurrentParticipantSendActions(callbacks);
    if (actions.length === 0) {
        throw new DateUpdateNotVerifiedError("fresh SDK actionCallback did not advertise participant send code 22");
    }
    return actions;
}

function serializeOption(value: Record<string, unknown>): string {
    return JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

/** Builds the test-only page. The action callback captures advertised codes only. */
export function buildDateUpdateSdkHtml(
    documentOption: Record<string, unknown>,
    options: { iframeId?: string } = {},
): string {
    const iframeId = options.iframeId ?? EFORMSIGN_SDK_DATE_UPDATE_IFRAME_ID;
    const optionJson = serializeOption(documentOption);
    const iframeIdJson = JSON.stringify(iframeId);
    const bridgeNameJson = JSON.stringify(EFORMSIGN_SDK_DATE_UPDATE_DISPATCH_BRIDGE);
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>eformsign date update test</title></head>
<body style="margin:0">
<iframe id=${iframeIdJson} style="width:100vw;height:100vh;border:0"></iframe>
<script>
(function () {
    var option = ${optionJson};
    var iframeId = ${iframeIdJson};
    var sdk = null;
    var bridgeName = ${bridgeNameJson};
    window.__eformsignSdkDateUpdateProbe = {
        documentConfigured: false,
        openInvoked: false,
        opened: false,
        bootError: false,
        errorCallbackSeen: false,
        actionCallbacks: [],
        successCodes: [],
        sendActionAttempted: false,
        sendActionCount: 0,
        sendActionType: null,
        sendActionCode: null,
        sendActionErrorCode: null
    };
    function boundedString(value, maxLength) {
        if (typeof value === "string") return value.trim().slice(0, maxLength);
        if (typeof value === "number" && isFinite(value)) return String(value).slice(0, maxLength);
        return "";
    }
    function sanitizeActionCallback(response) {
        if (!response || typeof response !== "object" || response.fn !== "actionCallback") return null;
        var data = Array.isArray(response.data) ? response.data : [];
        var actions = [];
        for (var i = 0; i < data.length && actions.length < ${MAX_ACTIONS_PER_CALLBACK}; i += 1) {
            var item = data[i];
            if (!item || typeof item !== "object") continue;
            var name = boundedString(item.name, ${MAX_ACTION_LABEL_LENGTH});
            var code = boundedString(item.code, ${MAX_ACTION_CODE_LENGTH});
            if (!name && !code) continue;
            actions.push({ name: name, code: code });
        }
        return { type: boundedString(response.type, 32), fn: "actionCallback", data: actions };
    }
    function setBootError(code) {
        window.__eformsignSdkDateUpdateProbe.bootError = true;
        window.__eformsignSdkDateUpdateProbe.sendActionErrorCode = boundedString(code, 64) || null;
    }
    function loadScript(src, done, errorCode) {
        var script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.onload = done;
        script.onerror = function () { setBootError(errorCode); };
        document.head.appendChild(script);
    }
    function successCallback(response) {
        var code = boundedString(response && response.code, 32);
        if (code && window.__eformsignSdkDateUpdateProbe.successCodes.length < ${MAX_ACTIONS_PER_CALLBACK}) {
            window.__eformsignSdkDateUpdateProbe.successCodes.push(code);
        }
    }
    function errorCallback(response) {
        window.__eformsignSdkDateUpdateProbe.errorCallbackSeen = true;
        window.__eformsignSdkDateUpdateProbe.sendActionErrorCode =
            boundedString(response && response.code, 64) || "sdk-error";
    }
    function actionCallback(response) {
        var sanitized = sanitizeActionCallback(response);
        if (sanitized) window.__eformsignSdkDateUpdateProbe.actionCallbacks.push(sanitized);
    }
    window[bridgeName] = function () {
        var probe = window.__eformsignSdkDateUpdateProbe;
        if (probe.sendActionAttempted) return false;
        var advertised = probe.actionCallbacks.some(function (callback) {
            return callback.data.some(function (action) { return action.code === "22"; });
        });
        if (!advertised) {
            probe.sendActionErrorCode = "action-code-22-not-observed";
            return false;
        }
        probe.sendActionAttempted = true;
        probe.sendActionCount += 1;
        probe.sendActionType = "01";
        probe.sendActionCode = "22";
        if (!sdk || typeof sdk.sendAction !== "function") {
            probe.sendActionErrorCode = "send-action-unsupported";
            return false;
        }
        try {
            sdk.sendAction({ type: "01", code: "22" });
            return true;
        } catch (error) {
            probe.sendActionErrorCode = "send-action-threw";
            return false;
        }
    };
    function open() {
        if (typeof window.EformSignDocument !== "function") return setBootError("sdk-not-initialized");
        try {
            sdk = new window.EformSignDocument();
            sdk.document(option, iframeId, successCallback, errorCallback, actionCallback);
            window.__eformsignSdkDateUpdateProbe.documentConfigured = true;
            window.__eformsignSdkDateUpdateProbe.openInvoked = true;
            sdk.open();
            window.__eformsignSdkDateUpdateProbe.opened = true;
        } catch (error) {
            setBootError("sdk-document-or-open-threw");
        }
    }
    loadScript("https://www.eformsign.com/plugins/jquery/jquery.min.js", function () {
        loadScript("https://www.eformsign.com/lib/js/efs_embedded_v2.js", open, "sdk-script-load");
    }, "jquery-script-load");
})();
</script></body></html>`;
}

/** Source-level guard for the official SDK page and its one-shot bridge. */
export function assertDateUpdateSdkHtml(
    html: string,
    iframeId = EFORMSIGN_SDK_DATE_UPDATE_IFRAME_ID,
): void {
    const documentCalls = html.match(/sdk\.document\s*\(/g) ?? [];
    const openCalls = html.match(/sdk\.open\s*\(/g) ?? [];
    const sendCalls = html.match(/sdk\.sendAction\s*\(/g) ?? [];
    if (documentCalls.length !== 1 || openCalls.length !== 1 || sendCalls.length !== 1) {
        throw new Error("date-update SDK page must register one document, one open, and one sendAction call");
    }
    if (!html.includes(`id=${JSON.stringify(iframeId)}`)) {
        throw new Error("date-update SDK iframe id is not stable");
    }
    if (!html.includes("sdk.document(option, iframeId, successCallback, errorCallback, actionCallback)")) {
        throw new Error("date-update SDK page must use the official callback registration order");
    }
    if (!html.includes("window[bridgeName]") || !html.includes(JSON.stringify(EFORMSIGN_SDK_DATE_UPDATE_DISPATCH_BRIDGE))) {
        throw new Error("date-update SDK page is missing the explicit dispatch bridge");
    }
    if (!html.includes('sdk.sendAction({ type: "01", code: "22" })')) {
        throw new Error("date-update SDK page must send only participant action code 22");
    }
    if (html.includes('sdk.sendAction({ type: "01", code: "20" })')
        || html.includes('sdk.sendAction({ type: "01", code: "05" })')) {
        throw new Error("date-update SDK page contains a forbidden completion action");
    }
    for (const forbidden of [
        "runEformsignCreationGates",
        "runEformsignFinalizeGates",
        ".click(",
        "execAction(",
        "sdk.save(",
        "sdk.finalize(",
        "sdk.approve(",
        "sdk.decline(",
    ]) {
        if (html.includes(forbidden)) throw new Error(`date-update SDK page contains a forbidden action: ${forbidden}`);
    }
    const actionCallbackStart = html.indexOf("function actionCallback");
    const bridgeStart = html.indexOf("window[bridgeName]");
    if (actionCallbackStart < 0 || bridgeStart < 0 || html.slice(actionCallbackStart, bridgeStart).includes("sendAction")) {
        throw new Error("date-update actionCallback must capture actions without dispatching one");
    }
    if (!html.includes("action.code === \"22\"") || !html.includes("probe.sendActionAttempted")) {
        throw new Error("date-update SDK bridge is not gated on fresh advertised code 22 and once-only state");
    }
}

export function assertDateUpdateMode02Option(
    value: unknown,
    documentId = EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID,
    templateId = EFORMSIGN_SDK_DATE_UPDATE_TEMPLATE_ID,
    userEmail = EFORMSIGN_SDK_DATE_UPDATE_USER_EMAIL,
): void {
    const option = asRecord(value);
    const mode = asRecord(option?.["mode"]);
    const user = asRecord(option?.["user"]);
    if (
        mode?.["type"] !== "02"
        || mode["document_id"] !== documentId
        || mode["template_id"] !== templateId
    ) {
        throw new DateUpdateNotVerifiedError("date-update SDK mode02 option does not match the exact document");
    }
    if (user?.["type"] !== "01" || user["id"] !== userEmail) {
        throw new DateUpdateNotVerifiedError("date-update SDK user identity does not match the exact allowlist");
    }
    if (Object.prototype.hasOwnProperty.call(option, "prefill")) {
        throw new DateUpdateNotVerifiedError("date-update SDK base option must not already contain prefill");
    }
}

export function buildDateUpdatePrefillOption(
    baseOption: Record<string, unknown>,
): Record<string, unknown> {
    assertDateUpdateMode02Option(baseOption);
    return {
        ...baseOption,
        prefill: {
            fields: EFORMSIGN_SDK_DATE_UPDATE_PREFILL_FIELDS.map((field) => ({ ...field })),
        },
    };
}

export function assertDateUpdatePrefillOption(value: unknown): void {
    const option = asRecord(value);
    const prefill = asRecord(option?.["prefill"]);
    const fields = prefill?.["fields"];
    if (!Array.isArray(fields) || fields.length !== DATE_UPDATE_FIELD_IDS.length) {
        throw new DateUpdateNotVerifiedError("date-update SDK option must contain exactly four prefill fields");
    }
    fields.forEach((field, index) => {
        const record = asRecord(field);
        const expected = EFORMSIGN_SDK_DATE_UPDATE_PREFILL_FIELDS[index]!;
        if (!record
            || record["id"] !== DATE_UPDATE_FIELD_IDS[index]
            || record["value"] !== expected.value
            || record["enabled"] !== true
            || record["required"] !== false
            || Object.keys(record).some((key) => !["id", "value", "enabled", "required"].includes(key))) {
            throw new DateUpdateNotVerifiedError("date-update SDK prefill field values are outside the exact four-field allowlist");
        }
    });
}

function assertDateUpdateStage(
    document: EformsignApiDocumentResponse,
    expectation: DateUpdateSdkStageExpectation,
): EformsignSdkDocumentSnapshot {
    const snapshot = assertEformsignSdkDocumentIdentity(document, {
        documentId: EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID,
        templateId: EFORMSIGN_SDK_DATE_UPDATE_TEMPLATE_ID,
        statusType: expectation.statusType,
        stepType: expectation.stepType,
        stepIndex: expectation.stepIndex,
        recipientId: EFORMSIGN_SDK_DATE_UPDATE_RECIPIENT_ID,
        recipientType: EFORMSIGN_SDK_DATE_UPDATE_RECIPIENT_TYPE,
        expiredDate: 0,
        expired: false,
    });
    if (document.current_status.step_group !== expectation.stepGroup) {
        throw new DateUpdateNotVerifiedError("date-update SDK document step group is outside the exact allowlist");
    }
    return snapshot;
}

export function assertDateUpdateBeforeOpenIdentity(
    document: EformsignApiDocumentResponse,
): EformsignSdkDocumentSnapshot {
    return assertDateUpdateStage(document, {
        statusType: EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STATUS_TYPE,
        stepType: EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STEP_TYPE,
        stepIndex: EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STEP_INDEX,
        stepGroup: EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STEP_GROUP,
    });
}

export function assertDateUpdateAfterSendIdentity(
    document: EformsignApiDocumentResponse,
): EformsignSdkDocumentSnapshot {
    return assertDateUpdateStage(document, {
        statusType: EFORMSIGN_SDK_DATE_UPDATE_AFTER_STATUS_TYPE,
        stepType: EFORMSIGN_SDK_DATE_UPDATE_AFTER_STEP_TYPE,
        stepIndex: EFORMSIGN_SDK_DATE_UPDATE_AFTER_STEP_INDEX,
        stepGroup: EFORMSIGN_SDK_DATE_UPDATE_AFTER_STEP_GROUP,
    });
}

export function assertDateUpdateBaselineFields(document: EformsignApiDocumentResponse): void {
    if (document.id !== EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID
        || oneFieldValue(document, EFORMSIGN_END_DATE_FIELD_IDS.year) !== "27"
        || oneFieldValue(document, EFORMSIGN_END_DATE_FIELD_IDS.month) !== "01"
        || oneFieldValue(document, EFORMSIGN_END_DATE_FIELD_IDS.day) !== "05"
        || normalizePeriod(oneFieldValue(document, "서비스 기간")) !== EFORMSIGN_SDK_DATE_UPDATE_BASELINE_RECEIPT_PERIOD) {
        throw new DateUpdateNotVerifiedError("date-update API fields were not at the Jan05 baseline");
    }
}

export function assertDateUpdateTargetFields(document: EformsignApiDocumentResponse): void {
    if (oneFieldValue(document, EFORMSIGN_END_DATE_FIELD_IDS.year) !== "27"
        || oneFieldValue(document, EFORMSIGN_END_DATE_FIELD_IDS.month) !== "01"
        || oneFieldValue(document, EFORMSIGN_END_DATE_FIELD_IDS.day) !== "06"
        || normalizePeriod(oneFieldValue(document, "서비스 기간")) !== EFORMSIGN_SDK_DATE_UPDATE_TARGET_RECEIPT_PERIOD) {
        throw new DateUpdateNotVerifiedError("date-update API fields were not at the Jan06 target");
    }
}

/** Only the four reviewed date fields may differ after participant send. */
export function assertDateUpdateOnlyAllowedFieldChanges(
    before: EformsignApiDocumentResponse,
    after: EformsignApiDocumentResponse,
): void {
    const allowed = new Set<string>(DATE_UPDATE_FIELD_IDS);
    if (fieldFingerprint(before, allowed) !== fieldFingerprint(after, allowed)) {
        throw new DateUpdateNotVerifiedError("date-update API changed a field outside the four-field allowlist");
    }
    assertDateUpdateBaselineFields(before);
    assertDateUpdateTargetFields(after);
    for (const [id, expected] of Object.entries(EFORMSIGN_SDK_DATE_UPDATE_MONEY)) {
        if (normalizeMoney(oneFieldValue(before, id)) !== expected
            || normalizeMoney(oneFieldValue(after, id)) !== expected) {
            throw new DateUpdateNotVerifiedError("date-update money fields did not retain their exact baseline values");
        }
    }
    const paymentIds = [
        "본인부담금 수령 년도",
        "본인부담금 수령 월",
        "본인부담금 수령 일",
    ];
    const beforePayment = paymentIds.map((id) => oneFieldValue(before, id));
    const afterPayment = paymentIds.map((id) => oneFieldValue(after, id));
    if (stableJson(beforePayment) !== stableJson(afterPayment)
        || stableJson(beforePayment) !== stableJson(["26", "07", "09"])) {
        throw new DateUpdateNotVerifiedError("date-update payment date fields did not remain immutable");
    }
}

export function assertDateUpdatePdfDownload(download: {
    status: number;
    contentType: string;
    body: Buffer;
}): void {
    if (
        download.status !== 200
        || !download.contentType.toLowerCase().includes("application/pdf")
        || !Buffer.isBuffer(download.body)
        || download.body.length < 5
        || download.body.subarray(0, 5).toString("ascii") !== "%PDF-"
    ) {
        throw new DateUpdateNotVerifiedError("date-update PDF response was not a successful PDF");
    }
}

export async function downloadDateUpdatePdf(
    reader: DateUpdatePdfReader,
    accessToken: string,
    documentId = EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID,
): Promise<Buffer> {
    if (documentId !== EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID) {
        throw new DateUpdateNotVerifiedError("date-update PDF document id is outside the exact allowlist");
    }
    const download = await reader.downloadDocumentFile(accessToken, documentId, "document");
    assertDateUpdatePdfDownload(download);
    return download.body;
}

export async function createSecureDateUpdateArtifactDirectory(): Promise<string> {
    const directory = await mkdtemp(join("/tmp", "eformsign-sdk-date-update-"));
    await chmod(directory, SECURE_DIRECTORY_MODE);
    if (((await stat(directory)).mode & 0o777) !== SECURE_DIRECTORY_MODE) {
        throw new DateUpdateNotVerifiedError("date-update PDF artifact directory was not secured");
    }
    return directory;
}

export async function writeSecureDateUpdatePdfArtifact(
    directory: string,
    label: "before" | "after",
    body: Buffer,
): Promise<SecurePdfArtifact> {
    assertDateUpdatePdfDownload({ status: 200, contentType: "application/pdf", body });
    const artifactPath = join(directory, `${label}.pdf`);
    await writeFile(artifactPath, body, { mode: SECURE_FILE_MODE, flag: "wx" });
    await chmod(artifactPath, SECURE_FILE_MODE);
    if (((await stat(artifactPath)).mode & 0o777) !== SECURE_FILE_MODE) {
        throw new DateUpdateNotVerifiedError("date-update PDF artifact was not secured");
    }
    return { path: artifactPath, sha256: hashPdfBody(body), byteLength: body.length };
}

/** A visible SDK modal is always uncertain and is returned for inspection only. */
export async function readDateUpdateModalInventory(
    eformsignFrame: FrameLocator,
): Promise<DateUpdateModalInventory> {
    return eformsignFrame.locator("body").evaluate((body): DateUpdateModalInventory => {
        const isVisible = (element: Element | null): element is HTMLElement => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
        const selectorFor = (element: Element): DateUpdateModalSelector => {
            if (element.id === "inputCommentPopup") return "input-comment-popup";
            if (element.id === "requestWithInputCommentPopup") return "request-send-popup";
            return "unknown";
        };
        const candidates = Array.from(body.querySelectorAll<HTMLElement>(
            "#inputCommentPopup, #requestWithInputCommentPopup, [role=dialog]",
        )).filter((element) => isVisible(element));
        const dialog = candidates[0] ?? null;
        if (!dialog) {
            return {
                visible: false,
                selector: "unknown",
                target: "not-observed",
                visibleDialogCount: 0,
                controls: [],
                inspectionError: false,
            };
        }
        const controlForLabel = (value: string): DateUpdateControl => {
            const label = value.replace(/\s+/g, "").trim();
            if (label === "전송" || label === "보내기" || label.toLowerCase() === "send") return "send";
            if (label === "취소" || label.toLowerCase() === "cancel") return "cancel";
            if (label === "확인" || label.toLowerCase() === "confirm") return "confirm";
            if (label === "뒤로" || label.toLowerCase() === "back") return "back";
            return "unknown";
        };
        const controls = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
            .filter((button) => isVisible(button))
            .map((button) => controlForLabel(button.innerText ?? ""));
        return {
            visible: true,
            selector: selectorFor(dialog),
            target: "uncertain",
            visibleDialogCount: candidates.length,
            controls: Array.from(new Set(controls)),
            inspectionError: false,
        };
    }, { timeout: 3_000 });
}

export function safeDateUpdateErrorReason(error: unknown, operation: string): string {
    if (error instanceof DateUpdateNotVerifiedError) return error.message;
    const record = asRecord(error);
    const status = record?.["status"];
    const vendorCode = record?.["vendorCode"];
    if (typeof status === "number" && Number.isFinite(status)) {
        return `${operation} returned vendor status ${status}${typeof vendorCode === "string" ? ` (${vendorCode.slice(0, 64)})` : ""}`;
    }
    if (error instanceof Error) return `${operation} failed (${error.name})`;
    return `${operation} failed (${typeof record?.["name"] === "string" ? record["name"] : typeof error})`;
}
