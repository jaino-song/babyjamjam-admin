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

import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { EformsignService } from "application/services/eformsign.service";
import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";
import {
    assertEformsignSdkSnapshotsEqual,
    type EformsignSdkDocumentSnapshot,
} from "./helpers/eformsign-sdk-capability.live.helper";
import {
    assertWorkflowUpdateTemplateTopology,
    fetchWorkflowUpdateTemplateConfig,
} from "./helpers/eformsign-workflow-update.live.helper";
import {
    EFORMSIGN_SDK_DATE_UPDATE_BASELINE_PDF_SHA256,
    EFORMSIGN_SDK_DATE_UPDATE_DISPATCH_BRIDGE,
    EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID,
    EFORMSIGN_SDK_DATE_UPDATE_IFRAME_ID,
    EFORMSIGN_SDK_DATE_UPDATE_PDF_SHA256,
    EFORMSIGN_SDK_DATE_UPDATE_USER_EMAIL,
    assertCurrentParticipantSendAdvertised,
    assertDateUpdateAfterSendIdentity,
    assertDateUpdateBaselineFields,
    assertDateUpdateBeforeOpenIdentity,
    assertDateUpdateOnlyAllowedFieldChanges,
    assertDateUpdatePrefillOption,
    assertDateUpdateSdkHtml,
    buildDateUpdatePrefillOption,
    buildDateUpdateSdkHtml,
    createSecureDateUpdateArtifactDirectory,
    downloadDateUpdatePdf,
    normalizeDateUpdateSdkProbeState,
    readDateUpdateModalInventory,
    safeDateUpdateErrorReason,
    writeSecureDateUpdatePdfArtifact,
    type DateUpdateModalInventory,
    type DateUpdateSdkProbeState,
    type SecurePdfArtifact,
} from "./helpers/eformsign-sdk-date-update.live.helper";

const LIVE = process.env["LIVE_E2E"] === "1";
const SDK_FRAME_TIMEOUT_MS = 30_000;
const ACTION_CALLBACK_TIMEOUT_MS = 30_000;
const TERMINAL_CALLBACK_TIMEOUT_MS = 60_000;
const LIVE_TEST_TIMEOUT_MS = 180_000;

/**
 * Run only by selecting this exact test title with LIVE_E2E=1 after the
 * independent participant-stage and template-topology audit. The default
 * suite is skipped and no SDK page is opened.
 */
const TEST_TITLE = "prefills four fields and sends current participant with fresh code 22";

interface DateUpdateFixture {
    accessToken: string;
    documentOption: Record<string, unknown>;
    beforeDocument: EformsignApiDocumentResponse;
    beforeSnapshot: EformsignSdkDocumentSnapshot;
    beforePdf: SecurePdfArtifact;
    artifactDirectory: string;
}

interface DateUpdateSdkRunResult {
    state: DateUpdateSdkProbeState;
    modalInventory: DateUpdateModalInventory;
    terminalCallbackObserved: boolean;
}

class DateUpdateSdkProbeError extends Error {
    constructor(
        message: string,
        readonly partialResult: DateUpdateSdkRunResult | undefined,
    ) {
        super(message);
        this.name = "DateUpdateSdkProbeError";
    }
}

async function readDateUpdateProbeState(page: Page): Promise<DateUpdateSdkProbeState> {
    const raw = await page.evaluate(() => {
        const state = (window as unknown as {
            __eformsignSdkDateUpdateProbe?: unknown;
        }).__eformsignSdkDateUpdateProbe;
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
    return normalizeDateUpdateSdkProbeState(raw);
}

async function waitForDateUpdateSdkFrame(page: Page): Promise<void> {
    try {
        await page.waitForFunction(
            (iframeId) => {
                const probe = (window as unknown as {
                    __eformsignSdkDateUpdateProbe?: {
                        bootError?: boolean;
                        errorCallbackSeen?: boolean;
                        documentConfigured?: boolean;
                        openInvoked?: boolean;
                    };
                }).__eformsignSdkDateUpdateProbe;
                if (probe?.bootError || probe?.errorCallbackSeen) return true;
                const frame = document.getElementById(iframeId);
                return Boolean(
                    probe?.documentConfigured
                    && probe?.openInvoked
                    && frame instanceof HTMLIFrameElement
                    && frame.src.startsWith("https://www.eformsign.com/"),
                );
            },
            EFORMSIGN_SDK_DATE_UPDATE_IFRAME_ID,
            { timeout: SDK_FRAME_TIMEOUT_MS },
        );
    } catch {
        throw new Error("date-update SDK did not load the official document iframe");
    }
}

async function waitForFreshParticipantSendAction(page: Page): Promise<void> {
    try {
        await page.waitForFunction(
            () => {
                const probe = (window as unknown as {
                    __eformsignSdkDateUpdateProbe?: {
                        bootError?: boolean;
                        errorCallbackSeen?: boolean;
                        actionCallbacks?: Array<{ data?: Array<{ code?: unknown }> }>;
                    };
                }).__eformsignSdkDateUpdateProbe;
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
        throw new Error("date-update SDK did not produce a fresh actionCallback advertising code 22");
    }
}

async function waitForTerminalCallback(page: Page): Promise<boolean> {
    try {
        await page.waitForFunction(
            () => {
                const probe = (window as unknown as {
                    __eformsignSdkDateUpdateProbe?: {
                        bootError?: boolean;
                        errorCallbackSeen?: boolean;
                        successCodes?: unknown[];
                    };
                }).__eformsignSdkDateUpdateProbe;
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
        const state = await readDateUpdateProbeState(page);
        return state.successCodes.includes("-1");
    } catch {
        return false;
    }
}

async function dispatchCurrentParticipantSend(page: Page): Promise<void> {
    const result = await page.evaluate((bridgeName) => {
        const dispatch = (window as unknown as Record<string, unknown>)[bridgeName];
        if (typeof dispatch !== "function") return { available: false, called: false };
        return { available: true, called: Boolean((dispatch as () => unknown)()) };
    }, EFORMSIGN_SDK_DATE_UPDATE_DISPATCH_BRIDGE);
    if (!result.available || !result.called) {
        throw new Error("date-update SDK one-shot participant dispatch bridge was unavailable or rejected code 22");
    }
}

async function runDateUpdateSdkProbe(
    documentOption: Record<string, unknown>,
    beforeDispatch: () => Promise<void>,
): Promise<DateUpdateSdkRunResult> {
    const html = buildDateUpdateSdkHtml(documentOption, { iframeId: EFORMSIGN_SDK_DATE_UPDATE_IFRAME_ID });
    assertDateUpdateSdkHtml(html);

    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    let latestState: DateUpdateSdkProbeState | undefined;
    let latestModalInventory: DateUpdateModalInventory | undefined;
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
        const localUrl = `http://localhost:3000/__eformsign-headless/sdk-date-update-${randomUUID()}`;
        await page.route(localUrl, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "text/html; charset=utf-8",
                body: html,
            });
        });
        await page.goto(localUrl, { waitUntil: "domcontentloaded" });
        await waitForDateUpdateSdkFrame(page);

        let state = await readDateUpdateProbeState(page);
        latestState = state;
        if (state.bootError || state.errorCallbackSeen
            || !state.documentConfigured || !state.openInvoked || !state.opened) {
            throw new Error("date-update SDK did not complete document registration/open without an error");
        }
        await waitForFreshParticipantSendAction(page);
        state = await readDateUpdateProbeState(page);
        latestState = state;
        if (state.bootError || state.errorCallbackSeen) {
            throw new Error("date-update SDK reported an error while advertising actions");
        }
        assertCurrentParticipantSendAdvertised(state.actionCallbacks);

        // The callback is observation-only. Re-read the API stage and template
        // topology in Node immediately before invoking the explicit bridge.
        await beforeDispatch();
        dispatchStarted = true;
        await dispatchCurrentParticipantSend(page);
        latestState = await readDateUpdateProbeState(page);
        await page.waitForTimeout(2_000);

        const eformsignFrame: FrameLocator = page.frameLocator(`#${EFORMSIGN_SDK_DATE_UPDATE_IFRAME_ID}`);
        const readModalInventory = async (): Promise<DateUpdateModalInventory> => {
            try {
                return await readDateUpdateModalInventory(eformsignFrame);
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
        // A visible modal is intentionally returned as uncertain. This stage
        // never clicks a generic send control; recipient UI audit is separate.
        terminalCallbackObserved = false;
        if (!modalInventory.visible && !modalInventory.inspectionError) {
            terminalCallbackObserved = await waitForTerminalCallback(page);
            // A request modal can be rendered after the initial short wait. A
            // second inventory keeps the stop rule fail-closed without a UI click.
            const lateModalInventory = await readModalInventory();
            if (lateModalInventory.visible || lateModalInventory.inspectionError) modalInventory = lateModalInventory;
        }
        state = await readDateUpdateProbeState(page);
        latestState = state;
        latestModalInventory = modalInventory;
        return { state, modalInventory, terminalCallbackObserved };
    } catch (error) {
        if (page) {
            try {
                latestState = await readDateUpdateProbeState(page);
            } catch {
                // Keep the last sanitized state when the page has already gone away.
            }
        }
        if (dispatchStarted && latestState
            && latestState.sendActionAttempted === false
            && latestState.sendActionCount === 0) {
            // The bridge may have been entered while the page was lost. Do not
            // report a definite false/zero dispatch until a fresh state read.
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
        throw new DateUpdateSdkProbeError(reason, partialResult);
    } finally {
        await page?.close().catch(() => undefined);
        await context?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
    }
}

(LIVE ? describe : describe.skip)("eformsign official SDK date update — staged test-only send", () => {
    jest.setTimeout(LIVE_TEST_TIMEOUT_MS);

    let moduleRef: TestingModule | undefined;
    let configService: ConfigService;
    let eformsignClient: EformsignApiClient;
    let eformsignService: EformsignService;
    let fixture: DateUpdateFixture;

    beforeAll(async () => {
        if (process.env["E2E_VENDOR_STUBS"] === "1") {
            throw new Error("date-update SDK test requires real vendor APIs");
        }
        let phase = "module setup";
        try {
            moduleRef = await Test.createTestingModule({
                imports: [ConfigModule.forRoot({ isGlobal: true })],
                providers: [EformsignApiClient, EformsignService],
            }).compile();
            configService = moduleRef.get(ConfigService);
            eformsignClient = moduleRef.get(EformsignApiClient);
            eformsignService = moduleRef.get(EformsignService);

            if (configService.get<string>("EFORMSIGN_USER_EMAIL")?.trim() !== EFORMSIGN_SDK_DATE_UPDATE_USER_EMAIL) {
                throw new Error("configured eformsign user is outside the exact date-update allowlist");
            }

            phase = "access token";
            const token = await eformsignClient.getAccessToken(Date.now());
            const accessToken = token.oauth_token.access_token.trim();
            const refreshToken = token.oauth_token.refresh_token.trim();
            if (!accessToken || !refreshToken) {
                throw new Error("date-update SDK test did not receive usable API tokens");
            }

            phase = "template topology preflight";
            const templateConfig = await fetchWorkflowUpdateTemplateConfig(configService, accessToken);
            assertWorkflowUpdateTemplateTopology(templateConfig);

            phase = "participant-stage preflight";
            const beforeDocument = await eformsignClient.getDocument(
                accessToken,
                EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID,
            );
            const beforeSnapshot = assertDateUpdateBeforeOpenIdentity(beforeDocument);
            assertDateUpdateBaselineFields(beforeDocument);

            phase = "baseline PDF";
            const beforePdfBody = await downloadDateUpdatePdf(
                eformsignService,
                accessToken,
                EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID,
            );
            const artifactDirectory = await createSecureDateUpdateArtifactDirectory();
            const beforePdf = await writeSecureDateUpdatePdfArtifact(artifactDirectory, "before", beforePdfBody);
            if (beforePdf.sha256 !== EFORMSIGN_SDK_DATE_UPDATE_BASELINE_PDF_SHA256
                || beforePdf.sha256 !== EFORMSIGN_SDK_DATE_UPDATE_PDF_SHA256) {
                throw new Error("date-update SDK preflight PDF hash is outside the exact baseline allowlist");
            }

            phase = "mode02 option assembly";
            const baseOption = await eformsignService.generateStaffCompletionOptions(
                EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID,
                accessToken,
                refreshToken,
            );
            const documentOption = buildDateUpdatePrefillOption(baseOption as Record<string, unknown>);
            assertDateUpdatePrefillOption(documentOption);

            fixture = {
                accessToken,
                documentOption,
                beforeDocument,
                beforeSnapshot,
                beforePdf,
                artifactDirectory,
            };
        } catch (error) {
            throw new Error(`${phase}: ${safeDateUpdateErrorReason(error, "date-update preflight")}`);
        }
    });

    afterAll(async () => {
        await moduleRef?.close().catch(() => undefined);
    });

    it(TEST_TITLE, async () => {
        let browserPhaseError: unknown;
        let runResult: DateUpdateSdkRunResult | undefined;
        try {
            runResult = await runDateUpdateSdkProbe(fixture.documentOption, async () => {
                const current = await eformsignClient.getDocument(
                    fixture.accessToken,
                    EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID,
                );
                const currentSnapshot = assertDateUpdateBeforeOpenIdentity(current);
                assertDateUpdateBaselineFields(current);
                assertEformsignSdkSnapshotsEqual(fixture.beforeSnapshot, currentSnapshot);
                const currentTemplateConfig = await fetchWorkflowUpdateTemplateConfig(
                    configService,
                    fixture.accessToken,
                );
                assertWorkflowUpdateTemplateTopology(currentTemplateConfig);
            });
        } catch (error) {
            if (error instanceof DateUpdateSdkProbeError) runResult = error.partialResult;
            browserPhaseError = error;
        }

        let apiPostflightError: unknown;
        let pdfPostflightError: unknown;
        let afterDocument: EformsignApiDocumentResponse | undefined;
        let afterPdf: SecurePdfArtifact | undefined;
        const stopBeforeSend = Boolean(
            runResult?.modalInventory.visible || runResult?.modalInventory.inspectionError,
        );
        try {
            afterDocument = await eformsignClient.getDocument(
                fixture.accessToken,
                EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID,
            );
            if (stopBeforeSend) {
                // Modal target is intentionally unknown at this stage. Confirm
                // that stopping left the document and PDF at the pre-send state.
                const afterSnapshot = assertDateUpdateBeforeOpenIdentity(afterDocument);
                assertDateUpdateBaselineFields(afterDocument);
                assertEformsignSdkSnapshotsEqual(fixture.beforeSnapshot, afterSnapshot);
            } else {
                assertDateUpdateAfterSendIdentity(afterDocument);
                assertDateUpdateOnlyAllowedFieldChanges(fixture.beforeDocument, afterDocument);
            }
        } catch (error) {
            apiPostflightError = error;
        }

        try {
            const afterPdfBody = await downloadDateUpdatePdf(
                eformsignService,
                fixture.accessToken,
                EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID,
            );
            afterPdf = await writeSecureDateUpdatePdfArtifact(
                fixture.artifactDirectory,
                "after",
                afterPdfBody,
            );
            if (stopBeforeSend && afterPdf.sha256 !== fixture.beforePdf.sha256) {
                throw new Error("date-update SDK modal stop changed the baseline PDF");
            }
            // The downloaded PDF is preserved for the required visual
            // comparison of pages 3, 7, 8 and signature pages. Text marker
            // counts are deliberately not treated as receipt proof here.
        } catch (error) {
            pdfPostflightError = error;
        }
        const postflightError = apiPostflightError ?? pdfPostflightError;

        const state = runResult?.state;
        const modalInventory = runResult?.modalInventory;
        console.info(JSON.stringify({
            test: TEST_TITLE,
            browserPhase: browserPhaseError ? "failed" : "observed",
            postflight: postflightError ? "failed" : "observed",
            postflightApi: apiPostflightError ? "failed" : "observed",
            postflightPdf: pdfPostflightError ? "failed" : "observed",
            documentConfigured: state ? state.documentConfigured : null,
            openInvoked: state ? state.openInvoked : null,
            opened: state ? state.opened : null,
            actionCodes: state?.actionCallbacks.flatMap((callback) => callback.data.map((action) => action.code)).slice(0, 20) ?? [],
            successCodes: state?.successCodes ?? [],
            terminalCallbackObserved: runResult ? runResult.terminalCallbackObserved : null,
            sendActionAttempted: state ? state.sendActionAttempted : null,
            sendActionCount: state ? state.sendActionCount : null,
            sendActionType: state ? state.sendActionType : null,
            sendActionCode: state ? state.sendActionCode : null,
            sendActionErrorCode: state ? state.sendActionErrorCode : null,
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
            pdfVisualVerification: "required: pages 3/7/8 and signature pixel comparison",
        }));

        // Prefer an independent API/PDF failure while retaining the browser
        // failure and sanitized state in the bounded log above.
        if (postflightError) {
            throw new Error(safeDateUpdateErrorReason(postflightError, "date-update independent postflight"));
        }
        if (browserPhaseError) {
            throw new Error(safeDateUpdateErrorReason(browserPhaseError, "date-update SDK browser phase"));
        }
        if (!runResult) throw new Error("date-update SDK browser phase returned no result");
        assertCurrentParticipantSendAdvertised(runResult.state.actionCallbacks);
        if (!runResult.state.sendActionAttempted
            || runResult.state.sendActionCount !== 1
            || runResult.state.sendActionType !== "01"
            || runResult.state.sendActionCode !== "22"
            || runResult.state.sendActionErrorCode) {
            throw new Error("date-update SDK did not dispatch exactly one participant action code 22");
        }
        if (runResult.modalInventory.visible || runResult.modalInventory.inspectionError) {
            throw new Error("date-update SDK recipient modal inspection was uncertain; stopped without clicking a send control");
        }
    });
});
