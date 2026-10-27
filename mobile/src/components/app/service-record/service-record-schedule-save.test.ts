import type { AdminServiceRecordScheduleApi, ScheduleDraft, ScheduleDraftState } from "@/features/service-records/api/admin-service-record-schedule.api";

import {
  createIdempotencyKey,
  sameScheduleSource,
  saveServiceRecordSchedule,
} from "./service-record-schedule-save";

const SOURCE = { sourceFingerprint: "fp-1", sourceCaseVersion: 7 };
const SCHEDULE = {
  serviceDays: { saturday: true, sunday: false, holiday: false },
  dates: ["2026-12-14", "2026-12-15"],
};

function draft(overrides: Partial<ScheduleDraft> = {}): ScheduleDraft {
  return {
    id: "draft-1",
    status: "ACTIVE",
    draftVersion: 1,
    sourceCaseVersion: SOURCE.sourceCaseVersion,
    sourceFingerprint: SOURCE.sourceFingerprint,
    changes: {},
    ...overrides,
  };
}

function state(overrides: Partial<ScheduleDraftState> = {}): ScheduleDraftState {
  return { draft: null, sourceChanged: false, ...SOURCE, ...overrides };
}

/** The one problem code the backend uses for a concurrent write that moved the case or the draft. */
const VERSION_CONFLICT = "SERVICE_RECORD_WRITE_TARGET_CHANGED";

const axiosError = (status: number, data: unknown = {}) => ({ response: { status, data } });

function makeApi() {
  const mocks = {
    getEditor: jest.fn(),
    getDraft: jest.fn().mockResolvedValue(state()),
    startDraft: jest.fn().mockResolvedValue(state({ draft: draft() })),
    updateDraft: jest.fn().mockResolvedValue(state({ draft: draft({ draftVersion: 2 }) })),
    previewDraft: jest.fn().mockResolvedValue({
      previewId: "srp_1", draftId: "draft-1", draftVersion: 2, blockingReasons: [],
    }),
    confirmDraft: jest.fn().mockResolvedValue({ status: "confirmed", caseVersion: 8 }),
    discardDraft: jest.fn().mockResolvedValue(state()),
  };
  return { api: mocks as unknown as AdminServiceRecordScheduleApi, mocks };
}

/** True when `earlier` was first called before `later` was first called. */
const calledBefore = (earlier: jest.Mock, later: jest.Mock) =>
  earlier.mock.invocationCallOrder[0] < later.mock.invocationCallOrder[0];

const run = (api: AdminServiceRecordScheduleApi) =>
  saveServiceRecordSchedule({ api, clientId: 12, source: SOURCE, schedule: SCHEDULE });

describe("saveServiceRecordSchedule", () => {
  it("runs getDraft -> startDraft -> updateDraft(schedule) -> previewDraft -> confirmDraft", async () => {
    const { api, mocks } = makeApi();

    await expect(run(api)).resolves.toEqual({ kind: "saved", caseVersion: 8 });

    const order = [mocks.getDraft, mocks.startDraft, mocks.updateDraft, mocks.previewDraft, mocks.confirmDraft];
    order.forEach((mock) => expect(mock).toHaveBeenCalledTimes(1));
    order.slice(1).forEach((mock, index) => expect(calledBefore(order[index], mock)).toBe(true));
    expect(mocks.getDraft).toHaveBeenCalledWith(12);
    expect(mocks.startDraft).toHaveBeenCalledWith(12);
    expect(mocks.updateDraft).toHaveBeenCalledWith("draft-1", 1, {}, SCHEDULE);
    expect(mocks.previewDraft).toHaveBeenCalledWith("draft-1", 2);
    expect(mocks.confirmDraft).toHaveBeenCalledWith("draft-1", 2, "srp_1", expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(mocks.discardDraft).not.toHaveBeenCalled();
  });

  it("discards an active draft of the same source before starting", async () => {
    const { api, mocks } = makeApi();
    mocks.getDraft.mockResolvedValue(state({ draft: draft({ id: "old-draft", draftVersion: 4, changes: { header: {} } }) }));

    await expect(run(api)).resolves.toMatchObject({ kind: "saved" });

    expect(mocks.discardDraft).toHaveBeenCalledWith("old-draft", 4);
    expect(calledBefore(mocks.getDraft, mocks.discardDraft)).toBe(true);
    expect(calledBefore(mocks.discardDraft, mocks.startDraft)).toBe(true);
  });

  it("reloads, touching nothing, when the source identity changed since the sheet opened", async () => {
    const { api, mocks } = makeApi();
    mocks.getDraft.mockResolvedValue(state({ sourceCaseVersion: 8 }));

    await expect(run(api)).resolves.toEqual({ kind: "source-changed" });

    expect(mocks.startDraft).not.toHaveBeenCalled();
    expect(mocks.discardDraft).not.toHaveBeenCalled();
  });

  it("aborts without touching a started draft that already has changes", async () => {
    const { api, mocks } = makeApi();
    mocks.startDraft.mockResolvedValue(state({ draft: draft({ changes: { sessions: [{ sessionIndex: 1 }] } }) }));

    await expect(run(api)).resolves.toEqual({ kind: "draft-in-use" });

    expect(mocks.updateDraft).not.toHaveBeenCalled();
    expect(mocks.discardDraft).not.toHaveBeenCalled();
  });

  it("aborts without touching a started draft of another source", async () => {
    const { api, mocks } = makeApi();
    mocks.startDraft.mockResolvedValue(state({ draft: draft({ sourceFingerprint: "other" }), sourceFingerprint: "other" }));

    await expect(run(api)).resolves.toEqual({ kind: "source-changed" });

    expect(mocks.updateDraft).not.toHaveBeenCalled();
    expect(mocks.discardDraft).not.toHaveBeenCalled();
  });

  it("reports a draft the server did not start", async () => {
    const { api, mocks } = makeApi();
    mocks.startDraft.mockResolvedValue(state({ draft: null }));

    await expect(run(api)).resolves.toEqual({ kind: "draft-start-failed" });
    expect(mocks.updateDraft).not.toHaveBeenCalled();
  });

  it("shows the preview's blocking reasons and discards the draft", async () => {
    const { api, mocks } = makeApi();
    mocks.previewDraft.mockResolvedValue({
      previewId: "srp_1", draftId: "draft-1", draftVersion: 2,
      blockingReasons: [{ code: "NON_SERVICE_DAY", sessionIndex: 4 }],
    });

    await expect(run(api)).resolves.toEqual({ kind: "blocked", reasons: [{ code: "NON_SERVICE_DAY", sessionIndex: 4 }] });

    expect(mocks.discardDraft).toHaveBeenCalledWith("draft-1", 2);
    expect(mocks.confirmDraft).not.toHaveBeenCalled();
  });

  it("treats a preview of another draft or version as a changed source and discards", async () => {
    const { api, mocks } = makeApi();
    mocks.previewDraft.mockResolvedValue({ previewId: "srp_1", draftId: "draft-1", draftVersion: 3, blockingReasons: [] });

    await expect(run(api)).resolves.toEqual({ kind: "source-changed" });
    expect(mocks.discardDraft).toHaveBeenCalledWith("draft-1", 2);
    expect(mocks.confirmDraft).not.toHaveBeenCalled();
  });

  describe("version conflicts", () => {
    it("retries the whole sequence once on a 409 when the source is unchanged", async () => {
      const { api, mocks } = makeApi();
      mocks.confirmDraft
        .mockRejectedValueOnce(axiosError(409, { code: VERSION_CONFLICT }))
        .mockResolvedValueOnce({ status: "confirmed", caseVersion: 9 });

      await expect(run(api)).resolves.toEqual({ kind: "saved", caseVersion: 9 });

      expect(mocks.getDraft).toHaveBeenCalledTimes(2);
      expect(mocks.startDraft).toHaveBeenCalledTimes(2);
      expect(mocks.confirmDraft).toHaveBeenCalledTimes(2);
    });

    it("reloads instead of retrying when the source changed in the meantime", async () => {
      const { api, mocks } = makeApi();
      mocks.updateDraft.mockRejectedValueOnce(axiosError(409, { code: VERSION_CONFLICT }));
      mocks.getDraft
        .mockResolvedValueOnce(state())
        .mockResolvedValueOnce(state({ sourceFingerprint: "fp-2" }));

      await expect(run(api)).resolves.toEqual({ kind: "source-changed" });
      expect(mocks.startDraft).toHaveBeenCalledTimes(1);
    });

    it("retries only once and then surfaces the error", async () => {
      const { api, mocks } = makeApi();
      mocks.confirmDraft.mockRejectedValue(axiosError(409, { code: VERSION_CONFLICT }));

      await expect(run(api)).rejects.toMatchObject({ response: { status: 409 } });
      expect(mocks.confirmDraft).toHaveBeenCalledTimes(2);
    });

    it("never retries a 409 that carries blockingReasons", async () => {
      const { api, mocks } = makeApi();
      mocks.confirmDraft.mockRejectedValue(
        axiosError(409, { code: "REQUEST_CONFLICT", blockingReasons: [{ code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 2 }] }),
      );

      await expect(run(api)).resolves.toEqual({
        kind: "blocked",
        reasons: [{ code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 2 }],
      });
      expect(mocks.confirmDraft).toHaveBeenCalledTimes(1);
      expect(mocks.startDraft).toHaveBeenCalledTimes(1);
      expect(mocks.discardDraft).toHaveBeenCalledWith("draft-1", 2);
    });

    it.each(["contract_period", "receipt_refresh", "record_snapshot"] as const)(
      "never retries a 409 whose earlier edit is still running (%s)",
      async (operation) => {
        const { api, mocks } = makeApi();
        mocks.confirmDraft.mockRejectedValue(
          axiosError(409, {
            code: "SERVICE_RECORD_WRITE_TARGET_CHANGED",
            blockingOperation: { operation, status: "PENDING", lastErrorCode: null },
          }),
        );

        await expect(run(api)).rejects.toMatchObject({ response: { status: 409 } });

        expect(mocks.confirmDraft).toHaveBeenCalledTimes(1);
        expect(mocks.startDraft).toHaveBeenCalledTimes(1);
        expect(mocks.getDraft).toHaveBeenCalledTimes(1);
        expect(mocks.discardDraft).toHaveBeenCalledWith("draft-1", 2);
      },
    );

    it.each([
      ["a draft that is no longer open", { code: "REQUEST_NOT_PENDING" }],
      ["a preview that no longer matches", { code: "REQUEST_STALE" }],
      ["a conflict without extensions", { code: "REQUEST_CONFLICT" }],
      ["an unknown code", { code: "SOMETHING_NEW" }],
      ["a body without a code", {}],
    ])("confirms exactly once for a 409 that is %s, not a version conflict", async (_name, body) => {
      const { api, mocks } = makeApi();
      mocks.confirmDraft.mockRejectedValue(axiosError(409, body));

      await expect(run(api)).rejects.toMatchObject({ response: { status: 409 } });

      expect(mocks.confirmDraft).toHaveBeenCalledTimes(1);
      expect(mocks.startDraft).toHaveBeenCalledTimes(1);
      expect(mocks.getDraft).toHaveBeenCalledTimes(1);
    });

    it("does not retry a version-conflict code on a status other than 409", async () => {
      const { api, mocks } = makeApi();
      mocks.confirmDraft.mockRejectedValue(axiosError(500, { code: VERSION_CONFLICT }));

      await expect(run(api)).rejects.toMatchObject({ response: { status: 500 } });
      expect(mocks.confirmDraft).toHaveBeenCalledTimes(1);
    });

    it("never retries a 409 that carries a schedule code", async () => {
      const { api, mocks } = makeApi();
      mocks.updateDraft.mockRejectedValue(axiosError(409, { code: "REQUEST_CONFLICT", scheduleCode: "SCHEDULE_WITH_DATE_MOVE" }));

      await expect(run(api)).rejects.toMatchObject({ response: { status: 409 } });
      expect(mocks.startDraft).toHaveBeenCalledTimes(1);
    });

    it("does not retry other failures and cleans up the draft it started", async () => {
      const { api, mocks } = makeApi();
      mocks.updateDraft.mockRejectedValue(axiosError(400, { scheduleCode: "SCHEDULE_COUNT_MISMATCH" }));

      await expect(run(api)).rejects.toMatchObject({ response: { status: 400 } });
      expect(mocks.startDraft).toHaveBeenCalledTimes(1);
      expect(mocks.discardDraft).toHaveBeenCalledWith("draft-1", 1);
    });
  });
});

describe("helpers", () => {
  it("compares a source by fingerprint and case version, and never trusts an empty fingerprint", () => {
    expect(sameScheduleSource(SOURCE, state())).toBe(true);
    expect(sameScheduleSource(SOURCE, state({ sourceCaseVersion: 8 }))).toBe(false);
    expect(sameScheduleSource({ sourceFingerprint: "", sourceCaseVersion: 7 }, state({ sourceFingerprint: "" }))).toBe(false);
  });

  it("creates an RFC 4122 v4 idempotency key", () => {
    expect(createIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
