import { SYSTEM_TEMPLATE_REGISTRY, SystemTemplateKey } from "domain/constants/system-template-registry";
import { BRANCH_SYSTEM_TEMPLATE_SNAPSHOT_VERSION, BranchSystemTemplateSnapshotError, parseBranchSystemTemplateSnapshot } from "domain/entities/branch-system-template-snapshot";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbSystemTemplateRepository } from "infrastructure/database/repositories/sb.system-template.repository";

const branchId = "33dbe950-1574-4951-b7b4-92d97ab29512";
const at = "2026-09-10T00:00:00.000Z";

function entry(content: string) {
    return { content, customVariables: [], id: `id-${content}`, createdAt: at, updatedAt: at };
}

/** A snapshot frozen before CONTRACT_REMINDER existed: every other key is present. */
function snapshotWithout(missing: SystemTemplateKey | SystemTemplateKey[]) {
    const templates = Object.fromEntries(
        Object.values(SystemTemplateKey)
            .filter((key) => !(Array.isArray(missing) ? missing : [missing]).includes(key))
            .map((key) => [key, entry(`frozen-${key}`)]),
    );
    return { version: BRANCH_SYSTEM_TEMPLATE_SNAPSHOT_VERSION, createdAt: at, createdBy: "user-a", templates };
}

function setup(globalRows: Array<{ templateKey: SystemTemplateKey; content: string }> = [], missing: SystemTemplateKey | SystemTemplateKey[] = SystemTemplateKey.CONTRACT_REMINDER) {
    const branchRow = { id: branchId, systemTemplateSnapshot: snapshotWithout(missing) };
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
    it.each([1, 2])("preserves state-absent compatibility and opaque JSON in snapshot v%i", (version) => {
        const snapshot = { version, createdAt: at, createdBy: "user-a", futureRoot: { keep: ["opaque"] }, templates: {
            [SystemTemplateKey.CAREGIVER_SERVICE_START_NOTICE]: entry("legacy active content"),
            futureTemplate: { state: ["disabled"], opaque: { keep: true } },
        } };
        const parsed = parseBranchSystemTemplateSnapshot(snapshot, branchId);
        expect(parsed).toEqual(snapshot);
        expect(parsed).not.toBe(snapshot);
        expect(parsed?.templates[SystemTemplateKey.CAREGIVER_SERVICE_START_NOTICE]).not.toHaveProperty("state");
    });
    it.each([["active"], ["disabled"], ["deleted"], [], null, {}, true, 1, "unknown"].map((state) => ({ state })))("rejects non-literal persisted caregiver state %j in codec and repository", async ({ state }) => {
        const key = SystemTemplateKey.CAREGIVER_SERVICE_START_NOTICE;
        const snapshot = { version: 2, createdAt: at, createdBy: "user-a", templates: { [key]: { ...entry("malformed-state"), state } } };
        expect(() => parseBranchSystemTemplateSnapshot(snapshot, branchId)).toThrow(BranchSystemTemplateSnapshotError);
        const { repository, tx } = setup();
        tx.branch.findUnique.mockResolvedValue({ id: branchId, systemTemplateSnapshot: snapshot } as never);
        await expect(repository.findByBranchKey(branchId, key, tx as never)).rejects.toThrow(BranchSystemTemplateSnapshotError);
        expect(tx.branch.update).not.toHaveBeenCalled();
        expect(tx.system_template.findUnique).not.toHaveBeenCalled();
    });
    it("RULE-2 caregiver absence refuses global fallback and uses the approved registry body", async () => {
        const key = "CAREGIVER_SERVICE_START_NOTICE" as SystemTemplateKey;
        const { repository, tx } = setup([{ templateKey: key, content: "GLOBAL MUST NOT LEAK" }]);
        const frozen = snapshotWithout(key);
        tx.branch.findUnique.mockResolvedValue({ id: branchId, systemTemplateSnapshot: frozen });

        const result = await repository.findByBranchKey(branchId, key);

        expect(result?.content).toBe("{{employeeName}} 관리사님, {{clientName}} 고객님의 서비스가 {{serviceStartDate}}에 시작됩니다. 배정 일정과 근무 안내를 확인해 주세요. - {{branchName}}");
        expect(tx.system_template.findUnique).not.toHaveBeenCalled();
    });

    it("RULE-2 disabled v2 caregiver content remains blocked after an unrelated edit", async () => {
        const key = "CAREGIVER_SERVICE_START_NOTICE" as SystemTemplateKey;
        const { repository, tx } = setup();
        const frozen = { ...snapshotWithout(SystemTemplateKey.CONTRACT_REMINDER), version: 2,
            templates: { ...snapshotWithout(SystemTemplateKey.CONTRACT_REMINDER).templates,
                [key]: { ...entry("edited caregiver"), state: "disabled" },
                futureEntry: { opaque: "preserve exactly" } } };
        tx.$queryRaw.mockResolvedValue([{ id: branchId, system_template_snapshot: frozen }] as never);

        await repository.updateBranchTemplate(branchId, SystemTemplateKey.THANKS, "new thanks", "user-b", undefined, jest.fn());

        const saved = tx.branch.update.mock.calls[0][0].data.systemTemplateSnapshot;
        expect(saved.version).toBe(2);
        expect(saved.templates[key]).toEqual({ ...entry("edited caregiver"), state: "disabled" });
        expect(saved.templates.futureEntry).toEqual({ opaque: "preserve exactly" });
    });

    it("RULE-2 explicit lifecycle upgrades v1 only once, keeps content/tombstones, and requires restore", async () => {
        const key = SystemTemplateKey.CAREGIVER_SERVICE_START_NOTICE;
        const { repository, tx } = setup();
        let snapshot: unknown = { version: 1, createdAt: at, createdBy: "user-a", templates: {
            [key]: entry("edited caregiver"), INFO: entry("unrelated content"), futureEntry: { opaque: "keep" },
        } };
        tx.$queryRaw.mockImplementation(async () => [{ id: branchId, system_template_snapshot: snapshot }] as never);
        tx.branch.update.mockImplementation(async (input) => { snapshot = input.data.systemTemplateSnapshot; });
        expect(await repository.updateCaregiverTemplateLifecycle(branchId, key, "disable", "user-b", tx as never))
            .toMatchObject({ state: "disabled", snapshotVersion: 2, deletedAt: null });
        expect((snapshot as { version: number }).version).toBe(2);
        await repository.updateBranchTemplate(branchId, key, "edited while disabled", "user-b", undefined, jest.fn(), tx as never);
        expect((snapshot as { templates: Record<string, unknown> }).templates[key]).toMatchObject({ content: "edited while disabled", state: "disabled" });
        expect((snapshot as { templates: Record<string, unknown> }).templates["INFO"]).toEqual(entry("unrelated content"));
        expect((snapshot as { templates: Record<string, unknown> }).templates["futureEntry"]).toEqual({ opaque: "keep" });
        expect(await repository.updateCaregiverTemplateLifecycle(branchId, key, "delete", "user-b", tx as never))
            .toMatchObject({ state: "deleted", deletedAt: expect.any(String), snapshotVersion: 2 });
        await expect(repository.updateCaregiverTemplateLifecycle(branchId, key, "activate", "user-b", tx as never)).rejects.toThrow("explicit restore");
        expect(await repository.updateCaregiverTemplateLifecycle(branchId, key, "restore", "user-b", tx as never))
            .toEqual({ key: "CAREGIVER_SERVICE_START_NOTICE", state: "active", deletedAt: null, snapshotVersion: 2 });
        expect((snapshot as { templates: Record<string, unknown> }).templates[key]).toMatchObject({ content: "edited while disabled", state: "active" });
        expect((snapshot as { templates: Record<string, unknown> }).templates[key]).not.toHaveProperty("deletedAt");
    });

    it("RULE-2 ordinary v1 content edit retains version1 and an unknown version refuses every write", async () => {
        const { repository, tx } = setup();
        await repository.updateBranchTemplate(branchId, SystemTemplateKey.THANKS, "new thanks", "user-b", undefined, jest.fn());
        expect(tx.branch.update.mock.calls[0][0].data.systemTemplateSnapshot.version).toBe(1);
        tx.branch.update.mockClear();
        tx.$queryRaw.mockResolvedValue([{ id: branchId, system_template_snapshot: { version: 99 } }] as never);
        await expect(repository.updateCaregiverTemplateLifecycle(branchId, SystemTemplateKey.CAREGIVER_SERVICE_START_NOTICE, "disable", "user-b", tx as never)).rejects.toThrow("snapshot");
        expect(tx.branch.update).not.toHaveBeenCalled();
    });

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


describe("the four create-only templates on an old ten-key branch snapshot", () => {
    const newKeys = [SystemTemplateKey.CONTRACT_GUIDE, SystemTemplateKey.MATERNAL_NOTICE,
        SystemTemplateKey.PROVIDER_NOTICE, SystemTemplateKey.SERVICE_RECORD_REMINDER];

    it("preserves all frozen bodies and exposes four empty defaults without writing the snapshot", async () => {
        const { repository, tx } = setup([], newKeys);
        const templates = await repository.findAllByBranch(branchId);
        expect(templates).toHaveLength(14);
        for (const template of templates) {
            expect(template.content).toBe(newKeys.includes(template.templateKey) ? "" : `frozen-${template.templateKey}`);
        }
        expect(tx.branch.update).not.toHaveBeenCalled();
    });

    it.each(newKeys)("uses a saved global body for %s without replacing frozen content", async (key) => {
        const { repository } = setup([{ templateKey: key, content: "owner edit" }], newKeys);
        const templates = await repository.findAllByBranch(branchId);
        expect(templates.find((template) => template.templateKey === key)?.content).toBe("owner edit");
        expect(templates.find((template) => template.templateKey === SystemTemplateKey.SERVICE_INFO)?.content).toBe("frozen-SERVICE_INFO");
    });
});
