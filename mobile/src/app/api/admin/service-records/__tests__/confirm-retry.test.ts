/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";
import type {
  AdminServiceRecordScheduleApi,
  ScheduleDraft,
  ScheduleDraftState,
} from "@/features/service-records/api/admin-service-record-schedule.api";
import { saveServiceRecordSchedule } from "@/components/app/service-record/service-record-schedule-save";

import { POST as confirmDraft } from "../drafts/[draftId]/confirm/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: { get: jest.fn(), patch: jest.fn(), post: jest.fn() },
}));

const mockPost = serverAPIClient.post as jest.Mock;

const SOURCE = { sourceFingerprint: "fp-1", sourceCaseVersion: 7 };
const SCHEDULE = { serviceDays: { saturday: false, sunday: false, holiday: false }, dates: ["2026-12-14"] };
const draftParams = { params: Promise.resolve({ draftId: "draft-1" }) };

function draft(draftVersion = 1): ScheduleDraft {
    return { id: "draft-1", status: "ACTIVE", draftVersion, ...SOURCE, changes: {} };
}

function state(overrides: Partial<ScheduleDraftState> = {}): ScheduleDraftState {
    return { draft: null, sourceChanged: false, ...SOURCE, ...overrides };
}

/** The backend's 409 body for `code`, shaped as the Nest exception filter returns it. */
function backendConflict(code: "REQUEST_NOT_PENDING" | "REQUEST_STALE" | "SERVICE_RECORD_WRITE_TARGET_CHANGED") {
    const problem = createProblemDetails({ code, requestId: "req-1", outcome: "NOT_APPLIED" });
    return { response: { status: problem.status, data: { ...problem, statusCode: problem.status, message: problem.detail } } };
}

/**
 * A confirm that goes through the real Next.js proxy, then reaches the save helper the way the browser's
 * axios client would see it: the proxy's status and JSON body as `error.response`.
 */
function makeApi() {
    const confirm = jest.fn(async () => {
        const response = await confirmDraft(
            new NextRequest("http://localhost/x", {
                method: "POST",
                headers: { cookie: "auth_token=token-1", "content-type": "application/json" },
                body: JSON.stringify({ expectedDraftVersion: 2, previewId: "srp_1", idempotencyKey: "k" }),
            }),
            draftParams,
        );
        const data = await response.json();
        if (response.status >= 400) throw { response: { status: response.status, data } };
        return { status: "confirmed", caseVersion: 8 };
    });
    const mocks = {
        getDraft: jest.fn().mockResolvedValue(state()),
        startDraft: jest.fn().mockResolvedValue(state({ draft: draft() })),
        updateDraft: jest.fn().mockResolvedValue(state({ draft: draft(2) })),
        previewDraft: jest.fn().mockResolvedValue({ previewId: "srp_1", draftId: "draft-1", draftVersion: 2, blockingReasons: [] }),
        confirmDraft: confirm,
        discardDraft: jest.fn().mockResolvedValue(state()),
    };
    return { api: mocks as unknown as AdminServiceRecordScheduleApi, mocks };
}

const run = (api: AdminServiceRecordScheduleApi) =>
    saveServiceRecordSchedule({ api, clientId: 12, source: SOURCE, schedule: SCHEDULE });

describe("confirm 409 through the proxy into the save retry", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it.each(["REQUEST_NOT_PENDING", "REQUEST_STALE"] as const)("confirms once when the backend answers %s", async (code) => {
        mockPost.mockRejectedValue(backendConflict(code));
        const { api, mocks } = makeApi();

        await expect(run(api)).rejects.toMatchObject({ response: { status: 409, data: { code } } });

        expect(mockPost).toHaveBeenCalledTimes(1);
        expect(mocks.confirmDraft).toHaveBeenCalledTimes(1);
        expect(mocks.startDraft).toHaveBeenCalledTimes(1);
    });

    it("retries once when a concurrent write moved the target and the source is unchanged", async () => {
        mockPost.mockRejectedValueOnce(backendConflict("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        mockPost.mockResolvedValueOnce({ status: 200, data: { status: "confirmed", caseVersion: 8 } });
        const { api, mocks } = makeApi();

        await expect(run(api)).resolves.toEqual({ kind: "saved", caseVersion: 8 });

        expect(mockPost).toHaveBeenCalledTimes(2);
        expect(mocks.startDraft).toHaveBeenCalledTimes(2);
    });

    it("does not retry that conflict when the source identity changed", async () => {
        mockPost.mockRejectedValue(backendConflict("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        const { api, mocks } = makeApi();
        mocks.getDraft.mockResolvedValueOnce(state()).mockResolvedValueOnce(state({ sourceFingerprint: "fp-2" }));

        await expect(run(api)).resolves.toEqual({ kind: "source-changed" });

        expect(mockPost).toHaveBeenCalledTimes(1);
        expect(mocks.startDraft).toHaveBeenCalledTimes(1);
    });
});
