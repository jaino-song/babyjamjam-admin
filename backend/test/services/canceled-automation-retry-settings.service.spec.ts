import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { CanceledAutomationRetrySettingsService } from "application/services/canceled-automation-retry-settings.service";
import type { CanceledRetryRule, ICanceledAutomationRetryRepository } from "domain/repositories/canceled-automation-retry.repository.interface";

const branch = "branch-A";
const transaction = {} as Parameters<ICanceledAutomationRetryRepository["lockRule"]>[2];
const fixedEpoch = new Date("2026-11-23T01:02:03.123Z");

function rule(id: string, fields: Partial<CanceledRetryRule> = {}): CanceledRetryRule {
    return {
        id, name: id, branchId: branch, templateKey: "INFO", recipientType: "CLIENT",
        group: null, isActive: true, canceledRetryEnabledAt: null, branchOverrides: [], ...fields,
    };
}

describe("canceled automation retry catalog and settings", () => {
    const repository: jest.Mocked<ICanceledAutomationRetryRepository> = {
        list: jest.fn(), lockRule: jest.fn(), lockGroupRules: jest.fn(), updateEpoch: jest.fn(),
    };
    const runExclusive = jest.fn((_branch, work) => work(transaction));
    const getTriggerDispatchEnabled = jest.fn();
    const service = new CanceledAutomationRetrySettingsService(
        repository,
        { runExclusive } as unknown as MessageAutomationBranchLockService,
        { getTriggerDispatchEnabled } as unknown as MessageAutomationActivationService,
    );

    beforeEach(() => {
        jest.resetAllMocks();
        runExclusive.mockImplementation((_branch, work) => work(transaction));
        getTriggerDispatchEnabled.mockResolvedValue(true);
    });

    const recordLink = rule("system:service_record_link", { branchId: null, templateKey: "SERVICE_RECORD_LINK", recipientType: "PRIMARY_EMPLOYEE" });
    const unsupported = rule("custom-unknown", { templateKey: "UNKNOWN" });
    const disabled = rule("disabled-local", { isActive: false });
    const manual = rule("system:service_end_notice", { branchId: null, templateKey: "SERVICE_END_NOTICE" });
    const retired = rule("retired-local", { templateKey: "CLIENT_WELCOME" });
    const employeeGroup = { id: "employee-notice", name: "제공인력 안내", recipientMode: "BOTH_EMPLOYEES" };
    const employeeRules = [
        rule("employee-secondary", {
            group: employeeGroup, name: employeeGroup.name, recipientType: "SECONDARY_EMPLOYEE", templateKey: "CAREGIVER_SERVICE_END_NOTICE",
        }),
        rule("employee-primary", {
            group: employeeGroup, name: employeeGroup.name, recipientType: "PRIMARY_EMPLOYEE", templateKey: "CAREGIVER_SERVICE_START_NOTICE",
        }),
    ];

    it("lists only persisted automation routines and projects branch overrides", async () => {
        const normal = [
            rule("local-info"),
            rule("shared-info", { branchId: null, canceledRetryEnabledAt: fixedEpoch }),
            rule("configured-custom", { templateKey: "SURVEY", name: "고객 만족도 확인", canceledRetryEnabledAt: fixedEpoch }),
            disabled,
            rule("disabled-shared", { branchId: null, branchOverrides: [{ isActive: false, canceledRetryEnabledAt: null }] }),
            unsupported,
        ];
        const excluded = [
            manual, retired,
            rule("system:manual-sms:branch-A"),
            rule("agent-sms:branch-A"),
            rule("system:message_automation_intent"),
            rule("legacy-manual-key", { templateKey: "MANUAL_SMS" }),
            rule("pretend-record-link", { templateKey: "SERVICE_RECORD_LINK" }),
        ];
        repository.list.mockResolvedValueOnce([...normal, ...excluded, recordLink]).mockResolvedValueOnce([...normal, ...excluded]);
        const catalog = await service.list(branch);
        expect(catalog.map(({ id, eligible, unavailableReason, enabled }) => [id, eligible, unavailableReason, enabled])).toEqual([
            ["local-info", true, null, false],
            ["shared-info", true, null, false],
            ["configured-custom", true, null, true],
            ["disabled-local", false, "routine_disabled", false],
            ["disabled-shared", false, "routine_disabled", false],
            ["custom-unknown", false, "unsupported", false],
            ["system:service_record_link", true, null, false],
        ]);
        expect(catalog[2]).toMatchObject({ label: "고객 만족도 확인", enabledAt: fixedEpoch.toISOString() });
        expect((await service.list(branch)).map(({ id }) => id)).toEqual([
            "local-info", "shared-info", "configured-custom", "disabled-local", "disabled-shared", "custom-unknown",
        ]);
        expect(repository.list).toHaveBeenCalledWith(branch);
    });

    it("lists both employee projections as one unsupported routine with a stable group ID", async () => {
        const other = rule("other-employee", {
            name: employeeGroup.name,
            group: { id: "other-employee-notice", name: "다른 제공인력 안내", recipientMode: "PRIMARY_EMPLOYEE" },
            recipientType: "PRIMARY_EMPLOYEE",
        });
        repository.list.mockResolvedValueOnce([...employeeRules, other]).mockResolvedValueOnce([...employeeRules].reverse());
        const employeeRoutine = {
            id: "group:employee-notice",
            label: "제공인력 안내",
            recoverableReasons: [],
            eligible: false,
            unavailableReason: "unsupported",
            enabled: false,
            enabledAt: null,
        };
        expect(await service.list(branch)).toEqual([
            employeeRoutine,
            expect.objectContaining({ id: "group:other-employee-notice", label: "다른 제공인력 안내" }),
        ]);
        expect(await service.list(branch)).toEqual([employeeRoutine]);
    });

    it("rejects writes to the employee group at the routine ID returned by the catalog", async () => {
        repository.lockGroupRules.mockResolvedValueOnce(employeeRules);
        await expect(service.update(branch, "group:employee-notice", true)).rejects.toMatchObject({ status: 409 });
        expect(repository.lockGroupRules).toHaveBeenCalledWith(branch, "employee-notice", transaction);
        expect(repository.lockRule).not.toHaveBeenCalled();
        expect(repository.updateEpoch).not.toHaveBeenCalled();
    });

    it("resolves an eligible client routine ID to its existing rule for storage", async () => {
        const client = rule("client-child", {
            group: { id: "client-notice", name: "고객 안내", recipientMode: "CLIENT" },
        });
        repository.list.mockResolvedValueOnce([client]);
        repository.lockGroupRules.mockResolvedValueOnce([client]);
        repository.updateEpoch.mockResolvedValueOnce(fixedEpoch);

        const [routine] = await service.list(branch);
        expect(routine).toMatchObject({ id: "group:client-notice", label: "고객 안내", eligible: true, enabled: false });
        expect(await service.update(branch, "group:client-notice", true)).toEqual({
            ...routine, enabled: true, enabledAt: fixedEpoch.toISOString(),
        });
        expect(repository.lockGroupRules).toHaveBeenCalledWith(branch, "client-notice", transaction);
        expect(repository.updateEpoch).toHaveBeenCalledWith(transaction, branch, client, true);
    });

    it("rejects a group with no visible rules in the current branch", async () => {
        repository.lockGroupRules.mockResolvedValueOnce([]);
        await expect(service.update(branch, "group:foreign-or-deleted", true)).rejects.toMatchObject({ status: 404 });
        expect(repository.updateEpoch).not.toHaveBeenCalled();
    });

    it.each([
        ["CLIENT_GREETING", ["target_client_status_not_met"]],
        ["PRICE_INFO", ["target_client_status_not_met"]],
        ["SERVICE_INFO", ["target_client_status_not_met"]],
        ["REMINDER", ["target_client_status_not_met"]],
        ["THANKS", ["target_client_status_not_met"]],
        ["SURVEY", ["target_client_status_not_met"]],
        ["INFO", ["target_client_status_not_met"]],
        ["SERVICE_END_NOTICE", ["target_client_status_not_met", "live_unsigned_contract", "missing_birthday", "missing_current_contract", "current_contract_pdf_pending"]],
        ["SERVICE_RECORD_LINK", ["pre_booking"]],
        ["CAREGIVER_SERVICE_START_NOTICE", []],
        ["CAREGIVER_SERVICE_END_NOTICE", []],
        ["UNKNOWN", []],
    ])("defines the exact recoverable reasons for %s", async (templateKey, expected) => {
        const row = templateKey === "SERVICE_RECORD_LINK" ? recordLink : rule("test-template", { templateKey });
        repository.list.mockResolvedValueOnce([row]);
        expect(await service.list(branch)).toEqual([expect.objectContaining({
            recoverableReasons: expected,
            eligible: expected.length > 0,
            unavailableReason: expected.length ? null : "unsupported",
            enabled: false,
            enabledAt: null,
        })]);
    });

    it("requires a supported client-targeted generic rule and branch dispatch", async () => {
        repository.list.mockResolvedValueOnce([rule("employee-info", { recipientType: "PRIMARY_EMPLOYEE" }), rule("targeted-info")]);
        getTriggerDispatchEnabled.mockResolvedValueOnce(false);
        expect(await service.list(branch)).toEqual([
            expect.objectContaining({ id: "employee-info", recoverableReasons: [], unavailableReason: "unsupported" }),
            expect.objectContaining({ id: "targeted-info", unavailableReason: "dispatch_disabled" }),
        ]);
    });

    it.each([disabled, unsupported, manual, retired, rule("agent-sms:branch-A"), null])(
        "rejects ineligible or hidden routine %j without writing", async (row) => {
            repository.lockRule.mockResolvedValueOnce(row);
            await expect(service.update(branch, row?.id ?? "foreign-or-deleted", true)).rejects.toThrow();
            expect(repository.updateEpoch).not.toHaveBeenCalled();
        },
    );

    it("returns the exact saved epoch and avoids rewriting a repeated request", async () => {
        repository.lockRule
            .mockResolvedValueOnce(rule("local-info"))
            .mockResolvedValueOnce(rule("local-info", { canceledRetryEnabledAt: fixedEpoch }));
        repository.updateEpoch.mockResolvedValueOnce(fixedEpoch);
        const first = await service.update(branch, "local-info", true);
        const second = await service.update(branch, "local-info", true);
        expect(first).toEqual(second);
        expect(first).toMatchObject({ enabled: true, enabledAt: fixedEpoch.toISOString() });
        expect(repository.updateEpoch).toHaveBeenCalledTimes(1);
        expect(repository.lockRule).toHaveBeenCalledWith(branch, "local-info", transaction);
    });
});
