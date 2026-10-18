import {
    SmsAutomationSafeguardService,
    isAdminDirectSendJob,
    isAgentSmsJob,
    smsAutomationSafeguardReason,
    type SmsSafeguardJob,
} from "application/services/sms-automation-safeguard.service";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";

describe("SmsAutomationSafeguardService", () => {
    const branchId = "branch-1";

    interface World {
        rule: { isActive: boolean; branchId: string | null } | null;
        override: { isActive: boolean } | null;
        client: { smsAutomationEnabled: boolean } | null;
        schedule: {
            primaryEmployee: { smsAutomationEnabled: boolean } | null;
            secondaryEmployee: { smsAutomationEnabled: boolean } | null;
        } | null;
        /** Phone-match lookups: entities with the flag off, by phone key. */
        disabledClientPhones: string[];
        disabledEmployeePhones: string[];
        disabledUsers: Array<{ phone: string | null }>;
        branchOn: boolean;
    }

    const harness = (overrides: Partial<World> = {}) => {
        const world: World = {
            rule: { isActive: true, branchId }, override: null, client: { smsAutomationEnabled: true },
            schedule: { primaryEmployee: { smsAutomationEnabled: true }, secondaryEmployee: { smsAutomationEnabled: true } },
            disabledClientPhones: [], disabledEmployeePhones: [], disabledUsers: [], branchOn: true, ...overrides,
        };
        const phoneHit = (phones: string[], where: { OR: Array<{ phoneNormalized?: { in: string[] } }> }) =>
            phones.some((phone) => where.OR[0]!.phoneNormalized!.in.includes(phone));
        const db = {
            message_trigger_rule: { findFirst: jest.fn(async () => world.rule) },
            message_trigger_rule_branch_override: { findFirst: jest.fn(async () => world.override) },
            client: {
                findFirst: jest.fn(async ({ where }: { where: { smsAutomationEnabled?: boolean; OR: never } }) =>
                    where.smsAutomationEnabled === false
                        ? (phoneHit(world.disabledClientPhones, where as never) ? { id: 1 } : null)
                        : world.client),
            },
            employee: {
                findFirst: jest.fn(async ({ where }: { where: { OR: never } }) =>
                    phoneHit(world.disabledEmployeePhones, where as never) ? { id: 2 } : null),
            },
            employee_schedule: { findFirst: jest.fn(async () => world.schedule) },
            user: { findMany: jest.fn(async () => world.disabledUsers) },
            message_trigger_job: { findFirst: jest.fn() },
        };
        const activation = { getTriggerDispatchEnabled: jest.fn(async () => world.branchOn) };
        const service = new SmsAutomationSafeguardService(db as never, activation as never);
        return { service, db, activation, world };
    };

    const clientJob = (overrides: Partial<SmsSafeguardJob> = {}): SmsSafeguardJob => ({
        branchId, ruleId: "rule-1", templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        dedupeKey: "dedupe-1", clientId: 7, employeeScheduleId: null,
        recipientType: MessageTriggerRecipientType.CLIENT, recipientPhone: "010-1234-5678", ...overrides,
    });
    const agentJob = (overrides: Partial<SmsSafeguardJob> = {}): SmsSafeguardJob => clientJob({
        ruleId: `agent-sms:${branchId}`, dedupeKey: "agent-sms:action-1", clientId: null,
        templateKey: MessageTriggerTemplateKey.INFO, ...overrides,
    });
    const employeeJob = (type: MessageTriggerRecipientType): SmsSafeguardJob => clientJob({
        ruleId: "system:service_record_link", templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
        dedupeKey: "system:service_record_link:schedule:10:primary", clientId: 7, employeeScheduleId: 10, recipientType: type,
    });

    describe("classification", () => {
        it("treats agent jobs as automatic and manual link/notice jobs as admin direct", () => {
            expect(isAgentSmsJob(agentJob())).toBe(true);
            expect(isAgentSmsJob(clientJob({ dedupeKey: "agent-sms-retry:a1" }))).toBe(true);
            expect(isAdminDirectSendJob(agentJob())).toBe(false);
            expect(isAdminDirectSendJob(clientJob({ dedupeKey: "agent-sms-retry:a1" }))).toBe(false);
            expect(isAdminDirectSendJob(clientJob())).toBe(false);
            expect(isAdminDirectSendJob(clientJob({
                ruleId: "system:service_record_link",
                dedupeKey: "system:service_record_link:schedule:10:primary:manual:3f2b1c9e-0a4d-4b6e-9d11-5c7a8e2f4b10",
            }))).toBe(true);
            expect(isAdminDirectSendJob(clientJob({
                ruleId: "system:service_end_notice",
                dedupeKey: "system:service_end_notice:client:7:manual:3f2b1c9e-0a4d-4b6e-9d11-5c7a8e2f4b10",
            }))).toBe(true);
        });

        it("names the cancel reason by level", () => {
            expect(smsAutomationSafeguardReason("rule")).toBe("sms_automation_safeguard:rule");
        });
    });

    describe("levels", () => {
        it("allows when rule, recipient and branch are all on", async () => {
            const { service } = harness();
            await expect(service.check(clientJob())).resolves.toEqual({ allowed: true });
        });

        it("blocks at the rule level when the rule is inactive, with the other two on", async () => {
            const { service } = harness({ rule: { isActive: false, branchId } });
            await expect(service.check(clientJob())).resolves.toMatchObject({ allowed: false, level: "rule" });
        });

        it("blocks a missing rule and a rule owned by another branch", async () => {
            await expect(harness({ rule: null }).service.check(clientJob())).resolves.toMatchObject({ allowed: false, level: "rule" });
            await expect(harness({ rule: { isActive: true, branchId: "other" } }).service.check(clientJob()))
                .resolves.toMatchObject({ allowed: false, level: "rule" });
        });

        it("blocks a global rule the branch overrode inactive, and allows an active override", async () => {
            const global = { isActive: true, branchId: null };
            await expect(harness({ rule: global, override: { isActive: false } }).service.check(clientJob()))
                .resolves.toMatchObject({ allowed: false, level: "rule" });
            await expect(harness({ rule: global, override: { isActive: true } }).service.check(clientJob()))
                .resolves.toEqual({ allowed: true });
            await expect(harness({ rule: global }).service.check(clientJob())).resolves.toEqual({ allowed: true });
        });

        it("blocks at the recipient level when the client flag is off, with the other two on", async () => {
            const { service } = harness({ client: { smsAutomationEnabled: false } });
            await expect(service.check(clientJob())).resolves.toMatchObject({ allowed: false, level: "recipient" });
        });

        it("blocks when the referenced client row is missing", async () => {
            const { service } = harness({ client: null });
            await expect(service.check(clientJob())).resolves.toMatchObject({ allowed: false, level: "recipient" });
        });

        it.each([
            [MessageTriggerRecipientType.PRIMARY_EMPLOYEE, { primaryEmployee: { smsAutomationEnabled: false }, secondaryEmployee: { smsAutomationEnabled: true } }],
            [MessageTriggerRecipientType.SECONDARY_EMPLOYEE, { primaryEmployee: { smsAutomationEnabled: true }, secondaryEmployee: { smsAutomationEnabled: false } }],
        ])("blocks at the recipient level when the %s flag is off", async (type, schedule) => {
            const { service } = harness({ schedule });
            await expect(service.check(employeeJob(type))).resolves.toMatchObject({ allowed: false, level: "recipient" });
        });

        it("checks only the addressed employee of the schedule", async () => {
            const { service } = harness({
                schedule: { primaryEmployee: { smsAutomationEnabled: true }, secondaryEmployee: { smsAutomationEnabled: false } },
            });
            await expect(service.check(employeeJob(MessageTriggerRecipientType.PRIMARY_EMPLOYEE))).resolves.toEqual({ allowed: true });
        });

        it("blocks when the schedule or the addressed employee is missing", async () => {
            await expect(harness({ schedule: null }).service.check(employeeJob(MessageTriggerRecipientType.PRIMARY_EMPLOYEE)))
                .resolves.toMatchObject({ allowed: false, level: "recipient" });
            await expect(harness({ schedule: { primaryEmployee: { smsAutomationEnabled: true }, secondaryEmployee: null } })
                .service.check(employeeJob(MessageTriggerRecipientType.SECONDARY_EMPLOYEE)))
                .resolves.toMatchObject({ allowed: false, level: "recipient" });
        });

        it("blocks at the branch level when trigger dispatch is off, with the other two on", async () => {
            const { service, activation } = harness({ branchOn: false });
            await expect(service.check(clientJob())).resolves.toMatchObject({ allowed: false, level: "branch" });
            expect(activation.getTriggerDispatchEnabled).toHaveBeenCalledWith(branchId, undefined);
        });

        it("blocks a job without a branch at the branch level", async () => {
            const { service } = harness({ rule: { isActive: true, branchId: null } });
            await expect(service.check(clientJob({ branchId: null }))).resolves.toMatchObject({ allowed: false, level: "branch" });
        });

        it("reports the first failing level in rule, recipient, branch order", async () => {
            const all = { rule: { isActive: false, branchId }, client: { smsAutomationEnabled: false }, branchOn: false };
            await expect(harness(all).service.check(clientJob())).resolves.toMatchObject({ level: "rule" });
            await expect(harness({ ...all, rule: { isActive: true, branchId } }).service.check(clientJob()))
                .resolves.toMatchObject({ level: "recipient" });
        });

        it("reads through the supplied transaction instead of the pool", async () => {
            const pool = harness();
            const tx = harness({ client: { smsAutomationEnabled: false } });
            await expect(pool.service.check(clientJob(), tx.db as never)).resolves.toMatchObject({ allowed: false, level: "recipient" });
            expect(pool.db.client.findFirst).not.toHaveBeenCalled();
            expect(pool.activation.getTriggerDispatchEnabled).not.toHaveBeenCalled();
        });
    });

    describe("agent jobs", () => {
        it("skip the rule level (their rule row is intentionally inactive)", async () => {
            const { service, db } = harness({ rule: { isActive: false, branchId } });
            await expect(service.check(agentJob())).resolves.toEqual({ allowed: true });
            expect(db.message_trigger_rule.findFirst).not.toHaveBeenCalled();
        });

        it("are blocked at the branch level when the switch is off", async () => {
            const { service } = harness({ branchOn: false });
            await expect(service.check(agentJob())).resolves.toMatchObject({ allowed: false, level: "branch" });
        });

        it("are blocked when the phone matches a client whose automation is off (digits, +82 and hyphenated spellings)", async () => {
            for (const phone of ["010-1234-5678", "01012345678", "+82 10-1234-5678"]) {
                const { service } = harness({ disabledClientPhones: ["01012345678"] });
                await expect(service.check(agentJob({ recipientPhone: phone })))
                    .resolves.toMatchObject({ allowed: false, level: "recipient" });
            }
        });

        it("are blocked when the phone matches an employee whose automation is off", async () => {
            const { service } = harness({ disabledEmployeePhones: ["01012345678"] });
            await expect(service.check(agentJob())).resolves.toMatchObject({ allowed: false, level: "recipient" });
        });

        it("are blocked when the phone matches a user of the branch whose automation is off", async () => {
            const { service, db } = harness({ disabledUsers: [{ phone: "010 1234 5678" }] });
            await expect(service.check(agentJob())).resolves.toMatchObject({ allowed: false, level: "recipient" });
            expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    smsAutomationEnabled: false,
                    userBranches: { some: { branchId } },
                }),
            }));
        });

        it("pass when no client, employee or user matches the phone", async () => {
            const { service } = harness({
                disabledClientPhones: ["01099998888"], disabledEmployeePhones: ["01077776666"],
                disabledUsers: [{ phone: "010-5555-4444" }, { phone: null }],
            });
            await expect(service.check(agentJob())).resolves.toEqual({ allowed: true });
        });

        it("pass when the job carries no phone", async () => {
            const { service, db } = harness();
            await expect(service.check(agentJob({ recipientPhone: null }))).resolves.toEqual({ allowed: true });
            expect(db.client.findFirst).not.toHaveBeenCalled();
        });
    });

    describe("checkJobById", () => {
        it("loads the job and checks it", async () => {
            const { service, db } = harness({ client: { smsAutomationEnabled: false } });
            db.message_trigger_job.findFirst.mockResolvedValue(clientJob());
            await expect(service.checkJobById(branchId, "job-1")).resolves.toMatchObject({ allowed: false, level: "recipient" });
            expect(db.message_trigger_job.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "job-1", branchId } }));
        });

        it("passes admin-direct jobs without evaluating anything", async () => {
            const { service, db } = harness({ client: { smsAutomationEnabled: false }, branchOn: false });
            db.message_trigger_job.findFirst.mockResolvedValue(clientJob({
                ruleId: "system:service_record_link",
                dedupeKey: "system:service_record_link:schedule:10:primary:manual:3f2b1c9e-0a4d-4b6e-9d11-5c7a8e2f4b10",
            }));
            await expect(service.checkJobById(branchId, "job-1")).resolves.toEqual({ allowed: true });
            expect(db.client.findFirst).not.toHaveBeenCalled();
        });

        it("passes a vanished job (other retry guards own that case)", async () => {
            const { service, db } = harness();
            db.message_trigger_job.findFirst.mockResolvedValue(null);
            await expect(service.checkJobById(branchId, "gone")).resolves.toEqual({ allowed: true });
        });
    });
});
