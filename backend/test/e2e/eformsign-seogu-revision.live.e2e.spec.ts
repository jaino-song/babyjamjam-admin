import { randomUUID } from "node:crypto";

import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
    chromium,
    type Browser,
    type BrowserContext,
    type FrameLocator,
    type Page,
} from "playwright-core";

import { EformsignService } from "application/services/eformsign.service";
import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";
import {
    assertEformsignSdkSnapshotsEqual,
    hashPdfBody,
    type EformsignSdkDocumentSnapshot,
} from "./helpers/eformsign-sdk-capability.live.helper";
import {
    EFORMSIGN_SEOGU_REVISION_BASELINE_PDF_SHA256,
    EFORMSIGN_SEOGU_REVISION_DISPATCH_BRIDGE,
    EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID,
    EFORMSIGN_SEOGU_REVISION_IFRAME_ID,
    EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID,
    EFORMSIGN_SEOGU_REVISION_USER_EMAIL,
    assertSeoguRevisionBaselineFields,
    assertSeoguRevisionDocumentIdentity,
    assertSeoguRevisionHistoryPreserved,
    assertSeoguRevisionOnlyAllowedFieldChanges,
    assertSeoguRevisionParticipantDocument,
    assertSeoguRevisionPrefillOption,
    assertSeoguRevisionReviewerDocument,
    assertSeoguRevisionSdkHtml,
    assertSeoguRevisionSendAdvertised,
    assertSeoguRevisionTemplateTopology,
    buildSeoguRevisionPrefillOption,
    buildSeoguRevisionSdkHtml,
    createSecureSeoguRevisionArtifactDirectory,
    downloadSeoguRevisionPdfWithReadonlyRetry,
    fetchSeoguRevisionTemplateConfig,
    normalizeSeoguRevisionSdkProbeState,
    postSingleSeoguRevisionDecline,
    readSeoguRevisionModalInventory,
    safeSeoguRevisionErrorReason,
    writeSecureSeoguRevisionApiArtifact,
    writeSecureSeoguRevisionPdfArtifact,
    type SeoguRevisionModalInventory,
    type SeoguRevisionPdfArtifact,
    type SeoguRevisionSdkProbeState,
    type SeoguRevisionTemplateTopology,
} from "./helpers/eformsign-seogu-revision.live.helper";

const LIVE = process.env["LIVE_E2E"] === "1";
const SEOGU_DECLINE_CASE_NAME = "declines once to the inherited internal participant and preserves fields/PDF";
const SEOGU_SDK_CASE_NAME = "prefills four fields and sends current participant with fresh code 22";
const SEOGU_DECLINE_SUITE_TITLE = "eformsign official Seogu revision — one decline";
const SEOGU_SDK_SUITE_TITLE = "eformsign official Seogu revision — SDK participant send";
const SDK_FRAME_TIMEOUT_MS = 30_000;
const ACTION_CALLBACK_TIMEOUT_MS = 30_000;
const TERMINAL_CALLBACK_TIMEOUT_MS = 60_000;
const LIVE_TEST_TIMEOUT_MS = 180_000;

type SeoguRevisionLiveCase = "decline" | "sdk";

interface SeoguRevisionLiveSelection {
    selected: SeoguRevisionLiveCase | null;
    error: string | null;
}

/**
 * LIVE_E2E is intentionally insufficient by itself: each case mutates the
 * same signed document and case 2 requires an independent case 1 handoff.
 * Require one exact Jest testNamePattern before registering any live hooks.
 */
function readSeoguRevisionLiveSelection(argv: readonly string[]): SeoguRevisionLiveSelection {
    if (!LIVE) return { selected: null, error: null };

    const values: string[] = [];
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--testNamePattern" || argument === "-t") {
            values.push(argv[index + 1] ?? "");
            index += 1;
        } else if (argument?.startsWith("--testNamePattern=")) {
            values.push(argument.slice("--testNamePattern=".length));
        } else if (argument?.startsWith("-t=")) {
            values.push(argument.slice(3));
        }
    }

    if (values.length !== 1 || !values[0]?.trim()) {
        return {
            selected: null,
        error: "LIVE_E2E requires exactly one non-empty --testNamePattern: the full decline or SDK test title",
        };
    }

    const pattern = values[0].trim();
    const matches = [
        pattern === SEOGU_DECLINE_CASE_NAME || pattern === SEOGU_DECLINE_SUITE_TITLE ? "decline" : null,
        pattern === SEOGU_SDK_CASE_NAME || pattern === SEOGU_SDK_SUITE_TITLE ? "sdk" : null,
    ].filter((value): value is SeoguRevisionLiveCase => value !== null);
    if (matches.length !== 1) {
        return {
            selected: null,
            error: "LIVE_E2E testNamePattern must exactly select one Seogu case title; broad or combined patterns are refused",
        };
    }
    return { selected: matches[0]!, error: null };
}

const LIVE_SELECTION = readSeoguRevisionLiveSelection(process.argv);
if (LIVE_SELECTION.error) throw new Error(LIVE_SELECTION.error);

interface SeoguRevisionFixture {
    accessToken: string;
    refreshToken: string;
    documentOption?: Record<string, unknown>;
    beforeDocument: EformsignApiDocumentResponse;
    beforeSnapshot: EformsignSdkDocumentSnapshot;
    beforePdf: SeoguRevisionPdfArtifact;
    artifactDirectory: string;
    topology: SeoguRevisionTemplateTopology;
}

interface SeoguRevisionSdkRunResult {
    state: SeoguRevisionSdkProbeState;
    modalInventory: SeoguRevisionModalInventory;
    terminalCallbackObserved: boolean;
}

class SeoguRevisionSdkProbeError extends Error {
    constructor(
        message: string,
        readonly partialResult: SeoguRevisionSdkRunResult | undefined,
    ) {
        super(message);
        this.name = "SeoguRevisionSdkProbeError";
    }
}

async function readSeoguRevisionProbeState(page: Page): Promise<SeoguRevisionSdkProbeState> {
    const raw = await page.evaluate(() => {
        const state = (window as unknown as {
            __eformsignSdkSeoguRevisionProbe?: unknown;
        }).__eformsignSdkSeoguRevisionProbe;
        if (typeof state !== "object" || state === null) return {};
        const value = state as Record<string, unknown>;
        return {
            documentConfigured: value["documentConfigured"],
            openInvoked: value["openInvoked"],
            opened: value["opened"],
            bootError: value["bootError"],
            errorCallbackSeen: value["errorCallbackSeen"],
            actionCallbacks: Array.isArray(value["actionCallbacks"]) ? value["actionCallbacks"] : [],
            successCodes: Array.isArray(value["successCodes"]) ? value["successCodes"] : [],
            sendActionAttempted: value["sendActionAttempted"],
            sendActionCount: value["sendActionCount"],
            sendActionType: value["sendActionType"],
            sendActionCode: value["sendActionCode"],
            sendActionErrorCode: value["sendActionErrorCode"],
        };
    });
    return normalizeSeoguRevisionSdkProbeState(raw);
}

async function waitForSeoguRevisionSdkFrame(page: Page): Promise<void> {
    try {
        await page.waitForFunction(
            (iframeId) => {
                const probe = (window as unknown as {
                    __eformsignSdkSeoguRevisionProbe?: {
                        bootError?: boolean;
                        errorCallbackSeen?: boolean;
                        documentConfigured?: boolean;
                        openInvoked?: boolean;
                    };
                }).__eformsignSdkSeoguRevisionProbe;
                if (probe?.bootError || probe?.errorCallbackSeen) return true;
                const frame = document.getElementById(iframeId);
                return Boolean(
                    probe?.documentConfigured
                    && probe?.openInvoked
                    && frame instanceof HTMLIFrameElement
                    && frame.src.startsWith("https://www.eformsign.com/"),
                );
            },
            EFORMSIGN_SEOGU_REVISION_IFRAME_ID,
            { timeout: SDK_FRAME_TIMEOUT_MS },
        );
    } catch {
        throw new Error("Seogu SDK did not load the official document iframe");
    }
}

async function waitForFreshSeoguRevisionSendAction(page: Page): Promise<void> {
    try {
        await page.waitForFunction(
            () => {
                const probe = (window as unknown as {
                    __eformsignSdkSeoguRevisionProbe?: {
                        bootError?: boolean;
                        errorCallbackSeen?: boolean;
                        actionCallbacks?: Array<{ data?: Array<{ code?: unknown }> }>;
                    };
                }).__eformsignSdkSeoguRevisionProbe;
                return Boolean(
                    probe?.bootError
                    || probe?.errorCallbackSeen
                    || (Array.isArray(probe?.actionCallbacks)
                        && probe.actionCallbacks.some((callback) => Array.isArray(callback.data)
                            && callback.data.some((action) => String(action.code) === "22"))),
                );
            },
            undefined,
            { timeout: ACTION_CALLBACK_TIMEOUT_MS },
        );
    } catch {
        throw new Error("Seogu SDK did not produce a fresh actionCallback advertising code 22");
    }
}

async function waitForSeoguRevisionTerminalCallback(page: Page): Promise<boolean> {
    try {
        await page.waitForFunction(
            () => {
                const probe = (window as unknown as {
                    __eformsignSdkSeoguRevisionProbe?: {
                        bootError?: boolean;
                        errorCallbackSeen?: boolean;
                        successCodes?: unknown[];
                    };
                }).__eformsignSdkSeoguRevisionProbe;
                const successCodes = Array.isArray(probe?.successCodes) ? probe.successCodes : [];
                return Boolean(
                    probe?.bootError
                    || probe?.errorCallbackSeen
                    || successCodes.some((code) => String(code) === "-1"),
                );
            },
            undefined,
            { timeout: TERMINAL_CALLBACK_TIMEOUT_MS },
        );
        const state = await readSeoguRevisionProbeState(page);
        return state.successCodes.includes("-1");
    } catch {
        return false;
    }
}

async function dispatchSeoguRevisionParticipantSend(page: Page): Promise<void> {
    const result = await page.evaluate((bridgeName) => {
        const dispatch = (window as unknown as Record<string, unknown>)[bridgeName];
        if (typeof dispatch !== "function") return { available: false, called: false };
        return { available: true, called: Boolean((dispatch as () => unknown)()) };
    }, EFORMSIGN_SEOGU_REVISION_DISPATCH_BRIDGE);
    if (!result.available || !result.called) {
        throw new Error("Seogu SDK one-shot participant dispatch bridge was unavailable or rejected code 22");
    }
}

async function runSeoguRevisionSdkProbe(
    documentOption: Record<string, unknown>,
    beforeDispatch: () => Promise<void>,
): Promise<SeoguRevisionSdkRunResult> {
    const html = buildSeoguRevisionSdkHtml(documentOption, { iframeId: EFORMSIGN_SEOGU_REVISION_IFRAME_ID });
    assertSeoguRevisionSdkHtml(html);

    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    let latestState: SeoguRevisionSdkProbeState | undefined;
    let latestModalInventory: SeoguRevisionModalInventory | undefined;
    let terminalCallbackObserved = false;
    let dispatchStarted = false;
    try {
        browser = await chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        });
        context = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            userAgent:
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        });
        page = await context.newPage();
        const localUrl = `http://localhost:3000/__eformsign-headless/sdk-seogu-revision-${randomUUID()}`;
        await page.route(localUrl, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "text/html; charset=utf-8",
                body: html,
            });
        });
        await page.goto(localUrl, { waitUntil: "domcontentloaded" });
        await waitForSeoguRevisionSdkFrame(page);

        let state = await readSeoguRevisionProbeState(page);
        latestState = state;
        if (
            state.bootError
            || state.errorCallbackSeen
            || !state.documentConfigured
            || !state.openInvoked
            || !state.opened
        ) {
            throw new Error("Seogu SDK did not complete document registration/open without an error");
        }
        await waitForFreshSeoguRevisionSendAction(page);
        state = await readSeoguRevisionProbeState(page);
        latestState = state;
        if (state.bootError || state.errorCallbackSeen) {
            throw new Error("Seogu SDK reported an error while advertising actions");
        }
        assertSeoguRevisionSendAdvertised(state.actionCallbacks);

        // Code 999 may be an onload notification. It is observation-only and
        // never authorizes dispatch; the current API and template are re-read
        // immediately before the one explicit bridge call.
        await beforeDispatch();
        dispatchStarted = true;
        await dispatchSeoguRevisionParticipantSend(page);
        latestState = await readSeoguRevisionProbeState(page);
        await page.waitForTimeout(2_000);

        const eformsignFrame: FrameLocator = page.frameLocator(`#${EFORMSIGN_SEOGU_REVISION_IFRAME_ID}`);
        const readModalInventory = async (): Promise<SeoguRevisionModalInventory> => {
            try {
                return await readSeoguRevisionModalInventory(eformsignFrame);
            } catch {
                return {
                    visible: false,
                    selector: "unknown",
                    target: "not-observed",
                    visibleDialogCount: 0,
                    controls: [],
                    inspectionError: true,
                };
            }
        };
        let modalInventory = await readModalInventory();
        latestModalInventory = modalInventory;
        if (!modalInventory.visible && !modalInventory.inspectionError) {
            terminalCallbackObserved = await waitForSeoguRevisionTerminalCallback(page);
            const lateModalInventory = await readModalInventory();
            if (lateModalInventory.visible || lateModalInventory.inspectionError) modalInventory = lateModalInventory;
        }
        state = await readSeoguRevisionProbeState(page);
        latestState = state;
        latestModalInventory = modalInventory;
        return { state, modalInventory, terminalCallbackObserved };
    } catch (error) {
        if (page) {
            try {
                latestState = await readSeoguRevisionProbeState(page);
            } catch {
                // Keep the last sanitized state when the page is unavailable.
            }
        }
        if (
            dispatchStarted
            && latestState
            && latestState.sendActionAttempted === false
            && latestState.sendActionCount === 0
        ) {
            // The page may have disappeared after entering the bridge. Avoid
            // turning an unknown dispatch into a definite zero-action claim.
            latestState = {
                ...latestState,
                sendActionAttempted: null,
                sendActionCount: null,
                sendActionType: null,
                sendActionCode: null,
                sendActionErrorCode: null,
            };
        }
        const partialResult = latestState
            ? {
                state: latestState,
                modalInventory: latestModalInventory ?? {
                    visible: false,
                    selector: "unknown" as const,
                    target: "uncertain" as const,
                    visibleDialogCount: -1,
                    controls: ["unknown" as const],
                    inspectionError: true,
                },
                terminalCallbackObserved,
            }
            : undefined;
        const reason = error instanceof Error ? error.message.slice(0, 160) : "browser phase error";
        throw new SeoguRevisionSdkProbeError(reason, partialResult);
    } finally {
        await page?.close().catch(() => undefined);
        await context?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
    }
}

async function createTestModule(): Promise<{
    moduleRef: TestingModule;
    configService: ConfigService;
    eformsignClient: EformsignApiClient;
    eformsignService: EformsignService;
}> {
    const moduleRef = await Test.createTestingModule({
        imports: [ConfigModule.forRoot({ isGlobal: true })],
        providers: [EformsignApiClient, EformsignService],
    }).compile();
    return {
        moduleRef,
        configService: moduleRef.get(ConfigService),
        eformsignClient: moduleRef.get(EformsignApiClient),
        eformsignService: moduleRef.get(EformsignService),
    };
}

async function readBaselinePdf(
    eformsignService: EformsignService,
    accessToken: string,
    artifactDirectory: string,
): Promise<SeoguRevisionPdfArtifact> {
    const download = await downloadSeoguRevisionPdfWithReadonlyRetry(eformsignService, accessToken);
    const artifact = await writeSecureSeoguRevisionPdfArtifact(artifactDirectory, "before", download.body);
    if (artifact.sha256 !== EFORMSIGN_SEOGU_REVISION_BASELINE_PDF_SHA256) {
        throw new Error("Seogu baseline PDF hash is outside the exact allowlist");
    }
    return artifact;
}

async function assertOfficialConfig(configService: ConfigService): Promise<void> {
    if (process.env["E2E_VENDOR_STUBS"] === "1") {
        throw new Error("Seogu official tests require the real vendor API");
    }
    if (configService.get<string>("EFORMSIGN_USER_EMAIL")?.trim() !== EFORMSIGN_SEOGU_REVISION_USER_EMAIL) {
        throw new Error("configured eformsign user is outside the exact Seogu allowlist");
    }
}

// Case 1 is independently selectable with --testNamePattern and changes only
// the supplied reviewer document by one documented decline POST.
((LIVE && LIVE_SELECTION.selected === "decline") ? describe : describe.skip)(SEOGU_DECLINE_SUITE_TITLE, () => {
    jest.setTimeout(LIVE_TEST_TIMEOUT_MS);

    let moduleRef: TestingModule | undefined;
    let configService: ConfigService;
    let eformsignClient: EformsignApiClient;
    let eformsignService: EformsignService;
    let fixture: SeoguRevisionFixture;

    beforeAll(async () => {
        let phase = "module setup";
        try {
            const module = await createTestModule();
            moduleRef = module.moduleRef;
            configService = module.configService;
            eformsignClient = module.eformsignClient;
            eformsignService = module.eformsignService;
            await assertOfficialConfig(configService);

            phase = "access token";
            const token = await eformsignClient.getAccessToken(Date.now());
            const accessToken = token.oauth_token.access_token.trim();
            const refreshToken = token.oauth_token.refresh_token.trim();
            if (!accessToken || !refreshToken) throw new Error("Seogu test did not receive usable API tokens");

            phase = "template topology preflight";
            const template = await fetchSeoguRevisionTemplateConfig(configService, accessToken);
            const topology = assertSeoguRevisionTemplateTopology(template);

            phase = "reviewer document preflight";
            const beforeDocument = await eformsignClient.getDocument(accessToken, EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID);
            const beforeSnapshot = assertSeoguRevisionReviewerDocument(beforeDocument);
            assertSeoguRevisionBaselineFields(beforeDocument);

            phase = "baseline PDF";
            const artifactDirectory = await createSecureSeoguRevisionArtifactDirectory();
            const beforePdf = await readBaselinePdf(eformsignService, accessToken, artifactDirectory);
            await writeSecureSeoguRevisionApiArtifact(artifactDirectory, "before", beforeDocument);
            fixture = { accessToken, refreshToken, beforeDocument, beforeSnapshot, beforePdf, artifactDirectory, topology };
        } catch (error) {
            throw new Error(`${phase}: ${safeSeoguRevisionErrorReason(error, "Seogu decline preflight")}`);
        }
    });

    afterAll(async () => {
        await moduleRef?.close().catch(() => undefined);
    });

    it(SEOGU_DECLINE_CASE_NAME, async () => {
        let declineEvidence: Awaited<ReturnType<typeof postSingleSeoguRevisionDecline>> | undefined;
        let apiPostflightError: unknown;
        let pdfPostflightError: unknown;
        let afterDocument: EformsignApiDocumentResponse | undefined;
        let afterPdf: SeoguRevisionPdfArtifact | undefined;

        // Repeat the authoritative API/template/PDF preflight immediately
        // before the sole mutation. The beforeAll snapshot remains useful
        // evidence, while this refresh prevents a stale reviewer stage from
        // authorizing the decline.
        try {
            const freshTemplate = await fetchSeoguRevisionTemplateConfig(
                configService,
                fixture.accessToken,
                EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID,
            );
            const freshTopology = assertSeoguRevisionTemplateTopology(freshTemplate);
            const freshDocument = await eformsignClient.getDocument(
                fixture.accessToken,
                EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID,
            );
            const freshSnapshot = assertSeoguRevisionReviewerDocument(freshDocument);
            assertSeoguRevisionBaselineFields(freshDocument);
            const freshPdf = await downloadSeoguRevisionPdfWithReadonlyRetry(
                eformsignService,
                fixture.accessToken,
            );
            if (hashPdfBody(freshPdf.body) !== fixture.beforePdf.sha256) {
                throw new Error("Seogu decline preflight PDF changed before mutation");
            }
            fixture = {
                ...fixture,
                beforeDocument: freshDocument,
                beforeSnapshot: freshSnapshot,
                topology: freshTopology,
            };
        } catch (error) {
            throw new Error(safeSeoguRevisionErrorReason(error, "Seogu decline immediate preflight"));
        }

        try {
            declineEvidence = await postSingleSeoguRevisionDecline(
                configService,
                fixture.accessToken,
                EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID,
            );
            if (!declineEvidence.httpSuccess) throw new Error("Seogu decline response was not successful");
            if (declineEvidence.responseIdPresent && declineEvidence.responseIdMatches !== true) {
                throw new Error("Seogu decline response document id did not match");
            }
        } catch (error) {
            apiPostflightError = error;
        }

        try {
            afterDocument = await eformsignClient.getDocument(fixture.accessToken, EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID);
            assertSeoguRevisionDocumentIdentity(afterDocument);
            // Retain sanitized API evidence before asserting the expected
            // participant stage or field/history invariants.
            await writeSecureSeoguRevisionApiArtifact(fixture.artifactDirectory, "after", afterDocument);
            const afterSnapshot = assertSeoguRevisionParticipantDocument(afterDocument);
            assertSeoguRevisionBaselineFields(afterDocument);
            if (
                fixture.beforeSnapshot.fieldHash !== afterSnapshot.fieldHash
                || fixture.beforeSnapshot.fieldCount !== afterSnapshot.fieldCount
            ) {
                throw new Error("Seogu decline changed document fields");
            }
            assertSeoguRevisionHistoryPreserved(fixture.beforeDocument, afterDocument);
        } catch (error) {
            apiPostflightError = apiPostflightError ?? error;
        }

        try {
            const download = await downloadSeoguRevisionPdfWithReadonlyRetry(eformsignService, fixture.accessToken);
            afterPdf = await writeSecureSeoguRevisionPdfArtifact(fixture.artifactDirectory, "after", download.body);
            if (afterPdf.sha256 !== fixture.beforePdf.sha256) {
                throw new Error("Seogu decline changed the baseline PDF");
            }
        } catch (error) {
            pdfPostflightError = error;
        }

        console.info("[eformsign-seogu-decline] " + JSON.stringify({
            test: "declines once to the inherited internal participant",
            declineAttempted: declineEvidence?.attempted ?? null,
            declineResponseReceived: declineEvidence?.responseReceived ?? null,
            declineHttpStatus: declineEvidence?.status ?? null,
            declineHttpSuccess: declineEvidence?.httpSuccess ?? null,
            declineTransportError: declineEvidence?.transportError ?? null,
            declineResponseBodyJson: declineEvidence?.responseBodyJson ?? null,
            declineResponseIdPresent: declineEvidence?.responseIdPresent ?? null,
            declineResponseIdMatches: declineEvidence?.responseIdMatches ?? null,
            templateStepCount: fixture.topology.stepCount,
            templateVersion: fixture.topology.version,
            beforePdf: fixture.beforePdf,
            afterPdf: afterPdf ?? null,
            apiPostflight: apiPostflightError ? "failed" : "observed",
            pdfPostflight: pdfPostflightError ? "failed" : "observed",
        }));

        if (apiPostflightError) throw new Error(safeSeoguRevisionErrorReason(apiPostflightError, "Seogu decline postflight"));
        if (pdfPostflightError) throw new Error(safeSeoguRevisionErrorReason(pdfPostflightError, "Seogu decline PDF postflight"));
    });
});

// Case 2 must be selected only after main independently verifies the 071/05/3
// baseline produced by case 1 and gives an explicit go. It performs one SDK
// participant send; it never retries that mutation or enters writer mode.
((LIVE && LIVE_SELECTION.selected === "sdk") ? describe : describe.skip)(SEOGU_SDK_SUITE_TITLE, () => {
    jest.setTimeout(LIVE_TEST_TIMEOUT_MS);

    let moduleRef: TestingModule | undefined;
    let configService: ConfigService;
    let eformsignClient: EformsignApiClient;
    let eformsignService: EformsignService;
    let fixture: SeoguRevisionFixture;

    beforeAll(async () => {
        let phase = "module setup";
        try {
            const module = await createTestModule();
            moduleRef = module.moduleRef;
            configService = module.configService;
            eformsignClient = module.eformsignClient;
            eformsignService = module.eformsignService;
            await assertOfficialConfig(configService);

            phase = "access token";
            const token = await eformsignClient.getAccessToken(Date.now());
            const accessToken = token.oauth_token.access_token.trim();
            const refreshToken = token.oauth_token.refresh_token.trim();
            if (!accessToken || !refreshToken) throw new Error("Seogu SDK test did not receive usable API tokens");

            phase = "template topology preflight";
            const template = await fetchSeoguRevisionTemplateConfig(configService, accessToken);
            const topology = assertSeoguRevisionTemplateTopology(template);

            phase = "participant document preflight";
            const beforeDocument = await eformsignClient.getDocument(accessToken, EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID);
            const beforeSnapshot = assertSeoguRevisionParticipantDocument(beforeDocument);
            assertSeoguRevisionBaselineFields(beforeDocument);

            phase = "baseline PDF";
            const artifactDirectory = await createSecureSeoguRevisionArtifactDirectory();
            const beforePdf = await readBaselinePdf(eformsignService, accessToken, artifactDirectory);
            await writeSecureSeoguRevisionApiArtifact(artifactDirectory, "before", beforeDocument);

            phase = "mode02 participant option";
            const baseOption = await eformsignService.generateStaffCompletionOptions(
                EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID,
                accessToken,
                refreshToken,
            ) as Record<string, unknown>;
            const documentOption = buildSeoguRevisionPrefillOption(baseOption);
            assertSeoguRevisionPrefillOption(documentOption);

            fixture = {
                accessToken,
                refreshToken,
                documentOption,
                beforeDocument,
                beforeSnapshot,
                beforePdf,
                artifactDirectory,
                topology,
            };
        } catch (error) {
            throw new Error(`${phase}: ${safeSeoguRevisionErrorReason(error, "Seogu SDK preflight")}`);
        }
    });

    afterAll(async () => {
        await moduleRef?.close().catch(() => undefined);
    });

    it(SEOGU_SDK_CASE_NAME, async () => {
        if (!fixture.documentOption) throw new Error("Seogu SDK document option was not prepared");
        let browserPhaseError: unknown;
        let runResult: SeoguRevisionSdkRunResult | undefined;
        try {
            runResult = await runSeoguRevisionSdkProbe(fixture.documentOption, async () => {
                const current = await eformsignClient.getDocument(fixture.accessToken, EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID);
                const currentSnapshot = assertSeoguRevisionParticipantDocument(current);
                assertSeoguRevisionBaselineFields(current);
                assertEformsignSdkSnapshotsEqual(fixture.beforeSnapshot, currentSnapshot);
                const currentTemplate = await fetchSeoguRevisionTemplateConfig(
                    configService,
                    fixture.accessToken,
                    EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID,
                );
                assertSeoguRevisionTemplateTopology(currentTemplate);
            });
        } catch (error) {
            if (error instanceof SeoguRevisionSdkProbeError) runResult = error.partialResult;
            browserPhaseError = error;
        }

        const state = runResult?.state;
        const modalInventory = runResult?.modalInventory;
        const dispatchObserved = Boolean(
            state?.sendActionAttempted
            && state.sendActionCount === 1
            && state.sendActionType === "01"
            && state.sendActionCode === "22"
            && !state.sendActionErrorCode,
        );
        const modalUncertain = Boolean(modalInventory?.visible || modalInventory?.inspectionError);
        const expectPostSend = dispatchObserved && !modalUncertain;
        let apiPostflightError: unknown;
        let pdfPostflightError: unknown;
        let afterDocument: EformsignApiDocumentResponse | undefined;
        let afterPdf: SeoguRevisionPdfArtifact | undefined;

        // API and PDF are collected independently even when the SDK phase is
        // RED or uncertain. There is deliberately no mutation retry here.
        try {
            afterDocument = await eformsignClient.getDocument(fixture.accessToken, EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID);
            assertSeoguRevisionDocumentIdentity(afterDocument);
            // Retain sanitized API evidence before asserting the expected
            // reviewer/participant stage or field/history invariants.
            await writeSecureSeoguRevisionApiArtifact(fixture.artifactDirectory, "after", afterDocument);
            if (expectPostSend) {
                assertSeoguRevisionReviewerDocument(afterDocument);
                assertSeoguRevisionOnlyAllowedFieldChanges(fixture.beforeDocument, afterDocument);
                assertSeoguRevisionHistoryPreserved(fixture.beforeDocument, afterDocument);
            } else {
                const afterSnapshot = assertSeoguRevisionParticipantDocument(afterDocument);
                assertSeoguRevisionBaselineFields(afterDocument);
                assertEformsignSdkSnapshotsEqual(fixture.beforeSnapshot, afterSnapshot);
                assertSeoguRevisionHistoryPreserved(fixture.beforeDocument, afterDocument);
            }
        } catch (error) {
            apiPostflightError = error;
        }

        try {
            const download = await downloadSeoguRevisionPdfWithReadonlyRetry(eformsignService, fixture.accessToken);
            afterPdf = await writeSecureSeoguRevisionPdfArtifact(fixture.artifactDirectory, "after", download.body);
            if (expectPostSend) {
                if (afterPdf.sha256 === fixture.beforePdf.sha256) {
                    throw new Error("Seogu SDK participant send did not produce a new PDF output");
                }
            } else if (afterPdf.sha256 !== fixture.beforePdf.sha256) {
                throw new Error("Seogu SDK uncertain/failed phase changed the baseline PDF");
            }
        } catch (error) {
            pdfPostflightError = error;
        }

        console.info("[eformsign-seogu-sdk-revision] " + JSON.stringify({
            test: "prefills four fields and sends current participant with fresh code 22",
            browserPhase: browserPhaseError ? "failed" : "observed",
            postflightApi: apiPostflightError ? "failed" : "observed",
            postflightPdf: pdfPostflightError ? "failed" : "observed",
            actionCodes: state?.actionCallbacks.flatMap((callback) => callback.data.map((action) => action.code)).slice(0, 20) ?? [],
            successCodes: state?.successCodes ?? [],
            terminalCallbackObserved: runResult?.terminalCallbackObserved ?? null,
            sendActionAttempted: state?.sendActionAttempted ?? null,
            sendActionCount: state?.sendActionCount ?? null,
            sendActionType: state?.sendActionType ?? null,
            sendActionCode: state?.sendActionCode ?? null,
            sendActionErrorCode: state?.sendActionErrorCode ?? null,
            modal: modalInventory
                ? {
                    visible: modalInventory.visible,
                    selector: modalInventory.selector,
                    target: modalInventory.target,
                    visibleDialogCount: modalInventory.visibleDialogCount,
                    controls: modalInventory.controls,
                    inspectionError: modalInventory.inspectionError,
                }
                : null,
            beforePdf: fixture.beforePdf,
            afterPdf: afterPdf ?? null,
            expectedPostSend: expectPostSend,
        }));

        if (apiPostflightError) throw new Error(safeSeoguRevisionErrorReason(apiPostflightError, "Seogu SDK independent API postflight"));
        if (pdfPostflightError) throw new Error(safeSeoguRevisionErrorReason(pdfPostflightError, "Seogu SDK independent PDF postflight"));
        if (browserPhaseError) throw new Error(safeSeoguRevisionErrorReason(browserPhaseError, "Seogu SDK browser phase"));
        if (!runResult) throw new Error("Seogu SDK browser phase returned no result");
        assertSeoguRevisionSendAdvertised(runResult.state.actionCallbacks);
        if (!dispatchObserved) throw new Error("Seogu SDK did not dispatch exactly one participant action code 22");
        if (modalUncertain) throw new Error("Seogu SDK modal inspection was uncertain; no modal control was clicked");
    });
});
