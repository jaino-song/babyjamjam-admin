import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CustomVariable,
  SYSTEM_TEMPLATE_REGISTRY,
  SystemTemplateKey,
  isCaregiverSystemTemplateKey,
} from 'domain/constants/system-template-registry';
import {
  BRANCH_SYSTEM_TEMPLATE_SNAPSHOT_VERSION,
  BranchSystemTemplateSnapshot,
  BranchSystemTemplateSnapshotEntry,
  BranchSystemTemplateSnapshotError,
  parseBranchSystemTemplateSnapshot,
  CaregiverTemplateLifecycleAction,
  CaregiverTemplateLifecycleResult,
} from 'domain/entities/branch-system-template-snapshot';
import { SystemTemplateEntity } from 'domain/entities/system-template.entity';
import { SystemTemplateVersionEntity } from 'domain/entities/system-template-version.entity';
import {
  BranchSystemTemplateMutationResult,
  ISystemTemplateRepository,
  ValidateBranchSystemTemplateCandidate,
} from 'domain/repositories/system-template.repository.interface';
import { PrismaService } from '../prisma.service';
import { SystemTemplateMapper } from '../mapper/system-template.mapper';

const SYSTEM_TEMPLATE_KEYS = Object.values(SystemTemplateKey) as SystemTemplateKey[];

type BranchSnapshotRow = {
  id: string;
  system_template_snapshot: Prisma.JsonValue | null;
};

type GlobalSystemTemplateRow = {
  id: string;
  templateKey: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  customVariables: Prisma.JsonValue | null;
};

const parseSnapshot = parseBranchSystemTemplateSnapshot;

function customVariablesEqual(left: CustomVariable[], right: CustomVariable[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneCustomVariables(customVariables: CustomVariable[]): CustomVariable[] {
  return customVariables.map((variable) => ({ ...variable }));
}

function defaultTemplateEntity(key: SystemTemplateKey, at = new Date()): SystemTemplateEntity {
  return SystemTemplateEntity.reconstitute(
    `default:${key}`,
    key,
    SYSTEM_TEMPLATE_REGISTRY[key].defaultContent,
    at,
    at,
    [],
  );
}

function entryToEntity(
  key: SystemTemplateKey,
  entry: BranchSystemTemplateSnapshotEntry,
): SystemTemplateEntity {
  return SystemTemplateEntity.reconstitute(
    entry.id,
    key,
    entry.content,
    new Date(entry.createdAt),
    new Date(entry.updatedAt),
    cloneCustomVariables(entry.customVariables),
  );
}

function globalRowToEntity(row: GlobalSystemTemplateRow): SystemTemplateEntity {
  return SystemTemplateMapper.toDomain(row as never);
}

function createSnapshotEntry(
  key: SystemTemplateKey,
  row: GlobalSystemTemplateRow | undefined,
  snapshotAt: Date,
): BranchSystemTemplateSnapshotEntry {
  if (row) {
    const entity = globalRowToEntity(row);
    return {
      content: entity.content,
      customVariables: cloneCustomVariables(entity.customVariables ?? []),
      id: entity.id,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  const defaultAt = snapshotAt.toISOString();
  return {
    content: SYSTEM_TEMPLATE_REGISTRY[key].defaultContent,
    customVariables: [],
    id: `default:${key}`,
    createdAt: defaultAt,
    updatedAt: defaultAt,
  };
}

function cloneSnapshot(snapshot: BranchSystemTemplateSnapshot): BranchSystemTemplateSnapshot {
  return structuredClone(snapshot);
}

@Injectable()
export class SbSystemTemplateRepository implements ISystemTemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByKey(
    key: SystemTemplateKey,
    transaction?: Prisma.TransactionClient,
  ): Promise<SystemTemplateEntity | null> {
    const row = await (transaction ?? this.prisma).system_template.findUnique({
      where: { templateKey: key },
    });
    return row ? SystemTemplateMapper.toDomain(row) : null;
  }

  async findAll(): Promise<SystemTemplateEntity[]> {
    const rows = await this.prisma.system_template.findMany({
      orderBy: { templateKey: 'asc' },
    });
    return rows.map((row) => SystemTemplateMapper.toDomain(row));
  }

  async findBranchSnapshot(branchId: string, transaction?: Prisma.TransactionClient): Promise<BranchSystemTemplateSnapshot | null> {
    const branch = await (transaction ?? this.prisma).branch.findUnique({
      where: { id: branchId },
      select: { id: true, systemTemplateSnapshot: true },
    });
    if (!branch) {
      throw new BranchSystemTemplateSnapshotError(branchId, undefined, 'branch not found');
    }
    return parseSnapshot(branch.systemTemplateSnapshot, branchId);
  }

  async findByBranchKey(
    branchId: string,
    key: SystemTemplateKey,
    transaction?: Prisma.TransactionClient,
  ): Promise<SystemTemplateEntity | null> {
    const read = async (transaction: Prisma.TransactionClient) => {
      const branch = await transaction.branch.findUnique({
        where: { id: branchId },
        select: { id: true, systemTemplateSnapshot: true },
      });
      if (!branch) {
        throw new BranchSystemTemplateSnapshotError(branchId, undefined, 'branch not found');
      }

      // A key added to the registry after the branch froze its snapshot is
      // not part of the frozen set; it resolves like an unfrozen branch.
      const entry = parseSnapshot(branch.systemTemplateSnapshot, branchId)?.templates[key];
      if (entry) {
        if (entry.state === 'disabled' || entry.state === 'deleted') throw new BranchSystemTemplateSnapshotError(branchId, key, entry.state);
        return entryToEntity(key, entry);
      }
      if (isCaregiverSystemTemplateKey(key)) return defaultTemplateEntity(key);

      const row = await transaction.system_template.findUnique({ where: { templateKey: key } });
      return row ? SystemTemplateMapper.toDomain(row) : null;
    };
    return transaction ? read(transaction) : this.prisma.$transaction(read, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 5_000,
      timeout: 15_000,
    });
  }

  async findAllByBranch(branchId: string): Promise<SystemTemplateEntity[]> {
    return this.prisma.$transaction(async (transaction) => {
      const branch = await transaction.branch.findUnique({
        where: { id: branchId },
        select: { id: true, systemTemplateSnapshot: true },
      });
      if (!branch) {
        throw new BranchSystemTemplateSnapshotError(branchId, undefined, 'branch not found');
      }

      const snapshot = parseSnapshot(branch.systemTemplateSnapshot, branchId);
      // Keys added to the registry after the snapshot was frozen resolve
      // like an unfrozen branch: global row, else registry default.
      const needsGlobalRows = !snapshot || SYSTEM_TEMPLATE_KEYS.some((key) => !snapshot.templates[key]);
      const rows = needsGlobalRows
        ? await transaction.system_template.findMany({ orderBy: { templateKey: 'asc' } })
        : [];
      const rowsByKey = new Map(
        rows.map((row) => [row.templateKey as SystemTemplateKey, row as GlobalSystemTemplateRow]),
      );
      return SYSTEM_TEMPLATE_KEYS.map((key) => {
        const entry = snapshot?.templates[key];
        if (entry) return entryToEntity(key, entry);
        if (isCaregiverSystemTemplateKey(key)) return defaultTemplateEntity(key);
        const row = rowsByKey.get(key);
        return row
          ? globalRowToEntity(row)
          : defaultTemplateEntity(key);
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 5_000,
      timeout: 15_000,
    });
  }

  async updateBranchTemplate(
    branchId: string,
    key: SystemTemplateKey,
    content: string,
    userId: string,
    customVariables: CustomVariable[] | undefined,
    validateCandidate: ValidateBranchSystemTemplateCandidate,
    transaction?: Prisma.TransactionClient,
  ): Promise<BranchSystemTemplateMutationResult> {
    const mutate = async (transaction: Prisma.TransactionClient): Promise<BranchSystemTemplateMutationResult> => {
      const rows = await transaction.$queryRaw<BranchSnapshotRow[]>(Prisma.sql`
        SELECT id, system_template_snapshot
        FROM "branch"
        WHERE id = ${branchId}::uuid
        FOR UPDATE
      `);
      const branch = rows[0];
      if (!branch) {
        throw new BranchSystemTemplateSnapshotError(branchId, undefined, 'branch not found');
      }

      const snapshot = parseSnapshot(branch.system_template_snapshot, branchId);
      const snapshotEntry = snapshot?.templates[key];
      const globalRows = snapshotEntry
        ? null
        : await transaction.system_template.findMany({ orderBy: { templateKey: 'asc' } });
      const globalRowsByKey = new Map(
        (globalRows ?? []).map((row) => [row.templateKey as SystemTemplateKey, row as GlobalSystemTemplateRow]),
      );

      // A key added after the snapshot was frozen starts from the same
      // global/default template an unfrozen branch would see.
      const currentTemplate = snapshotEntry
        ? entryToEntity(key, snapshotEntry)
        : (!isCaregiverSystemTemplateKey(key) && globalRowsByKey.get(key)
          ? globalRowToEntity(globalRowsByKey.get(key)!)
          : defaultTemplateEntity(key));
      const effectiveCustomVariables = customVariables ?? currentTemplate.customVariables ?? [];

      if (
        currentTemplate.content === content
        && customVariablesEqual(currentTemplate.customVariables ?? [], effectiveCustomVariables)
      ) {
        return { template: currentTemplate, changed: false };
      }

      await validateCandidate(key, content, effectiveCustomVariables, transaction);

      const snapshotAt = new Date();
      const nextSnapshot = snapshot
        ? cloneSnapshot(snapshot)
        : {
          version: BRANCH_SYSTEM_TEMPLATE_SNAPSHOT_VERSION,
          createdAt: snapshotAt.toISOString(),
          createdBy: userId,
          templates: Object.fromEntries(
            SYSTEM_TEMPLATE_KEYS.map((templateKey) => [
              templateKey,
              createSnapshotEntry(templateKey, isCaregiverSystemTemplateKey(templateKey) ? undefined : globalRowsByKey.get(templateKey), snapshotAt),
            ]),
          ) as BranchSystemTemplateSnapshot['templates'],
        } satisfies BranchSystemTemplateSnapshot;

      nextSnapshot.templates[key] = {
        ...snapshotEntry,
        content,
        customVariables: cloneCustomVariables(effectiveCustomVariables),
        id: currentTemplate.id || `default:${key}`,
        createdAt: currentTemplate.createdAt.toISOString(),
        updatedAt: snapshotAt.toISOString(),
      };

      await transaction.branch.update({
        where: { id: branchId },
        data: {
          systemTemplateSnapshot: nextSnapshot as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        template: entryToEntity(key, nextSnapshot.templates[key]!),
        changed: true,
      };
    };

    if (transaction) return mutate(transaction);

    return this.prisma.$transaction(mutate, {
      maxWait: 5_000,
      timeout: 15_000,
    });
  }

  async updateCaregiverTemplateLifecycle(
    branchId: string, key: SystemTemplateKey, action: CaregiverTemplateLifecycleAction, userId: string,
    transaction: Prisma.TransactionClient,
  ): Promise<CaregiverTemplateLifecycleResult> {
    if (!isCaregiverSystemTemplateKey(key) || !['activate', 'disable', 'delete', 'restore'].includes(action)) {
      throw new BranchSystemTemplateSnapshotError(branchId, key, 'unsupported lifecycle');
    }
    const rows = await transaction.$queryRaw<BranchSnapshotRow[]>(Prisma.sql`
      SELECT id, system_template_snapshot FROM "branch" WHERE id = ${branchId}::uuid FOR UPDATE
    `);
    if (!rows[0]) throw new BranchSystemTemplateSnapshotError(branchId, key, 'branch not found');
    const now = new Date();
    const snapshot = parseSnapshot(rows[0].system_template_snapshot, branchId) ?? {
      version: 2 as const, createdAt: now.toISOString(), createdBy: userId, templates: {},
    };
    const entry = snapshot.templates[key] ?? createSnapshotEntry(key, undefined, now);
    const state = entry.state ?? 'active';
    if ((state === 'deleted' && action !== 'restore' && action !== 'delete') || (action === 'restore' && state !== 'deleted')) {
      throw new BranchSystemTemplateSnapshotError(branchId, key, 'explicit restore is required for deleted templates');
    }
    const nextState = action === 'delete' ? 'deleted' : action === 'disable' ? 'disabled' : 'active';
    const { deletedAt: previousDeletedAt, ...content } = entry;
    const deletedAt = nextState === 'deleted' ? previousDeletedAt ?? now.toISOString() : undefined;
    snapshot.version = 2;
    snapshot.templates[key] = { ...content, state: nextState, updatedAt: now.toISOString(), ...(deletedAt ? { deletedAt } : {}) };
    await transaction.branch.update({ where: { id: branchId }, data: { systemTemplateSnapshot: snapshot as unknown as Prisma.InputJsonValue } });
    return { key, state: nextState, deletedAt: deletedAt ?? null, snapshotVersion: 2 };
  }

  async save(
    template: SystemTemplateEntity,
    transaction?: Prisma.TransactionClient,
  ): Promise<SystemTemplateEntity> {
    const row = await (transaction ?? this.prisma).system_template.upsert({
      where: { templateKey: template.templateKey },
      create: { templateKey: template.templateKey, content: template.content, customVariables: (template.customVariables ?? []) as any },
      update: { content: template.content, customVariables: (template.customVariables ?? []) as any, updatedAt: new Date() },
    });
    return SystemTemplateMapper.toDomain(row);
  }

  async getVersionHistory(templateKey: SystemTemplateKey): Promise<SystemTemplateVersionEntity[]> {
    const template = await this.prisma.system_template.findUnique({ where: { templateKey } });
    if (!template) return [];
    const rows = await this.prisma.system_template_version.findMany({
      where: { templateId: template.id },
      orderBy: { versionNumber: 'desc' },
    });
    return rows.map((row) => SystemTemplateMapper.versionToDomain(row));
  }

  async getVersionByNumber(
    templateKey: SystemTemplateKey,
    versionNumber: number,
    transaction?: Prisma.TransactionClient,
  ): Promise<SystemTemplateVersionEntity | null> {
    const client = transaction ?? this.prisma;
    const template = await client.system_template.findUnique({ where: { templateKey } });
    if (!template) return null;
    const row = await client.system_template_version.findUnique({
      where: { templateId_versionNumber: { templateId: template.id, versionNumber } },
    });
    return row ? SystemTemplateMapper.versionToDomain(row) : null;
  }

  async createVersion(
    templateId: string,
    content: string,
    userId: string | null,
    transaction?: Prisma.TransactionClient,
  ): Promise<SystemTemplateVersionEntity> {
    const create = async (tx: Prisma.TransactionClient) => {
      const maxVersion = await tx.system_template_version.aggregate({
        where: { templateId },
        _max: { versionNumber: true },
      });
      const nextVersionNumber = (maxVersion._max.versionNumber ?? 0) + 1;
      return tx.system_template_version.create({
        data: { templateId, content, versionNumber: nextVersionNumber, createdBy: userId },
      });
    };
    const row = transaction
      ? await create(transaction)
      : await this.prisma.$transaction(create);
    return SystemTemplateMapper.versionToDomain(row);
  }
}
