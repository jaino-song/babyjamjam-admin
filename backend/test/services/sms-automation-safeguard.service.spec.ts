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
        client: { smsAutomationEnabled: boolean; deletedAt?: Date | null } | null;
        schedule: {
            primaryEmployee: { id?: number; smsAutomationEnabled: boolean; deletedAt?: Date | null } | null;
            secondaryEmployee: { id?: number; smsAutomationEnabled: boolean; deletedAt?: Date | null } | null;
        } | null;
        /** Phone-match lookups: entities with the flag off, by phone key. */
        disabledClientPhones: string[];
        /** Live phone-matched clients (normalized phone). */
        phoneClients: Array<{ id: number; phone: string; smsAutomationEnabled: boolean }>;
        /** Tombstoned clients: they keep their RAW phone spelling and their flag. */
        tombstones: Array<{ id: number; phone: string; smsAutomationEnabled: boolean }>;
        disabledEmployeePhones: string[];
        disabledUsers: Array<{ id?: string; phone: string | null }>;
        branchOn: boolean;
    }

    const harness = (overrides: Partial<World> = {}) => {
        const world: World = {
            rule: { isActive: true, branchId }, override: null, client: { smsAutomationEnabled: true },
            schedule: { primaryEmployee: { smsAutomationEnabled: true }, secondaryEmployee: { smsAutomationEnabled: true } },
            disabledClientPhones: [], phoneClients: [], tombstones: [], disabledEmployeePhones: [], disabledUsers: [], branchOn: true, ...overrides,
        };
        const phoneHit = (phones: string[], where: { OR: Array<{ phoneNormalized?: { in: string[] } }> }) =>
            phones.some((phone) => where.OR[0]!.phoneNormalized!.in.includes(phone));
        interface ClientWhere {
            smsAutomationEnabled?: boolean;
            deletedAt?: null;
            OR?: Array<{ phoneNormalized?: { in: string[] } }>;
        }
        const db = {
            message_trigger_rule: { findFirst: jest.fn(async () => world.rule) },
            message_trigger_rule_branch_override: { findFirst: jest.fn(async () => world.override) },
            client: {
                findFirst: jest.fn(async ({ where }: { where: ClientWhere }) => {
                    if (!where.OR) return world.client;
                    const candidates = where.OR[0]!.phoneNormalized!.in;
                    const rows = [
                        ...world.disabledClientPhones.map((phone, index) => (
                            { id: index === 0 ? 1 : 100 + index, phone, smsAutomationEnabled: false })),
                        ...world.phoneClients,
                    ].filter((row) => candidates.includes(row.phone));
                    const hit = rows.find((row) =>
                        where.smsAutomationEnabled === undefined || row.smsAutomationEnabled === where.smsAutomationEnabled);
                    return hit ? { id: hit.id } : null;
                }),
            },
            // Emulates the tombstone SQL: opted-out tombstones whose digits-only raw phone is in the candidate array.
            $queryRaw: jest.fn(async (query: { values: unknown[] }) => {
                const candidates = query.values.find(Array.isArray) as string[];
                return world.tombstones
                    .filter((row) => !row.smsAutomationEnabled && candidates.includes(row.phone.replace(/[^0-9]/g, "")))
                    .map((row) => ({ id: row.id }));
            }),
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
            await expect(service.check(clientJob())).resolves.toMatchObject({
                allowed: false, level: "recipient", recipient: { kind: "client", id: 7 },
            });
        });

        it("blocks when the referenced client row is missing", async () => {
            const { service } = harness({ client: null });
            await expect(service.check(clientJob())).resolves.toMatchObject({ allowed: false, level: "recipient" });
        });

        it("blocks at the recipient level when the client is a tombstone, even with its flag on", async () => {
            const { service, db } = harness({ client: { smsAutomationEnabled: true, deletedAt: new Date("2026-10-18T00:00:00.000Z") } });
            await expect(service.check(clientJob())).resolves.toEqual({
                allowed: false, level: "recipient", reason: "recipient client is deleted",
            });
            expect(db.client.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                select: expect.objectContaining({ deletedAt: true }),
            }));
        });

        it.each([
            [MessageTriggerRecipientType.PRIMARY_EMPLOYEE, { primaryEmployee: { id: 11, smsAutomationEnabled: true, deletedAt: new Date("2026-10-18T00:00:00.000Z") }, secondaryEmployee: { id: 12, smsAutomationEnabled: true } }],
            [MessageTriggerRecipientType.SECONDARY_EMPLOYEE, { primaryEmployee: { id: 11, smsAutomationEnabled: true }, secondaryEmployee: { id: 12, smsAutomationEnabled: true, deletedAt: new Date("2026-10-18T00:00:00.000Z") } }],
        ])("blocks at the recipient level when the %s was deleted, even with the flag on", async (type, schedule) => {
            const { service } = harness({ schedule });
            await expect(service.check(employeeJob(type))).resolves.toEqual({
                allowed: false, level: "recipient", reason: "recipient employee is deleted",
            });
        });

        it("does not block the other employee because this one was deleted", async () => {
            const { service } = harness({
                schedule: {
                    primaryEmployee: { id: 11, smsAutomationEnabled: true, deletedAt: new Date("2026-10-18T00:00:00.000Z") },
                    secondaryEmployee: { id: 12, smsAutomationEnabled: true },
                },
            });
            await expect(service.check(employeeJob(MessageTriggerRecipientType.SECONDARY_EMPLOYEE)))
                .resolves.toEqual({ allowed: true });
        });

        it.each([
            [MessageTriggerRecipientType.PRIMARY_EMPLOYEE, { primaryEmployee: { id: 11, smsAutomationEnabled: false }, secondaryEmployee: { id: 12, smsAutomationEnabled: true } }, 11],
            [MessageTriggerRecipientType.SECONDARY_EMPLOYEE, { primaryEmployee: { id: 11, smsAutomationEnabled: true }, secondaryEmployee: { id: 12, smsAutomationEnabled: false } }, 12],
        ])("blocks at the recipient level when the %s flag is off, naming that employee", async (type, schedule, employeeId) => {
            const { service } = harness({ schedule });
            await expect(service.check(employeeJob(type))).resolves.toMatchObject({
                allowed: false, level: "recipient", recipient: { kind: "employee", id: employeeId },
            });
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
                    .resolves.toMatchObject({ allowed: false, level: "recipient", recipient: { kind: "client", id: 1 } });
            }
        });

        describe("tombstoned clients that still carry the phone", () => {
            const tomb = (smsAutomationEnabled: boolean, phone = "+82 10-1234-5678") => ({ id: 31, phone, smsAutomationEnabled });

            it("block when the client was deleted with automation off", async () => {
                const { service } = harness({ tombstones: [tomb(false)] });
                await expect(service.check(agentJob({ recipientPhone: "01012345678" }))).resolves.toMatchObject({
                    allowed: false, level: "recipient", reason: "matched deleted client SMS automation is off",
                    recipient: { kind: "client", id: 31 },
                });
            });

            it("block whatever the raw spelling of the stored phone", async () => {
                for (const raw of ["+82 10-1234-5678", "010.1234.5678", "010 1234 5678", "01012345678", "010-1234-5678"]) {
                    const { service } = harness({ tombstones: [tomb(false, raw)] });
                    await expect(service.check(agentJob({ recipientPhone: "01012345678" })))
                        .resolves.toMatchObject({ allowed: false, recipient: { kind: "client", id: 31 } });
                }
            });

            it("are not cleared by a live opted-in client with the same phone", async () => {
                const { service } = harness({
                    tombstones: [tomb(false)], phoneClients: [{ id: 32, phone: "01012345678", smsAutomationEnabled: true }],
                });
                await expect(service.check(agentJob({ recipientPhone: "01012345678" }))).resolves.toMatchObject({
                    allowed: false, reason: "matched deleted client SMS automation is off", recipient: { kind: "client", id: 31 },
                });
            });

            it("block a multi-recipient job when any one key matches the tombstone", async () => {
                const { service } = harness({ tombstones: [tomb(false)] });
                await expect(service.check(agentJob({ recipientPhone: "01099998888,010-1234-5678" })))
                    .resolves.toMatchObject({ allowed: false, recipient: { kind: "client", id: 31 } });
            });

            it("do not block when the tombstone itself was opted in", async () => {
                const { service } = harness({ tombstones: [tomb(true)] });
                await expect(service.check(agentJob({ recipientPhone: "01012345678" }))).resolves.toEqual({ allowed: true });
            });

            it("do not block an unrelated phone", async () => {
                const { service } = harness({ tombstones: [tomb(false)] });
                await expect(service.check(agentJob({ recipientPhone: "01099998888" }))).resolves.toEqual({ allowed: true });
            });

            it("leave a live opted-out match to decide first, without querying tombstones", async () => {
                const { service, db } = harness({ disabledClientPhones: ["01012345678"], tombstones: [tomb(false)] });
                await expect(service.check(agentJob({ recipientPhone: "01012345678" })))
                    .resolves.toMatchObject({ allowed: false, reason: "matched client SMS automation is off" });
                expect(db.$queryRaw).not.toHaveBeenCalled();
            });

            it("query the branch's deleted, opted-out clients by digits-only raw phone", async () => {
                const { service, db } = harness();
                await service.check(agentJob({ recipientPhone: "010-1234-5678" }));
                const query = db.$queryRaw.mock.calls[0]![0] as unknown as { sql: string; values: unknown[] };
                expect(query.sql).toContain("regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')");
                expect(query.sql).toContain("deleted_at IS NOT NULL");
                expect(query.sql).toContain("sms_automation_enabled = false");
                expect(query.sql).toContain("branch_id = ?::uuid");
                expect(query.values[0]).toBe(branchId);
                expect(query.values.find(Array.isArray)).toEqual(expect.arrayContaining(["01012345678", "821012345678", "8201012345678"]));
            });

            it("still reach the employee check when no tombstone matches", async () => {
                const { service } = harness({ disabledEmployeePhones: ["01012345678"] });
                await expect(service.check(agentJob())).resolves.toMatchObject({
                    allowed: false, recipient: { kind: "employee", id: 2 },
                });
            });
        });

        it("are blocked when the phone matches an employee whose automation is off", async () => {
            const { service } = harness({ disabledEmployeePhones: ["01012345678"] });
            await expect(service.check(agentJob())).resolves.toMatchObject({
                allowed: false, level: "recipient", recipient: { kind: "employee", id: 2 },
            });
        });

        it("are blocked when the phone matches a user of the branch whose automation is off", async () => {
            const { service, db } = harness({ disabledUsers: [{ id: "user-9", phone: "010 1234 5678" }] });
            await expect(service.check(agentJob())).resolves.toMatchObject({
                allowed: false, level: "recipient", recipient: { kind: "user", id: "user-9" },
            });
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
