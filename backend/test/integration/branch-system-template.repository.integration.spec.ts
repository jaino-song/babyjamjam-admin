import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { SYSTEM_TEMPLATE_REGISTRY, SystemTemplateKey } from "domain/constants/system-template-registry";
import { BranchSystemTemplateSnapshotError } from "domain/entities/branch-system-template-snapshot";
import { SbSystemTemplateRepository } from "infrastructure/database/repositories/sb.system-template.repository";

const databaseUrl = process.env["BRANCH_SYSTEM_TEMPLATE_TEST_DATABASE_URL"];
const isApprovedDisposableDatabase = Boolean(
    databaseUrl && /(?:127\.0\.0\.1|localhost):55439(?:\/|$)/.test(databaseUrl),
);
const describeDisposable = isApprovedDisposableDatabase ? describe : describe.skip;

describeDisposable("SbSystemTemplateRepository branch snapshots (local PostgreSQL)", () => {
    let prisma: PrismaClient;
    let repository: SbSystemTemplateRepository;
    let baselineTemplates: Map<string, {
        content: string;
        customVariables: Prisma.JsonValue | null;
    }>;
    let branchIds: string[];
    let testMarker: string;

    const templateKeys = Object.values(SystemTemplateKey) as SystemTemplateKey[];
    const jsonArray = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

    const createBranch = async (): Promise<string> => {
        const branch = await prisma.branch.create({
            data: {
                name: `Branch template test ${randomUUID()}`,
                slug: `branch-template-test-${randomUUID()}`,
            },
            select: { id: true },
        });
        branchIds.push(branch.id);
        return branch.id;
    };

    const seedGlobalTemplates = async (): Promise<void> => {
        await Promise.all(templateKeys.map((key) => prisma.system_template.upsert({
            where: { templateKey: key },
            create: {
                templateKey: key,
                content: `global-${testMarker}-${key}`,
                customVariables: jsonArray([]),
            },
            update: {
                content: `global-${testMarker}-${key}`,
                customVariables: jsonArray([]),
            },
        })));
    };

    const acceptCandidate = async (): Promise<void> => undefined;

    beforeAll(async () => {
        prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
        await prisma.$connect();
        repository = new SbSystemTemplateRepository(prisma as never);
        const rows = await prisma.system_template.findMany({
            where: { templateKey: { in: templateKeys } },
            select: { templateKey: true, content: true, customVariables: true },
        });
        baselineTemplates = new Map(rows.map((row) => [row.templateKey, {
            content: row.content,
            customVariables: row.customVariables,
        }]));
    });

    beforeEach(async () => {
        branchIds = [];
        testMarker = randomUUID();
        await seedGlobalTemplates();
    });

    afterEach(async () => {
        if (branchIds.length > 0) {
            await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
        }
    });

    afterAll(async () => {
        for (const key of templateKeys) {
            const baseline = baselineTemplates.get(key);
            if (baseline) {
                await prisma.system_template.update({
                    where: { templateKey: key },
                    data: {
                        content: baseline.content,
                        customVariables: baseline.customVariables === null
                            ? Prisma.JsonNull
                            : baseline.customVariables as Prisma.InputJsonValue,
                    },
                });
            } else {
                await prisma.system_template.delete({ where: { templateKey: key } }).catch(() => undefined);
            }
        }
        await prisma.$disconnect();
    });

    it("follows global edits while an untouched branch has no snapshot", async () => {
        const branchId = await createBranch();
        const before = await repository.findByBranchKey(branchId, SystemTemplateKey.GREETING);
        expect(before?.content).toBe(`global-${testMarker}-${SystemTemplateKey.GREETING}`);

        const updatedContent = `global-updated-${testMarker}-${SystemTemplateKey.GREETING}`;
        await prisma.system_template.update({
            where: { templateKey: SystemTemplateKey.GREETING },
            data: { content: updatedContent },
        });

        const after = await repository.findByBranchKey(branchId, SystemTemplateKey.GREETING);
        expect(after?.content).toBe(updatedContent);
        expect(await repository.findBranchSnapshot(branchId)).toBeNull();
    });

    it("freezes every current template on the first semantic edit", async () => {
        const branchId = await createBranch();
        const initialReminder = `global-${testMarker}-${SystemTemplateKey.SERVICE_END_REMINDER}`;
        const branchGreeting = `branch-${testMarker}-greeting`;

        const result = await repository.updateBranchTemplate(
            branchId,
            SystemTemplateKey.GREETING,
            branchGreeting,
            "user-a",
            undefined,
            acceptCandidate,
        );

        expect(result.changed).toBe(true);
        const snapshot = await repository.findBranchSnapshot(branchId);
        expect(snapshot?.version).toBe(1);
        expect(Object.keys(snapshot?.templates ?? {})).toHaveLength(templateKeys.length);
        expect(snapshot?.templates[SystemTemplateKey.GREETING]?.content).toBe(branchGreeting);
        expect(snapshot?.templates[SystemTemplateKey.SERVICE_END_REMINDER]?.content).toBe(initialReminder);

        const updatedReminder = `global-updated-${testMarker}-${SystemTemplateKey.SERVICE_END_REMINDER}`;
        await prisma.system_template.update({
            where: { templateKey: SystemTemplateKey.SERVICE_END_REMINDER },
            data: { content: updatedReminder },
        });

        const frozenReminder = await repository.findByBranchKey(branchId, SystemTemplateKey.SERVICE_END_REMINDER);
        expect(frozenReminder?.content).toBe(initialReminder);

        const otherBranchId = await createBranch();
        const otherBranchReminder = await repository.findByBranchKey(
            otherBranchId,
            SystemTemplateKey.SERVICE_END_REMINDER,
        );
        expect(otherBranchReminder?.content).toBe(updatedReminder);
    });

    it("keeps subsequent branch edits isolated from later global edits", async () => {
        const branchId = await createBranch();
        await repository.updateBranchTemplate(
            branchId,
            SystemTemplateKey.GREETING,
            `branch-${testMarker}-greeting`,
            "user-a",
            undefined,
            acceptCandidate,
        );

        const branchReminder = `branch-${testMarker}-reminder`;
        await repository.updateBranchTemplate(
            branchId,
            SystemTemplateKey.SERVICE_END_REMINDER,
            branchReminder,
            "user-b",
            undefined,
            acceptCandidate,
        );

        const globalInfo = `global-updated-${testMarker}-info`;
        await prisma.system_template.update({
            where: { templateKey: SystemTemplateKey.INFO },
            data: { content: globalInfo },
        });

        expect((await repository.findByBranchKey(branchId, SystemTemplateKey.SERVICE_END_REMINDER))?.content)
            .toBe(branchReminder);
        expect((await repository.findByBranchKey(branchId, SystemTemplateKey.INFO))?.content)
            .toBe(`global-${testMarker}-${SystemTemplateKey.INFO}`);
    });

    it("stays frozen after branch wording is reverted to the registry default", async () => {
        const branchId = await createBranch();
        await repository.updateBranchTemplate(
            branchId,
            SystemTemplateKey.GREETING,
            `branch-${testMarker}-custom-greeting`,
            "user-a",
            undefined,
            acceptCandidate,
        );
        await repository.updateBranchTemplate(
            branchId,
            SystemTemplateKey.GREETING,
            SYSTEM_TEMPLATE_REGISTRY[SystemTemplateKey.GREETING].defaultContent,
            "user-a",
            undefined,
            acceptCandidate,
        );

        await prisma.system_template.update({
            where: { templateKey: SystemTemplateKey.GREETING },
            data: { content: `global-updated-${testMarker}-after-revert` },
        });

        expect(await repository.findBranchSnapshot(branchId)).not.toBeNull();
        expect((await repository.findByBranchKey(branchId, SystemTemplateKey.GREETING))?.content)
            .toBe(SYSTEM_TEMPLATE_REGISTRY[SystemTemplateKey.GREETING].defaultContent);
    });

    it("preserves custom variables when omitted and leaves no snapshot for no-op or invalid saves", async () => {
        const branchId = await createBranch();
        const customVariables = [{ key: "name", label: "Name", required: true }];
        await prisma.system_template.update({
            where: { templateKey: SystemTemplateKey.GREETING },
            data: { customVariables: jsonArray(customVariables) },
        });
        const currentContent = `global-${testMarker}-${SystemTemplateKey.GREETING}`;
        const callback = jest.fn(acceptCandidate);

        const noOp = await repository.updateBranchTemplate(
            branchId,
            SystemTemplateKey.GREETING,
            currentContent,
            "user-a",
            undefined,
            callback,
        );
        expect(noOp.changed).toBe(false);
        expect(callback).not.toHaveBeenCalled();
        expect(await repository.findBranchSnapshot(branchId)).toBeNull();

        await expect(repository.updateBranchTemplate(
            branchId,
            SystemTemplateKey.GREETING,
            `${currentContent}-invalid`,
            "user-a",
            undefined,
            async () => {
                throw new Error("candidate rejected");
            },
        )).rejects.toThrow("candidate rejected");
        expect(await repository.findBranchSnapshot(branchId)).toBeNull();

        const changed = await repository.updateBranchTemplate(
            branchId,
            SystemTemplateKey.GREETING,
            `${currentContent}-changed`,
            "user-a",
            undefined,
            acceptCandidate,
        );
        expect(changed.changed).toBe(true);
        expect((await repository.findByBranchKey(branchId, SystemTemplateKey.GREETING))?.customVariables)
            .toEqual(customVariables);
    });

    it("serializes concurrent first writes without losing either changed key", async () => {
        const branchId = await createBranch();
        const [greetingResult, reminderResult] = await Promise.all([
            repository.updateBranchTemplate(
                branchId,
                SystemTemplateKey.GREETING,
                `concurrent-${testMarker}-greeting`,
                "user-a",
                undefined,
                acceptCandidate,
            ),
            repository.updateBranchTemplate(
                branchId,
                SystemTemplateKey.SERVICE_END_REMINDER,
                `concurrent-${testMarker}-reminder`,
                "user-b",
                undefined,
                acceptCandidate,
            ),
        ]);

        expect(greetingResult.changed).toBe(true);
        expect(reminderResult.changed).toBe(true);
        const snapshot = await repository.findBranchSnapshot(branchId);
        expect(Object.keys(snapshot?.templates ?? {})).toHaveLength(templateKeys.length);
        expect(snapshot?.templates[SystemTemplateKey.GREETING]?.content)
            .toBe(`concurrent-${testMarker}-greeting`);
        expect(snapshot?.templates[SystemTemplateKey.SERVICE_END_REMINDER]?.content)
            .toBe(`concurrent-${testMarker}-reminder`);
    });

    it("fails closed when a frozen snapshot is missing a template key", async () => {
        const branchId = await createBranch();
        await repository.updateBranchTemplate(
            branchId,
            SystemTemplateKey.GREETING,
            `branch-${testMarker}-greeting`,
            "user-a",
            undefined,
            acceptCandidate,
        );
        const snapshot = await repository.findBranchSnapshot(branchId);
        delete snapshot!.templates[SystemTemplateKey.INFO];
        await prisma.branch.update({
            where: { id: branchId },
            data: { systemTemplateSnapshot: snapshot as unknown as Prisma.InputJsonValue },
        });

        await expect(repository.findByBranchKey(branchId, SystemTemplateKey.INFO))
            .rejects.toBeInstanceOf(BranchSystemTemplateSnapshotError);
        await expect(repository.findAllByBranch(branchId))
            .rejects.toBeInstanceOf(BranchSystemTemplateSnapshotError);
    });
});
