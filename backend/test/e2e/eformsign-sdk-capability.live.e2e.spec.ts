import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    chromium,
    type Browser,
    type BrowserContext,
    type Page,
} from "playwright-core";

import { EformsignService } from "application/services/eformsign.service";
import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";
import type {
    EformsignApiDocumentResponse,
} from "domain/repositories/eformsign.client.interface";
import {
    EFORMSIGN_SDK_CAPABILITY_DOCUMENT_ID,
    EFORMSIGN_SDK_CAPABILITY_IFRAME_ID,
    EFORMSIGN_SDK_CAPABILITY_PDF_SHA256,
    EFORMSIGN_SDK_CAPABILITY_USER_EMAIL,
    assertEformsignSdkDocumentIdentity,
    assertEformsignSdkSnapshotsEqual,
    assertPdfDownload,
    assertReadonlyMode02Option,
    assertReadonlySdkHtml,
    buildReadonlySdkHtml,
    getAdvertisedOperationalActions,
    hashPdfBody,
    sanitizeActionCallback,
    type ReadonlySdkProbeState,
    type SanitizedEformsignActionCallback,
    type EformsignSdkDocumentSnapshot,
} from "./helpers/eformsign-sdk-capability.live.helper";

const LIVE = process.env["LIVE_E2E"] === "1";
const READONLY_SDK_TIMEOUT_MS = 30_000;
const ACTION_CALLBACK_OBSERVATION_TIMEOUT_MS = 30_000;
const LIVE_TEST_TIMEOUT_MS = 180_000;
const SECURE_DIRECTORY_MODE = 0o700;
const SECURE_FILE_MODE = 0o600;

interface SecurePdfArtifact {
    path: string;
    sha256: string;
}

interface ProbeFixture {
    accessToken: string;
    documentOption: Record<string, unknown>;
    beforeSnapshot: EformsignSdkDocumentSnapshot;
    beforePdf: SecurePdfArtifact;
    artifactDirectory: string;
}

function asRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("eformsign SDK probe returned an invalid option shape");
    }
    return value as Record<string, unknown>;
}

function normalizeProbeState(value: unknown): ReadonlySdkProbeState {
    const state = typeof value === "object" && value !== null
        ? value as Record<string, unknown>
        : {};
    const actionCallbacks = Array.isArray(state["actionCallbacks"])
        ? state["actionCallbacks"].flatMap((item): SanitizedEformsignActionCallback[] => {
            const sanitized = sanitizeActionCallback(item);
            return sanitized ? [sanitized] : [];
        })
        : [];
    return {
        documentConfigured: state["documentConfigured"] === true,
        openInvoked: state["openInvoked"] === true,
        opened: state["opened"] === true,
        bootError: state["bootError"] === true,
        errorCallbackSeen: state["errorCallbackSeen"] === true,
        actionCallbacks,
    };
}

async function readProbeState(page: Page): Promise<ReadonlySdkProbeState> {
    const raw = await page.evaluate(() => {
        const state = (window as unknown as {
            __eformsignSdkProbe?: unknown;
        }).__eformsignSdkProbe;
        if (typeof state !== "object" || state === null) return {};
        const value = state as Record<string, unknown>;
        return {
            documentConfigured: value["documentConfigured"],
            openInvoked: value["openInvoked"],
            opened: value["opened"],
            bootError: value["bootError"],
            errorCallbackSeen: value["errorCallbackSeen"],
            actionCallbacks: Array.isArray(value["actionCallbacks"])
                ? value["actionCallbacks"]
                : [],
        };
    });
    return normalizeProbeState(raw);
}

async function createSecureArtifactDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "eformsign-sdk-capability-"));
    await chmod(directory, SECURE_DIRECTORY_MODE);
    const directoryMode = (await stat(directory)).mode & 0o777;
    if (directoryMode !== SECURE_DIRECTORY_MODE) {
        throw new Error("eformsign SDK probe could not secure its PDF artifact directory");
    }
    return directory;
}

async function writeSecurePdfArtifact(
    directory: string,
    label: "before" | "after",
    body: Buffer,
): Promise<SecurePdfArtifact> {
    const path = join(directory, `${label}.pdf`);
    await writeFile(path, body, { mode: SECURE_FILE_MODE, flag: "wx" });
    await chmod(path, SECURE_FILE_MODE);
    const fileMode = (await stat(path)).mode & 0o777;
    if (fileMode !== SECURE_FILE_MODE) {
        throw new Error("eformsign SDK probe could not secure its PDF artifact");
    }
    return { path, sha256: hashPdfBody(body) };
}

async function waitForSdkDocumentFrame(page: Page): Promise<void> {
    try {
        await page.waitForFunction(
            (iframeId) => {
                const probe = (window as unknown as {
                    __eformsignSdkProbe?: {
                        bootError?: boolean;
                        errorCallbackSeen?: boolean;
                        documentConfigured?: boolean;
                        openInvoked?: boolean;
                    };
                }).__eformsignSdkProbe;
                if (probe?.bootError || probe?.errorCallbackSeen) return true;
                const frame = document.getElementById(iframeId);
                return Boolean(
                    probe?.documentConfigured
                    && probe?.openInvoked
                    && frame instanceof HTMLIFrameElement
                    && frame.src.startsWith("https://www.eformsign.com/"),
                );
            },
            EFORMSIGN_SDK_CAPABILITY_IFRAME_ID,
            { timeout: READONLY_SDK_TIMEOUT_MS },
        );
    } catch {
        throw new Error("eformsign SDK probe did not load the official document iframe");
    }
}

async function observeSdkActionCallbacks(page: Page): Promise<void> {
    try {
        // Keep the page open for a fixed bounded window so later callbacks are
        // captured. A boot/document error ends the wait early; no action is
        // ever dispatched to make another callback appear.
        await page.waitForFunction(
            () => {
                const probe = (window as unknown as {
                    __eformsignSdkProbe?: {
                        bootError?: boolean;
                        errorCallbackSeen?: boolean;
                    };
                }).__eformsignSdkProbe;
                return Boolean(probe?.bootError || probe?.errorCallbackSeen);
            },
            undefined,
            { timeout: ACTION_CALLBACK_OBSERVATION_TIMEOUT_MS },
        );
    } catch {
        // Timeout is expected when the document remains healthy; read the
        // accumulated sanitized callbacks after the observation window.
    }
}

async function runReadonlySdkProbe(documentOption: Record<string, unknown>): Promise<ReadonlySdkProbeState> {
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    try {
        const html = buildReadonlySdkHtml(documentOption);
        assertReadonlySdkHtml(html);
        browser = await chromium.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ],
        });
        context = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            userAgent:
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        });
        page = await context.newPage();
        const localUrl = `http://localhost:3000/__eformsign-headless/sdk-capability-${randomUUID()}`;
        await page.route(localUrl, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "text/html; charset=utf-8",
                body: html,
            });
        });
        await page.goto(localUrl, { waitUntil: "domcontentloaded" });
        await waitForSdkDocumentFrame(page);

        const initialState = await readProbeState(page);
        if (initialState.bootError || initialState.errorCallbackSeen) {
            throw new Error("eformsign SDK probe reported a boot or document error");
        }

        try {
            await page.waitForFunction(
                () => {
                    const probe = (window as unknown as {
                        __eformsignSdkProbe?: {
                            bootError?: boolean;
                            errorCallbackSeen?: boolean;
                            actionCallbacks?: unknown[];
                        };
                    }).__eformsignSdkProbe;
                    return Boolean(
                        probe?.bootError
                        || probe?.errorCallbackSeen
                        || (Array.isArray(probe?.actionCallbacks) && probe.actionCallbacks.length > 0),
                    );
                },
                undefined,
                { timeout: READONLY_SDK_TIMEOUT_MS },
            );
        } catch {
            throw new Error("eformsign SDK probe did not advertise an actionCallback");
        }

        await observeSdkActionCallbacks(page);
        const state = await readProbeState(page);
        if (state.bootError || state.errorCallbackSeen) {
            throw new Error("eformsign SDK probe reported a boot or document error");
        }
        if (!state.documentConfigured || !state.openInvoked || !state.opened) {
            throw new Error("eformsign SDK probe did not complete document registration and open");
        }
        if (state.actionCallbacks.length === 0) {
            throw new Error("eformsign SDK probe returned no actionCallback");
        }
        return state;
    } catch (error) {
        if (error instanceof Error && error.message.startsWith("eformsign SDK probe")) {
            throw error;
        }
        throw new Error("eformsign SDK capability probe browser phase failed");
    } finally {
        await page?.close().catch(() => undefined);
        await context?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
    }
}

(LIVE ? describe : describe.skip)("eformsign official SDK capability probe — read-only", () => {
    jest.setTimeout(LIVE_TEST_TIMEOUT_MS);

    let moduleRef: TestingModule | undefined;
    let configService: ConfigService;
    let eformsignClient: EformsignApiClient;
    let eformsignService: EformsignService;
    let fixture: ProbeFixture;

    beforeAll(async () => {
        try {
            if (process.env["E2E_VENDOR_STUBS"] === "1") {
                throw new Error("eformsign SDK capability probe requires real vendor APIs");
            }

            moduleRef = await Test.createTestingModule({
                imports: [ConfigModule.forRoot({ isGlobal: true })],
                providers: [EformsignApiClient, EformsignService],
            }).compile();
            configService = moduleRef.get(ConfigService);
            eformsignClient = moduleRef.get(EformsignApiClient);
            eformsignService = moduleRef.get(EformsignService);

            if (configService.get<string>("EFORMSIGN_USER_EMAIL")?.trim() !== EFORMSIGN_SDK_CAPABILITY_USER_EMAIL) {
                throw new Error("configured eformsign user is outside the exact SDK probe allowlist");
            }

            const token = await eformsignClient.getAccessToken(Date.now());
            const accessToken = token.oauth_token.access_token.trim();
            const refreshToken = token.oauth_token.refresh_token.trim();
            if (!accessToken || !refreshToken) {
                throw new Error("eformsign SDK probe did not receive usable API tokens");
            }

            const beforeDocument = await eformsignClient.getDocument(
                accessToken,
                EFORMSIGN_SDK_CAPABILITY_DOCUMENT_ID,
            );
            const beforeSnapshot = assertEformsignSdkDocumentIdentity(beforeDocument);
            const beforeDownload = await eformsignService.downloadDocumentFile(
                accessToken,
                EFORMSIGN_SDK_CAPABILITY_DOCUMENT_ID,
                "document",
            );
            assertPdfDownload(beforeDownload);
            const artifactDirectory = await createSecureArtifactDirectory();
            const beforePdf = await writeSecurePdfArtifact(artifactDirectory, "before", beforeDownload.body);
            if (beforePdf.sha256 !== EFORMSIGN_SDK_CAPABILITY_PDF_SHA256) {
                throw new Error("eformsign SDK probe preflight PDF hash is outside the exact allowlist");
            }

            const documentOption = asRecord(await eformsignService.generateStaffCompletionOptions(
                EFORMSIGN_SDK_CAPABILITY_DOCUMENT_ID,
                accessToken,
                refreshToken,
            ));
            assertReadonlyMode02Option(documentOption);

            fixture = {
                accessToken,
                documentOption,
                beforeSnapshot,
                beforePdf,
                artifactDirectory,
            };
        } catch {
            throw new Error("eformsign SDK capability probe preflight failed");
        }
    });

    afterAll(async () => {
        await moduleRef?.close();
    });

    it("loads mode02 and records only sanitized advertised callbacks", async () => {
        let probeError: unknown;
        let observedState: ReadonlySdkProbeState | undefined;
        try {
            observedState = await runReadonlySdkProbe(fixture.documentOption);
        } catch {
            probeError = new Error("eformsign SDK capability probe browser phase failed");
        }

        let postflightStateFailed = false;
        let postflightPdfFailed = false;
        try {
            const afterDocument: EformsignApiDocumentResponse = await eformsignClient.getDocument(
                fixture.accessToken,
                EFORMSIGN_SDK_CAPABILITY_DOCUMENT_ID,
            );
            const afterSnapshot = assertEformsignSdkDocumentIdentity(afterDocument);
            assertEformsignSdkSnapshotsEqual(fixture.beforeSnapshot, afterSnapshot);
        } catch {
            postflightStateFailed = true;
        }

        try {
            const afterDownload = await eformsignService.downloadDocumentFile(
                fixture.accessToken,
                EFORMSIGN_SDK_CAPABILITY_DOCUMENT_ID,
                "document",
            );
            assertPdfDownload(afterDownload);
            const afterPdf = await writeSecurePdfArtifact(fixture.artifactDirectory, "after", afterDownload.body);
            if (afterPdf.sha256 !== fixture.beforePdf.sha256 || afterPdf.sha256 !== EFORMSIGN_SDK_CAPABILITY_PDF_SHA256) {
                throw new Error("eformsign SDK probe changed the reviewed document PDF");
            }
        } catch {
            postflightPdfFailed = true;
        }

        const actionCallbacks = observedState?.actionCallbacks ?? [];
        const actionSummary = actionCallbacks.flatMap((callback) => callback.data);
        const operationalActions = getAdvertisedOperationalActions(actionCallbacks);
        console.info("[eformsign-sdk-capability] " + JSON.stringify({
            probeSucceeded: !probeError,
            postflightStateUnchanged: !postflightStateFailed,
            postflightPdfUnchanged: !postflightPdfFailed,
            documentConfigured: observedState?.documentConfigured === true,
            openInvoked: observedState?.openInvoked === true,
            opened: observedState?.opened === true,
            actionCallbackCount: actionCallbacks.length,
            actionCapability: operationalActions.length > 0 ? "observed" : "inconclusive",
            actions: actionSummary,
            operationalActions,
        }));

        if (postflightStateFailed || postflightPdfFailed) {
            throw new Error("eformsign SDK capability probe postflight failed");
        }
        if (probeError) throw probeError;
        if (!observedState) throw new Error("eformsign SDK capability probe returned no state");
    });
});
