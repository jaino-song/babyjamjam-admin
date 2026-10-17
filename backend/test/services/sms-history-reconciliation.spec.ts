import { MessageLogEntity } from "domain/entities/message-log.entity";
import {
    ALIGO_HISTORY_ABSENT_AUTO_RESEND,
    lookupAligoHistory,
    decideAligoHistoryOutcome,
    isAligoHistoryEligible,
    ALIGO_HISTORY_PAGE_CAP,
    ALIGO_HISTORY_SMS_CALL_CAP,
} from "application/services/sms-history-reconciliation.lookup";
import { SmsHistoryReconciliationService } from "application/services/sms-history-reconciliation.service";
import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";
import { IAligoSmsApiPort } from "domain/ports/aligo-sms-api.port";
import { SystemSettingService } from "application/services/system-setting.service";
import { SchedulerLeaseService } from "application/services/scheduler-lease.service";
import { MessageRetrySchedulerService } from "application/services/message-retry-scheduler.service";
import { SmsRetryService } from "application/services/sms-retry.service";

const started = new Date("2026-10-12T01:00:00.000Z");
function log(): MessageLogEntity {
    const row = MessageLogEntity.create({ provider: "aligo_sms", templateKey: "test", receiver: "01012345678",
        messageBody: "안녕하세요", variables: {}, branchId: "branch", triggerJobId: "job" });
    row.providerAcceptanceState = "uncertain";
    row.providerCallStartedAt = started;
    row.attempts = 1;
    return row;
}
const success = (list: unknown[], next_yn = "N") => ({ result_code: 1, message: "ok", list, next_yn });
function port(state = "발송완료") {
    return {
        listHistory: jest.fn().mockResolvedValue(success([
            { mid: "before", msg: "other", reg_date: "2026-10-12 09:58:00" },
            { mid: "ours", msg: "안녕하세요", reg_date: "2026-10-12 10:01:00" },
            { mid: "after", msg: "other", reg_date: "2026-10-12 10:06:00" },
        ])),
        listSmsHistory: jest.fn().mockResolvedValue(success([{ receiver: "010-1234-5678", sms_state: state }])),
    };
}
describe("Aligo history lookup", () => {
    it("ships absent auto-resend off", () => expect(ALIGO_HISTORY_ABSENT_AUTO_RESEND).toBe(false));
    it.each(["발송완료", "전송중"])("known mid %s is delivered", async state => {
        const row = log(); row.aligoMid = "ours";
        expect(await lookupAligoHistory(row, port(state), async () => new Set())).toEqual({ kind: "DELIVERED", mid: "ours" });
    });
    it("known mid 가입자없음 is no subscriber", async () => {
        const row = log(); row.aligoMid = "ours";
        expect((await lookupAligoHistory(row, port("가입자없음"), async () => new Set())).kind).toBe("NO_SUBSCRIBER");
    });
    it.each([{ list: [] }, { list: [{ receiver: "01099999999", sms_state: "발송완료" }] }])("known mid never absent (%j)", async ({ list }) => {
        const row = log(); row.aligoMid = "ours"; const api = port();
        api.listSmsHistory.mockResolvedValue(success(list));
        expect((await lookupAligoHistory(row, api, async () => new Set())).kind).toBe("INCONCLUSIVE");
    });
    it("unknown state is inconclusive", async () => {
        expect((await lookupAligoHistory(log(), port("unknown"), async () => new Set())).kind).toBe("INCONCLUSIVE");
    });
    it("matching text discovers mid", async () => {
        expect(await lookupAligoHistory(log(), port(), async () => new Set())).toEqual({ kind: "DELIVERED", mid: "ours" });
    });
    it("matching text and receiver discovers a no-subscriber mid", async () => {
        expect(await lookupAligoHistory(log(), port("가입자없음"), async () => new Set())).toEqual({ kind: "NO_SUBSCRIBER", mid: "ours" });
    });
    it.each([
        { body: "%고객명%님 안녕하세요", msg: "고객님 안녕하세요", name: "고객" },
        { body: " 첫째\r\n둘째 ", msg: "첫째\n둘째", name: null },
    ])("matches substitution and normalized newlines (%j)", async ({ body, msg, name }) => {
        const row = log(); row.messageBody = body; row.recipientName = name;
        const api = port(); api.listHistory.mockResolvedValue(success([{ mid: "ours", msg, reg_date: "2026-10-12 10:01:00" }]));
        expect(await lookupAligoHistory(row, api, async () => new Set())).toEqual({ kind: "DELIVERED", mid: "ours" });
    });
    it("ignores a mid already owned by another row", async () => {
        const api = port();
        expect((await lookupAligoHistory(log(), api, async () => new Set(["ours"]))).kind).toBe("ABSENT");
        expect(api.listSmsHistory).not.toHaveBeenCalled();
    });
    it("queries both KST dates at midnight", async () => {
        const row = log(); row.providerCallStartedAt = new Date("2026-10-11T15:00:00Z");
        const api = port(); api.listHistory.mockResolvedValue(success([]));
        await lookupAligoHistory(row, api, async () => new Set());
        expect(api.listHistory.mock.calls.map(call => call[0].start_date)).toEqual(["20261011", "20261012"]);
    });
    it.each([{ list: [] }, { list: [{ receiver: "010****5678", sms_state: "발송완료" }] }])("empty or masked history never proves absence (%j)", async ({ list }) => {
        const api = port(); api.listSmsHistory.mockResolvedValue(success(list));
        expect((await lookupAligoHistory(log(), api, async () => new Set())).kind).toBe("INCONCLUSIVE");
    });
    it("fully paginates receiver history before deciding", async () => {
        const row = log(); row.aligoMid = "ours"; const api = port();
        api.listSmsHistory.mockResolvedValueOnce(success([{ receiver: "01099999999", sms_state: "발송완료" }], "Y"))
            .mockResolvedValueOnce(success([{ receiver: row.receiver, sms_state: "전송중" }]));
        expect((await lookupAligoHistory(row, api, async () => new Set())).kind).toBe("DELIVERED");
        expect(api.listSmsHistory).toHaveBeenCalledTimes(2);
    });
    it("page cap voids a positive matching first page", async () => {
        const row = log(); row.aligoMid = "ours"; const api = port();
        api.listSmsHistory.mockResolvedValue(success([{ receiver: row.receiver, sms_state: "발송완료" }], "Y"));
        expect((await lookupAligoHistory(row, api, async () => new Set())).kind).toBe("INCONCLUSIVE");
        expect(api.listSmsHistory).toHaveBeenCalledTimes(ALIGO_HISTORY_PAGE_CAP);
    });
    it("send list page cap prevents absence", async () => {
        const api = port(); api.listHistory.mockResolvedValue(success([], "Y"));
        expect((await lookupAligoHistory(log(), api, async () => new Set())).kind).toBe("INCONCLUSIVE");
        expect(api.listHistory).toHaveBeenCalledTimes(ALIGO_HISTORY_PAGE_CAP);
    });
    it("per lookup sms call cap prevents absence", async () => {
        const api = port(); api.listHistory.mockResolvedValue(success(Array.from({ length: ALIGO_HISTORY_SMS_CALL_CAP + 1 }, (_, i) => ({ mid: String(i), msg: "other", reg_date: "2026-10-12 10:01:00" }))));
        api.listSmsHistory.mockResolvedValue(success([{ receiver: "01099999999", sms_state: "발송완료" }]));
        expect((await lookupAligoHistory(log(), api, async () => new Set())).kind).toBe("INCONCLUSIVE");
        expect(api.listSmsHistory).toHaveBeenCalledTimes(ALIGO_HISTORY_SMS_CALL_CAP);
    });
    it.each([null, {}, { result_code: -1, message: "no" }, { result_code: 1, message: "ok", list: [] }, success([{ mid: "bad", msg: "text", reg_date: "not a date" }])])("malformed or negative call is inconclusive (%j)", async body => {
        const api = port(); api.listHistory.mockResolvedValue(body);
        expect((await lookupAligoHistory(log(), api, async () => new Set())).kind).toBe("INCONCLUSIVE");
    });
    it("transport failures are inconclusive", async () => {
        const api = port(); api.listHistory.mockRejectedValue(new Error("HTTP failure"));
        expect((await lookupAligoHistory(log(), api, async () => new Set())).kind).toBe("INCONCLUSIVE");
    });
    it.each([null, "not JSON", { result_code: -1, message: "failure" }, {}])("failed receiver-history body cannot deliver (%j)", async body => {
        const row = log(); row.aligoMid = "ours"; const api = port(); api.listSmsHistory.mockResolvedValue(body);
        expect((await lookupAligoHistory(row, api, async () => new Set())).kind).toBe("INCONCLUSIVE");
    });
    it("a receiver-history transport failure voids a matching send entry", async () => {
        const api = port(); api.listSmsHistory.mockRejectedValue(new Error("HTTP failure"));
        expect((await lookupAligoHistory(log(), api, async () => new Set())).kind).toBe("INCONCLUSIVE");
    });
    it("times out a nonresponding port", async () => {
        jest.useFakeTimers();
        try {
            const api = port(); api.listHistory.mockImplementation(() => new Promise(() => {}));
            const lookup = lookupAligoHistory(log(), api, async () => new Set());
            await jest.advanceTimersByTimeAsync(10_000);
            expect((await lookup).kind).toBe("INCONCLUSIVE");
        } finally { jest.useRealTimers(); }
    });
    it("same receiver different text is inconclusive", async () => {
        const row = log(); row.messageBody = "different";
        expect((await lookupAligoHistory(row, port(), async () => new Set())).kind).toBe("INCONCLUSIVE");
    });
    it("requires coverage before absence", async () => {
        const api = port(); api.listHistory.mockResolvedValue(success([]));
        expect((await lookupAligoHistory(log(), api, async () => new Set())).kind).toBe("INCONCLUSIVE");
    });
    it("requires two absence confirmations five minutes apart and fifteen minutes after start", () => {
        const row = log(); const first = new Date(started.getTime() + 10 * 60_000);
        expect(decideAligoHistoryOutcome(row, { kind: "ABSENT" }, first, true, true).outcome).toBeNull();
        row.variables["historyLookupAbsentAt"] = first.toISOString();
        expect(decideAligoHistoryOutcome(row, { kind: "ABSENT" }, new Date(first.getTime() + 4 * 60_000), true, true).outcome).toBeNull();
        expect(decideAligoHistoryOutcome(row, { kind: "ABSENT" }, new Date(first.getTime() + 5 * 60_000), true, true).retry).toBe("schedule");
        expect(decideAligoHistoryOutcome(row, { kind: "ABSENT" }, new Date(first.getTime() + 5 * 60_000), true, false).retry).toBe("none");
    });
    it("bracketed history with only other receivers proves one absence", async () => {
        const api = port(); api.listSmsHistory.mockResolvedValue(success([{ receiver: "01099999999", sms_state: "발송완료" }]));
        expect((await lookupAligoHistory(log(), api, async () => new Set())).kind).toBe("ABSENT");
    });
    it.each(["INCONCLUSIVE", "DELIVERED", "NO_SUBSCRIBER"] as const)("%s clears absence streak", kind => {
        const row = log(); row.variables["historyLookupAbsentAt"] = started.toISOString();
        const result = kind === "INCONCLUSIVE" ? { kind } : { kind, mid: "ours" };
        expect(decideAligoHistoryOutcome(row, result, new Date(started.getTime() + 20 * 60_000), false).variables["historyLookupAbsentAt"]).toBeUndefined();
    });
    it("confirmation before fifteen minutes remains pending despite five minute spacing", () => {
        const row = log(); row.variables["historyLookupAbsentAt"] = new Date(started.getTime() + 5 * 60_000).toISOString();
        expect(decideAligoHistoryOutcome(row, { kind: "ABSENT" }, new Date(started.getTime() + 10 * 60_000), true, true).outcome).toBeNull();
    });
    it.each(["false", "manual", "exhausted", "policy off", "null branch"])("confirmed absence does not retry for %s", condition => {
        const row = log(); row.variables["historyLookupAbsentAt"] = new Date(started.getTime() + 5 * 60_000).toISOString();
        if (condition === "manual") row.triggerJobId = null;
        if (condition === "exhausted") row.attempts = 3;
        if (condition === "null branch") row.branchId = null;
        const decision = decideAligoHistoryOutcome(row, { kind: "ABSENT" }, new Date(started.getTime() + 20 * 60_000), condition !== "policy off", condition !== "false");
        row.reconcileProviderOutcome({ outcome: decision.outcome!, actor: "system:aligo-history", reason: decision.reason, retry: decision.retry });
        expect(row.status).toBe("failed"); expect(row.nextRetryAt).toBeNull(); expect(row.errorMessage).toBe("발송 실패: 응답 없음");
    });
    it("true schedules confirmed absence only for an eligible trigger", () => {
        const row = log(); row.variables["historyLookupAbsentAt"] = started.toISOString();
        const decision = decideAligoHistoryOutcome(row, { kind: "ABSENT" }, new Date(started.getTime() + 20 * 60_000), true, true);
        row.reconcileProviderOutcome({ outcome: decision.outcome!, actor: "system:aligo-history", reason: decision.reason, retry: decision.retry });
        expect(row.nextRetryAt).not.toBeNull();
    });
    it("shipping default confirmed absence cannot create a due retry", () => {
        const row = log(); row.variables["historyLookupAbsentAt"] = started.toISOString();
        const decision = decideAligoHistoryOutcome(row, { kind: "ABSENT" }, new Date(started.getTime() + 20 * 60_000), true);
        row.reconcileProviderOutcome({ outcome: decision.outcome!, actor: "system:aligo-history", reason: decision.reason, retry: decision.retry });
        expect(row.nextRetryAt).toBeNull(); expect(row.status).toBe("failed"); expect(row.errorMessage).toBe("발송 실패: 응답 없음");
    });
    it("a newly created retry attempt carries none of the history bookkeeping", () => {
        const row = log(); row.variables = { title: "title", historyLookup: "checking", historyLookupAt: started.toISOString(), historyLookupFailures: "2", historyLookupAbsentAt: started.toISOString() };
        // Exercise the actual retry-attempt factory without a provider or database boundary.
        const retry = Object.create(SmsRetryService.prototype) as { createRetryAttempt(source: MessageLogEntity): MessageLogEntity };
        const next = retry.createRetryAttempt(row);
        for (const key of ["historyLookup", "historyLookupAt", "historyLookupFailures", "historyLookupAbsentAt"]) expect(next.variables[key]).toBeUndefined();
        expect(next.variables["title"]).toBe("title"); expect(next.attempts).toBe(row.attempts);
    });
    it("no subscriber is failed permanently even with resend on", () => {
        const row = log(); const decision = decideAligoHistoryOutcome(row, { kind: "NO_SUBSCRIBER", mid: "ours" }, new Date(), true, true);
        row.reconcileProviderOutcome({ outcome: decision.outcome!, actor: "system:aligo-history", reason: decision.reason, retry: decision.retry });
        expect(row.status).toBe("failed"); expect(row.errorMessage).toBe("발송 실패: 잘못된 번호"); expect(row.nextRetryAt).toBeNull();
    });
    it("manual reconciliation keeps default schedule", () => {
        const row = log(); row.variables["historyLookup"] = "checking";
        row.reconcileProviderOutcome({ outcome: "not-delivered", actor: "operator", reason: "checked" });
        expect(row.nextRetryAt).not.toBeNull();
        expect(row.variables["historyLookup"]).toBeUndefined();
    });
    it("three stale started rounds reach attempt limit without resetting count", () => {
        const row = log(); row.attempts = 0;
        for (let i = 0; i < 3; i++) {
            row.providerAcceptanceState = "started";
            row.markStaleStartedAsUncertain(new Date(started.getTime() + 6 * 60_000));
            expect(() => row.markStaleStartedAsUncertain(new Date(started.getTime() + 6 * 60_000))).toThrow();
        }
        expect(row.attempts).toBe(3); expect(row.canRetry()).toBe(false);
    });
    it.each([null, new Date(started.getTime() - 25 * 60 * 60_000), new Date(started.getTime() + 19 * 60_000)])("does not transition an ineligible started timestamp %s", providerCallStartedAt => {
        const row = log(); row.providerAcceptanceState = "started"; row.providerCallStartedAt = providerCallStartedAt;
        const before = JSON.stringify(row);
        expect(() => row.markStaleStartedAsUncertain(new Date(started.getTime() + 20 * 60_000))).toThrow();
        expect(JSON.stringify(row)).toBe(before);
    });
});

describe("Aligo history service and eligibility", () => {
    const now = new Date(started.getTime() + 20 * 60_000);
    const cases: Array<[string, (row: MessageLogEntity) => void]> = [
        ["partial", row => { row.variables["retrySafety"] = "partial"; }],
        ["multiple receivers", row => { row.receiver += ",01099999999"; }],
        ["scheduled", row => { row.variables["scheduledDate"] = "20261012"; }],
        ["test mode", row => { row.variables["testMode"] = "true"; }],
        ["young", row => { row.providerCallStartedAt = new Date(now.getTime() - 4 * 60_000); }],
        ["over age", row => { row.providerCallStartedAt = new Date(now.getTime() - 24 * 60 * 60_000 - 1); }],
        ["null started date", row => { row.providerCallStartedAt = null; }],
        ["exhausted", row => { row.variables["historyLookup"] = "exhausted"; }],
        ["other provider", row => { row.provider = "other"; }],
        ["MMS", row => { row.variables["msgType"] = "MMS"; }],
        ["recent lookup", row => { row.variables["historyLookupAt"] = now.toISOString(); }],
    ];
    function setup(row: MessageLogEntity) {
        const repo = {
            findAligoHistoryCandidatesSystemScope: jest.fn().mockResolvedValue([row]),
            findAligoMidsStoredOnOtherLogs: jest.fn().mockResolvedValue(new Set()),
            claimAligoHistoryBookkeeping: jest.fn().mockImplementation(async (source: MessageLogEntity) => source),
            reconcileProviderAttempt: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
        };
        const api = port();
        const policy = { getMessageSettingsPolicyEnabled: jest.fn().mockResolvedValue(true) };
        const service = new SmsHistoryReconciliationService(repo as unknown as IMessageLogRepository,
            api as unknown as IAligoSmsApiPort, policy as unknown as SystemSettingService,
            { holdsLease: () => true } as SchedulerLeaseService);
        return { repo, api, service, policy };
    }
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
    afterEach(() => jest.useRealTimers());
    it.each(cases)("%s makes no call or write", async (_, mutate) => {
        const row = log(); mutate(row); const snapshot = JSON.stringify(row); const { service, repo, api } = setup(row);
        expect(isAligoHistoryEligible(row, now)).toBe(false);
        await service.reconcile();
        expect(api.listHistory).not.toHaveBeenCalled(); expect(api.listSmsHistory).not.toHaveBeenCalled();
        expect(repo.claimAligoHistoryBookkeeping).not.toHaveBeenCalled(); expect(JSON.stringify(row)).toBe(snapshot);
    });
    it.each(["pending", "failed"] as const)("uncertain %s is looked up irrespective of policy", async status => {
        const row = log(); row.status = status; row.aligoMid = "ours";
        const { service, repo } = setup(row); await service.reconcile();
        expect(repo.reconcileProviderAttempt).toHaveBeenCalledWith(row, "delivered", "system:aligo-history", expect.any(String), "ours", expect.objectContaining({ expectedUpdatedAt: row.updatedAt }));
        expect(repo.update).not.toHaveBeenCalled();
    });
    it("a lost lookup reservation makes no port call", async () => {
        const { service, repo, api } = setup(log()); repo.claimAligoHistoryBookkeeping.mockResolvedValue(null);
        await service.reconcile(); expect(api.listHistory).not.toHaveBeenCalled();
    });
    it("stale started is transitioned once without looking up this tick", async () => {
        const row = log(); row.providerAcceptanceState = "started";
        const { service, repo, api } = setup(row); await service.reconcile();
        expect(row.attempts).toBe(2); expect(row.providerAcceptanceState).toBe("uncertain");
        expect(repo.claimAligoHistoryBookkeeping).toHaveBeenCalledTimes(1); expect(api.listHistory).not.toHaveBeenCalled();
    });
    it("three inconclusive results exhaust the row and fourth tick does nothing", async () => {
        const row = log(); const { service, api } = setup(row); api.listHistory.mockResolvedValue({ result_code: -1, message: "unavailable" });
        for (let tick = 0; tick < 4; tick++) { jest.setSystemTime(new Date(now.getTime() + tick * 5 * 60_000)); await service.reconcile(); }
        expect(row.variables["historyLookup"]).toBe("exhausted"); expect(api.listHistory).toHaveBeenCalledTimes(3);
        expect(row.providerAcceptanceState).toBe("uncertain");
    });
    it("first absent only records streak and does not count failure or retry", async () => {
        const row = log(); const { service, api, repo } = setup(row);
        api.listSmsHistory.mockResolvedValue(success([{ receiver: "01099999999", sms_state: "발송완료" }]));
        await service.reconcile();
        expect(row.variables["historyLookupAbsentAt"]).toBe(now.toISOString()); expect(row.variables["historyLookupFailures"]).toBeUndefined();
        expect(row.nextRetryAt).toBeNull(); expect(repo.reconcileProviderAttempt).not.toHaveBeenCalled();
    });
    it("history lookup still runs when the branch retry policy is off", async () => {
        const { service, api, policy } = setup(log()); policy.getMessageSettingsPolicyEnabled.mockResolvedValue(false);
        api.listSmsHistory.mockResolvedValue(success([{ receiver: "01099999999", sms_state: "발송완료" }]));
        await service.reconcile(); expect(api.listHistory).toHaveBeenCalledTimes(1);
        expect(policy.getMessageSettingsPolicyEnabled).not.toHaveBeenCalled();
    });
    it("shipping service confirms absent twice but requests no retry row", async () => {
        const row = log(); const { service, api, repo } = setup(row);
        api.listSmsHistory.mockResolvedValue(success([{ receiver: "01099999999", sms_state: "발송완료" }]));
        await service.reconcile(); jest.setSystemTime(new Date(now.getTime() + 5 * 60_000)); await service.reconcile();
        expect(repo.reconcileProviderAttempt).toHaveBeenCalledTimes(1);
        expect(repo.reconcileProviderAttempt).toHaveBeenCalledWith(row, "not-delivered", "system:aligo-history", "발송 실패: 응답 없음", undefined, expect.objectContaining({ retry: "none", variables: {} }));
        expect(repo.update).not.toHaveBeenCalled();
    });
    it("stops starting new rows after the two minute tick budget", async () => {
        const row = log(); row.aligoMid = "ours";
        const { service, repo, api } = setup(row); repo.findAligoHistoryCandidatesSystemScope.mockResolvedValue([row, log()]);
        api.listSmsHistory.mockImplementation(async () => { jest.setSystemTime(new Date(now.getTime() + 120_000)); return success([{ receiver: row.receiver, sms_state: "발송완료" }]); });
        await service.reconcile(); expect(repo.claimAligoHistoryBookkeeping).toHaveBeenCalledTimes(1); expect(api.listHistory).not.toHaveBeenCalled();
        expect(repo.findAligoHistoryCandidatesSystemScope).toHaveBeenCalledWith(now, 10);
    });
    it("terminal delivered removes every bookkeeping key in the reconciliation claim", async () => {
        const row = log(); row.aligoMid = "ours"; row.variables = { historyLookup: "checking", historyLookupAt: started.toISOString(), historyLookupFailures: "1", historyLookupAbsentAt: started.toISOString() };
        const { service, repo } = setup(row); await service.reconcile();
        const options = repo.reconcileProviderAttempt.mock.calls[0][5];
        expect(options.variables).toEqual({}); expect(options.retry).toBe("none");
    });
    it("scheduler invokes history even when there are no retries", async () => {
        const history = { reconcile: jest.fn().mockResolvedValue(undefined) };
        const repo = { findPendingRetriesSystemScope: jest.fn().mockResolvedValue([]) };
        const scheduler = new MessageRetrySchedulerService(repo as unknown as IMessageLogRepository, {} as SmsRetryService,
            { holdsLease: () => true } as SchedulerLeaseService, undefined, history as unknown as SmsHistoryReconciliationService);
        await scheduler.retryFailedMessages(); expect(history.reconcile).toHaveBeenCalledTimes(1); expect(repo.findPendingRetriesSystemScope).toHaveBeenCalledTimes(1);
    });
    it("a throwing history step does not stop automatic retry", async () => {
        const row = log(); row.providerAcceptanceState = "reconciled_not_delivered";
        const history = { reconcile: jest.fn().mockRejectedValue(new Error("broken")) };
        const retry = { retry: jest.fn() };
        const scheduler = new MessageRetrySchedulerService({ findPendingRetriesSystemScope: async () => [row] } as unknown as IMessageLogRepository,
            retry as unknown as SmsRetryService, { holdsLease: () => true } as SchedulerLeaseService, undefined, history as unknown as SmsHistoryReconciliationService);
        await scheduler.retryFailedMessages(); expect(retry.retry).toHaveBeenCalledWith(row, "automatic");
    });
});
