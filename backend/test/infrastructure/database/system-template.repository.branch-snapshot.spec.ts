import { SYSTEM_TEMPLATE_REGISTRY, SystemTemplateKey } from "domain/constants/system-template-registry";
import { BRANCH_SYSTEM_TEMPLATE_SNAPSHOT_VERSION } from "domain/entities/branch-system-template-snapshot";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbSystemTemplateRepository } from "infrastructure/database/repositories/sb.system-template.repository";

const branchId = "33dbe950-1574-4951-b7b4-92d97ab29512";
const at = "2026-09-10T00:00:00.000Z";

function entry(content: string) {
    return { content, customVariables: [], id: `id-${content}`, createdAt: at, updatedAt: at };
}

/** A snapshot frozen before CONTRACT_REMINDER existed: every other key is present. */
function snapshotWithout(missing: SystemTemplateKey) {
    const templates = Object.fromEntries(
        Object.values(SystemTemplateKey)
            .filter((key) => key !== missing)
            .map((key) => [key, entry(`frozen-${key}`)]),
    );
    return { version: BRANCH_SYSTEM_TEMPLATE_SNAPSHOT_VERSION, createdAt: at, createdBy: "user-a", templates };
}

function setup(globalRows: Array<{ templateKey: SystemTemplateKey; content: string }> = []) {
    const branchRow = { id: branchId, systemTemplateSnapshot: snapshotWithout(SystemTemplateKey.CONTRACT_REMINDER) };
    const rows = globalRows.map((row) => ({
        id: `global-${row.templateKey}`,
        templateKey: row.templateKey,
        content: row.content,
        customVariables: [],
        createdAt: new Date(at),
        updatedAt: new Date(at),
    }));
    const tx = {
        branch: {
            findUnique: jest.fn().mockResolvedValue(branchRow),
            update: jest.fn().mockResolvedValue(undefined),
        },
        system_template: {
            findMany: jest.fn().mockResolvedValue(rows),
            findUnique: jest.fn(({ where }: { where: { templateKey: string } }) =>
                Promise.resolve(rows.find((row) => row.templateKey === where.templateKey) ?? null)),
        },
        $queryRaw: jest.fn().mockResolvedValue([{ id: branchId, system_template_snapshot: branchRow.systemTemplateSnapshot }]),
    };
    const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    return { tx, repository: new SbSystemTemplateRepository(prisma as unknown as PrismaService) };
}

describe("SbSystemTemplateRepository — key added after the branch snapshot froze", () => {
    it("lists every template, using the registry default for the missing key", async () => {
        const { repository } = setup();

        const all = await repository.findAllByBranch(branchId);

        expect(all.map((t) => t.templateKey)).toEqual(Object.values(SystemTemplateKey));
        expect(all.find((t) => t.templateKey === SystemTemplateKey.CONTRACT_REMINDER)?.content)
            .toBe(SYSTEM_TEMPLATE_REGISTRY[SystemTemplateKey.CONTRACT_REMINDER].defaultContent);
        expect(all.find((t) => t.templateKey === SystemTemplateKey.THANKS)?.content)
            .toBe(`frozen-${SystemTemplateKey.THANKS}`);
    });

    it("prefers the global row over the registry default for the missing key", async () => {
        const { repository } = setup([{ templateKey: SystemTemplateKey.CONTRACT_REMINDER, content: "global-edit" }]);

        const all = await repository.findAllByBranch(branchId);
        const one = await repository.findByBranchKey(branchId, SystemTemplateKey.CONTRACT_REMINDER);

        expect(all.find((t) => t.templateKey === SystemTemplateKey.CONTRACT_REMINDER)?.content).toBe("global-edit");
        expect(one?.content).toBe("global-edit");
    });

    it("keeps reading frozen keys from the snapshot", async () => {
        const { repository } = setup([{ templateKey: SystemTemplateKey.THANKS, content: "global-edit" }]);

        const thanks = await repository.findByBranchKey(branchId, SystemTemplateKey.THANKS);

        expect(thanks?.content).toBe(`frozen-${SystemTemplateKey.THANKS}`);
    });

    it("adds the missing key to the snapshot on a branch edit", async () => {
        const { repository, tx } = setup();

        const result = await repository.updateBranchTemplate(
            branchId,
            SystemTemplateKey.CONTRACT_REMINDER,
            "branch wording",
            "user-b",
            undefined,
            jest.fn().mockResolvedValue(undefined),
        );

        expect(result).toMatchObject({ changed: true, template: { content: "branch wording" } });
        const saved = tx.branch.update.mock.calls[0][0].data.systemTemplateSnapshot;
        expect(saved.templates[SystemTemplateKey.CONTRACT_REMINDER].content).toBe("branch wording");
        expect(saved.templates[SystemTemplateKey.THANKS].content).toBe(`frozen-${SystemTemplateKey.THANKS}`);
    });
});
