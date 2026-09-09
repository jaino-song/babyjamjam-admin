import { createHash } from "node:crypto";

import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";

export const EFORMSIGN_SDK_CAPABILITY_DOCUMENT_ID = "27e3c3287859433dbd8a680525c5338d";
export const EFORMSIGN_SDK_CAPABILITY_TEMPLATE_ID = "27f092d3bdba4777835187facd7468a6";
export const EFORMSIGN_SDK_CAPABILITY_STATUS_TYPE = "070";
export const EFORMSIGN_SDK_CAPABILITY_STEP_TYPE = "06";
export const EFORMSIGN_SDK_CAPABILITY_STEP_INDEX = "4";
export const EFORMSIGN_SDK_CAPABILITY_RECIPIENT_ID = "142f6049d9af43e19b32ddf4c5139120";
export const EFORMSIGN_SDK_CAPABILITY_RECIPIENT_TYPE = "insider";
export const EFORMSIGN_SDK_CAPABILITY_USER_EMAIL = "forchildrenbysongs@gmail.com";
export const EFORMSIGN_SDK_CAPABILITY_PDF_SHA256 =
    "d1eadbae10ca458751044f8c7829d4118d09b14f1900eb2d182e7493682f6509";
export const EFORMSIGN_SDK_CAPABILITY_IFRAME_ID = "eformsign_sdk_capability_iframe";
export const EFORMSIGN_SDK_NON_OPERATIONAL_ACTION_CODES = ["99", "999"] as const;

const EFORMSIGN_JQUERY_URL = "https://www.eformsign.com/plugins/jquery/jquery.min.js";
const EFORMSIGN_SDK_URL = "https://www.eformsign.com/lib/js/efs_embedded_v2.js";
const MAX_ACTION_LABEL_LENGTH = 160;
const MAX_ACTION_CODE_LENGTH = 64;
const MAX_ACTIONS_PER_CALLBACK = 20;
const FORBIDDEN_ACTION_NAMES = [
    "sendAction",
    "execAction",
    "save",
    "send",
    "finalize",
    "approve",
    "decline",
    "click",
] as const;

export interface SanitizedEformsignAction {
    name: string;
    code: string;
}

export interface SanitizedEformsignActionCallback {
    type: string;
    fn: "actionCallback";
    data: SanitizedEformsignAction[];
}

export interface EformsignSdkDocumentSnapshot {
    fieldHash: string;
    stageHash: string;
    fieldCount: number;
    recipientCount: number;
}

export interface ProbeDocumentExpectation {
    documentId: string;
    templateId: string;
    statusType: string;
    stepType: string;
    stepIndex: string;
    recipientId: string;
    recipientType: string;
    expiredDate: number;
    expired: boolean;
}

export interface ReadonlySdkProbeState {
    documentConfigured: boolean;
    openInvoked: boolean;
    opened: boolean;
    bootError: boolean;
    errorCallbackSeen: boolean;
    actionCallbacks: SanitizedEformsignActionCallback[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null
        ? value as Record<string, unknown>
        : null;
}

function boundedString(value: unknown, maxLength: number): string {
    if (typeof value === "string") {
        return value.trim().slice(0, maxLength);
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value).slice(0, maxLength);
    }
    return "";
}

/**
 * Keep only the vendor's advertised action label/code pair. The raw callback
 * is intentionally never retained because it may carry document or token data.
 */
export function sanitizeActionCallback(value: unknown): SanitizedEformsignActionCallback | null {
    const callback = asRecord(value);
    if (callback?.["fn"] !== "actionCallback") return null;

    const data = Array.isArray(callback["data"]) ? callback["data"] : [];
    const actions: SanitizedEformsignAction[] = [];
    for (const item of data) {
        const record = asRecord(item);
        if (!record) continue;
        const name = boundedString(record["name"], MAX_ACTION_LABEL_LENGTH);
        const code = boundedString(record["code"], MAX_ACTION_CODE_LENGTH);
        if (!name && !code) continue;
        actions.push({ name, code });
        if (actions.length >= MAX_ACTIONS_PER_CALLBACK) break;
    }

    return {
        type: boundedString(callback["type"], 32),
        fn: "actionCallback",
        data: actions,
    };
}

export function getAdvertisedOperationalActions(
    callbacks: readonly SanitizedEformsignActionCallback[],
): SanitizedEformsignAction[] {
    const nonOperationalCodes = new Set<string>(EFORMSIGN_SDK_NON_OPERATIONAL_ACTION_CODES);
    return callbacks
        .flatMap((callback) => callback.data)
        .filter((action) => action.code !== "" && !nonOperationalCodes.has(action.code));
}

function serializeOption(value: Record<string, unknown>): string {
    return JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

/**
 * Mirrors the supported embedded SDK architecture while keeping this probe
 * read-only: document registration, callbacks, then sdk.open().
 */
export function buildReadonlySdkHtml(
    documentOption: Record<string, unknown>,
    iframeId = EFORMSIGN_SDK_CAPABILITY_IFRAME_ID,
): string {
    const optionJson = serializeOption(documentOption);
    const iframeIdJson = JSON.stringify(iframeId);
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>eformsign capability probe</title></head>
<body style="margin:0">
<iframe id=${iframeIdJson} style="width:100vw;height:100vh;border:0"></iframe>
<script>
(function () {
    var option = ${optionJson};
    var iframeId = ${iframeIdJson};
    window.__eformsignSdkProbe = {
        documentConfigured: false,
        openInvoked: false,
        opened: false,
        bootError: false,
        errorCallbackSeen: false,
        actionCallbacks: []
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
        return {
            type: boundedString(response.type, 32),
            fn: "actionCallback",
            data: actions
        };
    }
    function fail() {
        window.__eformsignSdkProbe.bootError = true;
    }
    function loadScript(src, done) {
        var script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.onload = done;
        script.onerror = fail;
        document.head.appendChild(script);
    }
    function successCallback() {
        // The probe deliberately ignores success payloads; it only observes advertised actions.
    }
    function errorCallback() {
        window.__eformsignSdkProbe.errorCallbackSeen = true;
    }
    function actionCallback(response) {
        var sanitized = sanitizeActionCallback(response);
        if (sanitized) window.__eformsignSdkProbe.actionCallbacks.push(sanitized);
    }
    function open() {
        if (typeof window.EformSignDocument !== "function") return fail();
        try {
            var sdk = new window.EformSignDocument();
            sdk.document(option, iframeId, successCallback, errorCallback, actionCallback);
            window.__eformsignSdkProbe.documentConfigured = true;
            window.__eformsignSdkProbe.openInvoked = true;
            sdk.open();
            window.__eformsignSdkProbe.opened = true;
        } catch (error) {
            window.__eformsignSdkProbe.bootError = true;
        }
    }
    loadScript(${JSON.stringify(EFORMSIGN_JQUERY_URL)}, function () {
        loadScript(${JSON.stringify(EFORMSIGN_SDK_URL)}, open);
    });
})();
</script></body></html>`;
}

/**
 * Test guard for the probe page itself. It prevents a future edit from adding
 * a production gate/action call to this read-only capability path.
 */
export function assertReadonlySdkHtml(html: string, iframeId = EFORMSIGN_SDK_CAPABILITY_IFRAME_ID): void {
    const documentCalls = html.match(/sdk\.document\s*\(/g) ?? [];
    const openCalls = html.match(/sdk\.open\s*\(/g) ?? [];
    if (documentCalls.length !== 1 || openCalls.length !== 1) {
        throw new Error("read-only SDK probe must register one document and one open call");
    }
    if (!html.includes(`id=${JSON.stringify(iframeId)}`)) {
        throw new Error("read-only SDK probe iframe id is not stable");
    }
    for (const actionName of FORBIDDEN_ACTION_NAMES) {
        const actionCall = new RegExp(`(?:\\.|\\b)${actionName}\\s*\\(`);
        if (actionCall.test(html)) {
            throw new Error("read-only SDK probe contains a forbidden action call");
        }
    }
}

function stableJson(value: unknown): string {
    return JSON.stringify(value) ?? "";
}

function sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedFields(document: EformsignApiDocumentResponse): Array<{ id: string; value: string; type: string }> {
    return (document.fields ?? [])
        .map((field) => ({
            id: String(field.id ?? ""),
            value: String(field.value ?? ""),
            type: String(field.type ?? ""),
        }))
        .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

function normalizedStage(document: EformsignApiDocumentResponse): Record<string, unknown> {
    const status = document.current_status;
    return {
        statusType: String(status?.status_type ?? ""),
        statusDocType: String(status?.status_doc_type ?? ""),
        statusDocDetail: String(status?.status_doc_detail ?? ""),
        stepType: String(status?.step_type ?? ""),
        stepIndex: String(status?.step_index ?? ""),
        stepName: String(status?.step_name ?? ""),
        stepGroup: status?.step_group ?? null,
        expiredDate: status?.expired_date ?? null,
        expired: status?._expired ?? null,
        recipients: (status?.step_recipients ?? [])
            .map((recipient) => ({
                recipientType: String(recipient.recipient_type ?? ""),
                id: String(recipient.id ?? ""),
                name: String(recipient.name ?? ""),
                sms: String(recipient.sms ?? ""),
            }))
            .sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
    };
}

export function readEformsignSdkDocumentSnapshot(
    document: EformsignApiDocumentResponse,
): EformsignSdkDocumentSnapshot {
    const fields = normalizedFields(document);
    const stage = normalizedStage(document);
    return {
        fieldHash: sha256(stableJson(fields)),
        stageHash: sha256(stableJson(stage)),
        fieldCount: fields.length,
        recipientCount: Array.isArray(stage["recipients"]) ? stage["recipients"].length : 0,
    };
}

export function assertEformsignSdkDocumentIdentity(
    document: EformsignApiDocumentResponse,
    expectation: ProbeDocumentExpectation = {
        documentId: EFORMSIGN_SDK_CAPABILITY_DOCUMENT_ID,
        templateId: EFORMSIGN_SDK_CAPABILITY_TEMPLATE_ID,
        statusType: EFORMSIGN_SDK_CAPABILITY_STATUS_TYPE,
        stepType: EFORMSIGN_SDK_CAPABILITY_STEP_TYPE,
        stepIndex: EFORMSIGN_SDK_CAPABILITY_STEP_INDEX,
        recipientId: EFORMSIGN_SDK_CAPABILITY_RECIPIENT_ID,
        recipientType: EFORMSIGN_SDK_CAPABILITY_RECIPIENT_TYPE,
        expiredDate: 0,
        expired: false,
    },
): EformsignSdkDocumentSnapshot {
    if (document.id !== expectation.documentId) {
        throw new Error("eformsign SDK probe document id is outside the exact allowlist");
    }
    if (document.template?.id !== expectation.templateId) {
        throw new Error("eformsign SDK probe template id does not match the exact allowlist");
    }
    const status = document.current_status;
    if (
        status?.status_type !== expectation.statusType
        || status.step_type !== expectation.stepType
        || status.step_index !== expectation.stepIndex
    ) {
        throw new Error("eformsign SDK probe document is not at the reviewed provider stage");
    }
    const recipients = status.step_recipients ?? [];
    if (
        recipients.length !== 1
        || recipients[0]?.id !== expectation.recipientId
        || recipients[0]?.recipient_type !== expectation.recipientType
        || status.expired_date !== expectation.expiredDate
        || status._expired !== expectation.expired
    ) {
        throw new Error("eformsign SDK probe reviewer recipient does not match the exact allowlist");
    }
    return readEformsignSdkDocumentSnapshot(document);
}

export function assertEformsignSdkSnapshotsEqual(
    before: EformsignSdkDocumentSnapshot,
    after: EformsignSdkDocumentSnapshot,
): void {
    if (
        before.fieldHash !== after.fieldHash
        || before.stageHash !== after.stageHash
        || before.fieldCount !== after.fieldCount
        || before.recipientCount !== after.recipientCount
    ) {
        throw new Error("eformsign SDK probe changed document fields or workflow stage");
    }
}

export function assertReadonlyMode02Option(
    value: unknown,
    documentId = EFORMSIGN_SDK_CAPABILITY_DOCUMENT_ID,
    templateId = EFORMSIGN_SDK_CAPABILITY_TEMPLATE_ID,
    userEmail = EFORMSIGN_SDK_CAPABILITY_USER_EMAIL,
): void {
    const option = asRecord(value);
    const mode = asRecord(option?.["mode"]);
    const user = asRecord(option?.["user"]);
    if (
        mode?.["type"] !== "02"
        || mode["document_id"] !== documentId
        || mode["template_id"] !== templateId
    ) {
        throw new Error("eformsign SDK probe mode02 option does not match the exact document");
    }
    if (user?.["type"] !== "01" || user["id"] !== userEmail) {
        throw new Error("eformsign SDK probe user identity does not match the exact allowlist");
    }
    if (Object.prototype.hasOwnProperty.call(option, "prefill")) {
        throw new Error("eformsign SDK probe must not prefill or mutate the reviewed document");
    }
}

export function hashPdfBody(body: Buffer): string {
    return createHash("sha256").update(body).digest("hex");
}

export function assertPdfDownload(
    download: { status: number; contentType: string; body: Buffer },
): void {
    if (
        download.status !== 200
        || !download.contentType.toLowerCase().includes("application/pdf")
        || !Buffer.isBuffer(download.body)
        || download.body.length < 5
        || download.body.subarray(0, 5).toString("ascii") !== "%PDF-"
    ) {
        throw new Error("eformsign SDK probe did not receive a successful PDF download");
    }
}
