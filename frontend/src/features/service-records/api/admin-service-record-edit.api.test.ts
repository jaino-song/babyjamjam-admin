import { AdminServiceRecordEditApiError } from "../types";
import {
    adminServiceRecordEditApi,
    normalizeAdminServiceRecordEditState,
} from "./admin-service-record-edit.api";

const originalFetch = global.fetch;

function response(body: unknown, status: number) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as unknown as Response;
}

afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

describe("admin service-record edit API adapter", () => {
    it("uses explicit start, no-write GET, CAS patch, and CAS discard routes", async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response({ draft: null }, 200))
            .mockResolvedValueOnce(response({ draft: { id: "d-1", status: "ACTIVE", changes: {} } }, 201))
            .mockResolvedValueOnce(response({ draft: { id: "d-1", status: "ACTIVE", changes: {}, draftVersion: 2 } }, 200))
            .mockResolvedValueOnce(response({ draft: { id: "d-1", status: "DISCARDED", changes: {}, draftVersion: 3 } }, 200));

        await adminServiceRecordEditApi.getDraft("client/1");
        await adminServiceRecordEditApi.startDraft("client/1");
        await adminServiceRecordEditApi.updateDraft("draft/1", 1, { sessions: [{ sessionIndex: 1, serviceDate: "2026-07-10" }] });
        await adminServiceRecordEditApi.discardDraft("draft/1", 2);

        expect(global.fetch).toHaveBeenNthCalledWith(
            1,
            "/api/admin/service-records/client/client%2F1/draft",
            expect.objectContaining({ method: "GET", cache: "no-store" }),
        );
        expect(global.fetch).toHaveBeenNthCalledWith(
            2,
            "/api/admin/service-records/client/client%2F1/draft",
            expect.objectContaining({ method: "POST", body: "{}" }),
        );
        expect(global.fetch).toHaveBeenNthCalledWith(
            3,
            "/api/admin/service-records/drafts/draft%2F1",
            expect.objectContaining({ method: "PATCH", body: JSON.stringify({ expectedDraftVersion: 1, changes: { sessions: [{ sessionIndex: 1, serviceDate: "2026-07-10" }] } }) }),
        );
        expect(global.fetch).toHaveBeenNthCalledWith(
            4,
            "/api/admin/service-records/drafts/draft%2F1/discard",
            expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedDraftVersion: 2 }) }),
        );
    });

    it("preserves a 409 response body for explicit conflict handling", async () => {
        global.fetch = jest.fn().mockResolvedValue(response({
            code: "SERVICE_RECORD_EDIT_DRAFT_CONFLICT",
            latestDraft: { id: "d-1", status: "ACTIVE", changes: {}, draftVersion: 4 },
            sourceChanged: true,
            sourceCaseVersion: 9,
            sourceFingerprint: "source-9",
        }, 409));

        await expect(adminServiceRecordEditApi.updateDraft("d-1", 3, {})).rejects.toEqual(
            expect.objectContaining({
                status: 409,
                body: expect.objectContaining({ code: "SERVICE_RECORD_EDIT_DRAFT_CONFLICT" }),
            }),
        );
        await expect(adminServiceRecordEditApi.updateDraft("d-1", 3, {})).rejects.toBeInstanceOf(AdminServiceRecordEditApiError);
    });

    it("normalizes a discarded draft without applying provenance fields", () => {
        const state = normalizeAdminServiceRecordEditState({
            draft: {
                id: "d-1",
                status: "DISCARDED",
                changes: { sessions: [{ sessionIndex: 1, serviceDate: "2026-07-10" }] },
                sourceSnapshot: { answers: { secret: true } },
                discardedAt: "2026-07-11T00:00:00.000Z",
            },
            sourceChanged: false,
            sourceCaseVersion: 2,
            sourceFingerprint: "f-2",
        });

        expect(state.draft?.status).toBe("DISCARDED");
        expect(state.draft?.changes).toEqual({ sessions: [{ sessionIndex: 1, serviceDate: "2026-07-10" }] });
        expect(state.draft?.sourceSnapshot).toEqual({ answers: { secret: true } });
    });
});
