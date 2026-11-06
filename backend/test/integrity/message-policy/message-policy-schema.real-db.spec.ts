import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { assertThrowawayTarget, describeReal } from "../helpers/real-db";

const migration = "prisma/migrations/20261103000100_message_policy_groups_and_claim_deadline/migration.sql";
const fixedNow = new Date("2026-11-03T12:00:00.000Z");

// These also run in the hermetic unit suite; no database or provider is touched.
describe("message policy storage mapping", () => {
    it("round-trips groupId through rule create/read storage", async () => {
        const row = {
            id: "rule", branchId: "branch", groupId: "group", name: "grouped rule", isActive: true,
            eventType: "SERVICE_START", offsetType: "SAME_DAY", offsetDays: 0, sendTime: "09:00",
            recipientType: "CLIENT", templateKey: "INFO", targetClientStatus: "all", retryOnFailure: true,
            createdAt: fixedNow, updatedAt: fixedNow,
        };
        const create = jest.fn().mockResolvedValue(row);
        const findFirst = jest.fn().mockResolvedValue(row);
        const repository = new SbMessageTriggerRuleRepository({ message_trigger_rule: { create, findFirst } } as unknown as PrismaService);
        const rule = MessageTriggerRuleEntity.create({
            branchId: "branch", groupId: "group", name: "grouped rule", eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.SAME_DAY, recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.INFO,
        });
        expect((await repository.create("branch", rule)).groupId).toBe("group");
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ groupId: "group" }) }));
        expect((await repository.findById("branch", "rule"))?.groupId).toBe("group");
    });

    it("stores and restores a nullable deadline snapshot and retains it in payload views", async () => {
        const deadline = new Date("2026-11-03T12:37:00.000Z");
        const job = MessageTriggerJobEntity.create({
            branchId: "branch", ruleId: "rule", scheduledFor: fixedNow, recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.INFO, dedupeKey: "mapping", payload: {
                memberId: "fixture", recipientName: "fixture", recipientPhone: "", templateVariables: {},
            },
        });
        expect(job.processingDeadlineAt).toBeNull();
        job.processingDeadlineAt = deadline;
        const create = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
            ...data, id: "job", createdAt: fixedNow, updatedAt: fixedNow,
        }));
        const repository = new SbMessageTriggerJobRepository({ message_trigger_job: { create } } as unknown as PrismaService);
        const restored = await repository.create(job);
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ processingDeadlineAt: deadline }) }));
        expect(restored.processingDeadlineAt).toEqual(deadline);
        expect(restored.withPayloadOverride({ recipientName: "preview" }).processingDeadlineAt).toEqual(deadline);
    });
});

describeReal("DB-1 message policy additive migration (real PostgreSQL)", () => {
    let admin: PrismaClient;

    beforeAll(async () => {
        assertThrowawayTarget();
        admin = new PrismaClient();
        await admin.$connect();
    });

    afterAll(async () => { if (admin) await admin.$disconnect(); });

    // The runner already applies the entire migration chain to a fresh database
    // with migrate deploy. Isolated schemas below exercise the exact SQL against
    // empty and legacy pre-patch tables without altering that migrated schema or
    // another integrity suite's fixtures. No auth/customer/provider fixtures exist.
    for (const scenario of ["empty", "legacy"] as const) {
        it(`supports ${scenario} tables, repeated CLI execution, and post-deploy groups`, async () => {
            const schema = `message_policy_${randomUUID().replace(/-/g, "")}`;
            const qualified = (table: string) => Prisma.raw(`"${schema}"."${table}"`);
            const url = new URL(process.env["DATABASE_URL"]!);
            url.searchParams.set("schema", schema);
            const databaseUrl = url.toString();
            const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
            const branchA = "00000000-0000-4000-8000-000000000001";
            const branchB = "00000000-0000-4000-8000-000000000002";
            try {
                await admin.$executeRaw(Prisma.sql`CREATE SCHEMA ${Prisma.raw(`"${schema}"`)}`);
                await admin.$executeRaw(Prisma.sql`CREATE TABLE ${qualified("branch")} (id UUID PRIMARY KEY)`);
                for (const table of ["message_trigger_rule", "message_trigger_job"]) {
                    await admin.$executeRaw(Prisma.sql`CREATE TABLE ${qualified(table)} (LIKE ${Prisma.raw(`"public"."${table}"`)} INCLUDING ALL)`);
                }
                await admin.$executeRaw(Prisma.sql`ALTER TABLE ${qualified("message_trigger_rule")} DROP COLUMN group_id`);
                await admin.$executeRaw(Prisma.sql`ALTER TABLE ${qualified("message_trigger_job")} DROP COLUMN processing_deadline_at`);
                await prisma.$connect();
                await prisma.$executeRaw`INSERT INTO branch (id) VALUES (${branchA}::uuid), (${branchB}::uuid)`;

                async function legacyRule(id: string, options: { branchId?: string | null; isDefault?: boolean; deleted?: boolean; recipientType?: string } = {}) {
                    await prisma.$executeRaw`
                        INSERT INTO message_trigger_rule
                            (id, branch_id, name, event_type, offset_type, recipient_type, template_key, is_default, deleted_at, updated_at)
                        VALUES (${id}, ${options.branchId === undefined ? branchA : options.branchId}::uuid, ${id}, 'SERVICE_START',
                            'SAME_DAY', ${options.recipientType ?? "CLIENT"}, 'INFO', ${options.isDefault ?? false},
                            ${options.deleted ? fixedNow : null}::timestamptz, ${fixedNow})
                    `;
                }

                const ruleState = () => prisma.$queryRaw`
                    SELECT id, to_jsonb(rule) - 'group_id' AS state FROM message_trigger_rule AS rule ORDER BY id
                `;
                const jobState = () => prisma.$queryRaw`
                    SELECT id, to_jsonb(job) - 'processing_deadline_at' AS state FROM message_trigger_job AS job ORDER BY id
                `;
                const partialIndexes = () => prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
                    SELECT indexname, indexdef FROM pg_indexes
                    WHERE schemaname = ${schema} AND tablename = 'message_trigger_rule' AND indexdef LIKE '%WHERE%'
                    ORDER BY indexname
                `;
                async function assertLegacySingletonChildren() {
                    const groups = await prisma.message_trigger_rule_group.findMany({
                        where: { id: { startsWith: "legacy-rule:" } },
                        select: {
                            id: true,
                            rules: { select: { id: true, groupId: true, recipientType: true }, orderBy: { id: "asc" } },
                        },
                        orderBy: { id: "asc" },
                    });
                    // Literal child sets prove the backfill attached exactly one
                    // eligible rule per parent, independently of rerun snapshots.
                    expect(groups).toEqual(scenario === "empty" ? [] : [
                        {
                            id: "legacy-rule:custom-client",
                            rules: [{ id: "custom-client", groupId: "legacy-rule:custom-client", recipientType: "CLIENT" }],
                        },
                        {
                            id: "legacy-rule:custom-primary",
                            rules: [{ id: "custom-primary", groupId: "legacy-rule:custom-primary", recipientType: "PRIMARY_EMPLOYEE" }],
                        },
                        {
                            id: "legacy-rule:custom-secondary",
                            rules: [{ id: "custom-secondary", groupId: "legacy-rule:custom-secondary", recipientType: "SECONDARY_EMPLOYEE" }],
                        },
                    ]);
                }
                function executeMigration() {
                    // Uses only the already-guarded local throwaway URL, with a
                    // generated search schema. Never inherits a remote datasource.
                    const result = spawnSync("pnpm", ["exec", "prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--file", migration], {
                        cwd: resolve(__dirname, "../../.."),
                        env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
                        encoding: "utf8", timeout: 30_000,
                    });
                    expect(result.error).toBeUndefined();
                    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: expect.any(String) });
                }

                if (scenario === "legacy") {
                    await legacyRule("custom-client");
                    await legacyRule("custom-primary", { recipientType: "PRIMARY_EMPLOYEE" });
                    await legacyRule("custom-secondary", { recipientType: "SECONDARY_EMPLOYEE" });
                    await legacyRule("system:reserved");
                    await legacyRule("agent-sms:reserved");
                    await legacyRule("global", { branchId: null });
                    await legacyRule("default", { isDefault: true });
                    await legacyRule("deleted", { deleted: true });
                    for (const status of ["pending", "processing", "dispatching", "sent", "failed", "canceled", "needs_setup"]) {
                        await prisma.$executeRaw`
                            INSERT INTO message_trigger_job
                                (id, branch_id, rule_id, status, scheduled_for, recipient_type, template_key, dedupe_key, claim_token, updated_at)
                            VALUES (${`job-${status}`}, ${branchA}::uuid, 'custom-client', ${status}, ${fixedNow},
                                'CLIENT', 'INFO', ${`dedupe-${status}`}, 'legacy-claim', ${fixedNow})
                        `;
                    }
                }
                const beforeRules = await ruleState();
                const beforeJobs = await jobState();
                const beforeIndexes = await partialIndexes();
                expect(beforeIndexes.length).toBeGreaterThan(0);
                executeMigration();
                expect(await ruleState()).toEqual(beforeRules);
                expect(await jobState()).toEqual(beforeJobs);
                expect(await partialIndexes()).toEqual(beforeIndexes);
                const legacyGroups = await prisma.message_trigger_rule_group.findMany({ orderBy: { id: "asc" } });
                expect(legacyGroups.map(({ id, recipientMode }) => ({ id, recipientMode }))).toEqual(scenario === "empty" ? [] : [
                    { id: "legacy-rule:custom-client", recipientMode: "CLIENT" },
                    { id: "legacy-rule:custom-primary", recipientMode: "PRIMARY_EMPLOYEE" },
                    { id: "legacy-rule:custom-secondary", recipientMode: "SECONDARY_EMPLOYEE" },
                ]);
                await assertLegacySingletonChildren();
                if (scenario === "legacy") {
                    for (const id of ["system:reserved", "agent-sms:reserved", "global", "default", "deleted"]) {
                        expect((await prisma.message_trigger_rule.findUniqueOrThrow({ where: { id } })).groupId).toBeNull();
                    }
                    for (const status of ["pending", "processing", "dispatching", "sent", "failed", "canceled", "needs_setup"]) {
                        expect((await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: `job-${status}` } })).processingDeadlineAt)
                            .toEqual(["processing", "dispatching"].includes(status) ? new Date("2026-11-03T12:10:00.000Z") : null);
                    }
                }

                const both = await prisma.message_trigger_rule_group.create({ data: { branchId: branchA, name: "BOTH", recipientMode: "BOTH_EMPLOYEES" } });
                const post = await prisma.message_trigger_rule_group.create({ data: { branchId: branchA, name: "POST", recipientMode: "CLIENT" } });
                expect(both.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
                for (const [id, groupId, recipientType] of [
                    ["both-primary", both.id, "PRIMARY_EMPLOYEE"], ["both-secondary", both.id, "SECONDARY_EMPLOYEE"], ["legacy-post", post.id, "CLIENT"],
                ]) {
                    await legacyRule(id!, { recipientType });
                    await prisma.message_trigger_rule.update({ where: { id }, data: { groupId } });
                }
                const customDeadline = new Date("2026-11-03T12:37:00.000Z");
                await prisma.message_trigger_job.create({ data: {
                    id: "custom-deadline", branchId: branchA, ruleId: "legacy-post", status: "processing", claimToken: "custom-claim",
                    scheduledFor: fixedNow, recipientType: "CLIENT", templateKey: "INFO", dedupeKey: "custom-deadline",
                    processingDeadlineAt: customDeadline,
                } });
                const groupState = () => prisma.message_trigger_rule_group.findMany({ include: { rules: { select: { id: true, groupId: true, recipientType: true }, orderBy: { id: "asc" } } }, orderBy: { id: "asc" } });
                const firstGroups = await groupState();
                const firstDeadlines = await prisma.message_trigger_job.findMany({ select: { id: true, processingDeadlineAt: true }, orderBy: { id: "asc" } });
                // A second CLI execution of the entire file must preserve new
                // and backfilled identities, modes, child counts, and snapshots.
                executeMigration();
                await assertLegacySingletonChildren();
                expect(await groupState()).toEqual(firstGroups);
                expect(await prisma.message_trigger_job.findMany({ select: { id: true, processingDeadlineAt: true }, orderBy: { id: "asc" } })).toEqual(firstDeadlines);
                expect((await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: "custom-deadline" } })).processingDeadlineAt).toEqual(customDeadline);
                expect(await partialIndexes()).toEqual(beforeIndexes);

                const childData = { name: "invalid", eventType: "SERVICE_START", offsetType: "SAME_DAY", recipientType: "CLIENT", templateKey: "INFO" };
                // The POST group already contains CLIENT. Use distinct unused
                // roles so the unique index cannot mask either tenant fence.
                await expect(prisma.message_trigger_rule.create({ data: { ...childData, recipientType: "PRIMARY_EMPLOYEE", branchId: branchB, groupId: post.id } })).rejects.toMatchObject({ code: "P2003" });
                await expect(prisma.message_trigger_rule.create({ data: { ...childData, branchId: branchA, groupId: post.id } })).rejects.toMatchObject({ code: "P2002" });
                await expect(prisma.message_trigger_rule.create({ data: { ...childData, recipientType: "SECONDARY_EMPLOYEE", groupId: post.id } })).rejects.toThrow("message_trigger_rule_group_requires_branch_check");
                await expect(prisma.message_trigger_rule_group.create({ data: { branchId: randomUUID(), name: "orphan", recipientMode: "CLIENT" } })).rejects.toMatchObject({ code: "P2003" });
                await expect(prisma.message_trigger_rule_group.delete({ where: { id: both.id } })).rejects.toMatchObject({ code: "P2003" });
            } finally {
                await prisma.$disconnect();
                await admin.$executeRaw(Prisma.sql`DROP SCHEMA IF EXISTS ${Prisma.raw(`"${schema}"`)} CASCADE`);
            }
        }, 90_000);
    }
});
