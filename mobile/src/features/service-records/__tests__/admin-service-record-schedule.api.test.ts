import { api } from "@/lib/api/client";

import {
  adminServiceRecordScheduleApi,
  normalizeScheduleDraftState,
  readScheduleEditError,
} from "../api/admin-service-record-schedule.api";

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));

const mockGet = api.get as jest.Mock;
const mockPost = api.post as jest.Mock;
const mockPatch = api.patch as jest.Mock;

const SCHEDULE = { serviceDays: { saturday: true, sunday: false, holiday: false }, dates: ["2026-12-14"] };

describe("adminServiceRecordScheduleApi", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it("reads the editor overview", async () => {
    mockGet.mockResolvedValue({ data: { assignments: [] } });

    await expect(adminServiceRecordScheduleApi.getEditor(12)).resolves.toEqual({ assignments: [] });
    expect(mockGet).toHaveBeenCalledWith("/admin/service-records/client/12/editor");
  });

  it("reads and starts a draft, normalizing the state", async () => {
    mockGet.mockResolvedValue({
      data: {
        draft: { id: "d1", status: "ACTIVE", draftVersion: 3, sourceCaseVersion: 4, sourceFingerprint: "fp", changes: {}, extra: "x" },
        sourceChanged: false,
        sourceCaseVersion: 4,
        sourceFingerprint: "fp",
      },
    });
    mockPost.mockResolvedValue({ data: { draft: null, sourceCaseVersion: 4, sourceFingerprint: "fp" } });

    await expect(adminServiceRecordScheduleApi.getDraft(12)).resolves.toEqual({
      draft: { id: "d1", status: "ACTIVE", draftVersion: 3, sourceCaseVersion: 4, sourceFingerprint: "fp", changes: {} },
      sourceChanged: false,
      sourceCaseVersion: 4,
      sourceFingerprint: "fp",
    });
    expect(mockGet).toHaveBeenCalledWith("/admin/service-records/client/12/draft");

    await expect(adminServiceRecordScheduleApi.startDraft(12)).resolves.toMatchObject({ draft: null });
    expect(mockPost).toHaveBeenCalledWith("/admin/service-records/client/12/draft", {});
  });

  it("saves the whole-set schedule with the expected version and empty changes", async () => {
    mockPatch.mockResolvedValue({ data: { draft: { id: "d1", draftVersion: 2 } } });

    const state = await adminServiceRecordScheduleApi.updateDraft("d 1", 1, {}, SCHEDULE);

    expect(mockPatch).toHaveBeenCalledWith("/admin/service-records/drafts/d%201", {
      expectedDraftVersion: 1,
      changes: {},
      schedule: SCHEDULE,
    });
    expect(state.draft).toMatchObject({ id: "d1", draftVersion: 2, status: "ACTIVE" });
  });

  it("previews, confirms and discards by draft id", async () => {
    mockPost
      .mockResolvedValueOnce({
        data: { previewId: "srp_1", draftId: "d1", draftVersion: 2, blockingReasons: [{ code: "NON_SERVICE_DAY", sessionIndex: 4, message: "x" }, { nope: 1 }] },
      })
      .mockResolvedValueOnce({ data: { status: "confirmed", caseVersion: 9, junk: true } })
      .mockResolvedValueOnce({ data: { draft: { id: "d1", status: "DISCARDED", draftVersion: 3 } } });

    await expect(adminServiceRecordScheduleApi.previewDraft("d1", 2)).resolves.toEqual({
      previewId: "srp_1",
      draftId: "d1",
      draftVersion: 2,
      blockingReasons: [{ code: "NON_SERVICE_DAY", sessionIndex: 4 }],
    });
    await expect(adminServiceRecordScheduleApi.confirmDraft("d1", 2, "srp_1", "key-1")).resolves.toEqual({
      status: "confirmed",
      caseVersion: 9,
    });
    await adminServiceRecordScheduleApi.discardDraft("d1", 2);

    expect(mockPost.mock.calls).toEqual([
      ["/admin/service-records/drafts/d1/preview", { expectedDraftVersion: 2 }],
      ["/admin/service-records/drafts/d1/confirm", { expectedDraftVersion: 2, previewId: "srp_1", idempotencyKey: "key-1" }],
      ["/admin/service-records/drafts/d1/discard", { expectedDraftVersion: 2 }],
    ]);
  });
});

describe("normalizeScheduleDraftState", () => {
  it("degrades a malformed payload to an empty state", () => {
    expect(normalizeScheduleDraftState(null)).toEqual({
      draft: null,
      sourceChanged: false,
      sourceCaseVersion: 0,
      sourceFingerprint: "",
    });
    expect(normalizeScheduleDraftState({ draft: { id: 5 } }).draft).toBeNull();
  });
});

describe("readScheduleEditError", () => {
  it("reads the status, the schedule code and the blocking reasons of a failed call", () => {
    expect(
      readScheduleEditError({
        response: {
          status: 409,
          data: { scheduleCode: "SCHEDULE_COUNT_MISMATCH", blockingReasons: [{ code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 2 }] },
        },
      }),
    ).toEqual({
      status: 409,
      scheduleCode: "SCHEDULE_COUNT_MISMATCH",
      blockingReasons: [{ code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 2 }],
    });
  });

  it("returns an empty description for anything else", () => {
    expect(readScheduleEditError(new Error("boom"))).toEqual({ status: null, scheduleCode: null, blockingReasons: [] });
    expect(readScheduleEditError(undefined)).toEqual({ status: null, scheduleCode: null, blockingReasons: [] });
  });
});
