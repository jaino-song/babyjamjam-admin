import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CustomVariable,
  SYSTEM_TEMPLATE_REGISTRY,
  SystemTemplateKey,
} from 'domain/constants/system-template-registry';
import {
  BRANCH_SYSTEM_TEMPLATE_SNAPSHOT_VERSION,
  BranchSystemTemplateSnapshot,
  BranchSystemTemplateSnapshotEntry,
  BranchSystemTemplateSnapshotError,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCustomVariables(
  value: unknown,
  branchId: string,
  templateKey: SystemTemplateKey,
): CustomVariable[] {
  if (!Array.isArray(value)) {
    throw new BranchSystemTemplateSnapshotError(branchId, templateKey, 'custom variables are invalid');
  }

  return value.map((item) => {
    if (
      !isRecord(item)
      || typeof item['key'] !== 'string'
      || item['key'].length === 0
      || typeof item['label'] !== 'string'
      || item['label'].length === 0
      || typeof item['required'] !== 'boolean'
    ) {
      throw new BranchSystemTemplateSnapshotError(branchId, templateKey, 'custom variables are invalid');
    }
    return {
      key: item['key'],
      label: item['label'],
      required: item['required'],
    };
  });
}

function readSnapshotEntry(
  value: unknown,
  branchId: string,
  templateKey: SystemTemplateKey,
): BranchSystemTemplateSnapshotEntry {
  if (!isRecord(value)) {
    throw new BranchSystemTemplateSnapshotError(branchId, templateKey);
  }

  const { content, id, createdAt, updatedAt } = value;
  if (
    typeof content !== 'string'
    || typeof id !== 'string'
    || id.length === 0
    || typeof createdAt !== 'string'
    || Number.isNaN(new Date(createdAt).getTime())
    || typeof updatedAt !== 'string'
    || Number.isNaN(new Date(updatedAt).getTime())
  ) {
    throw new BranchSystemTemplateSnapshotError(branchId, templateKey);
  }

  return {
    content,
    customVariables: readCustomVariables(value['customVariables'], branchId, templateKey),
    id,
    createdAt,
    updatedAt,
  };
}

function parseSnapshot(
  value: Prisma.JsonValue | null,
  branchId: string,
): BranchSystemTemplateSnapshot | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new BranchSystemTemplateSnapshotError(branchId);
  }

  if (
    value['version'] !== BRANCH_SYSTEM_TEMPLATE_SNAPSHOT_VERSION
    || typeof value['createdAt'] !== 'string'
    || Number.isNaN(new Date(value['createdAt']).getTime())
    || typeof value['createdBy'] !== 'string'
    || value['createdBy'].length === 0
    || !isRecord(value['templates'])
  ) {
    throw new BranchSystemTemplateSnapshotError(branchId);
  }

  const templates: Partial<Record<SystemTemplateKey, BranchSystemTemplateSnapshotEntry>> = {};
  for (const [rawKey, entry] of Object.entries(value['templates'])) {
    if (!SYSTEM_TEMPLATE_KEYS.includes(rawKey as SystemTemplateKey)) continue;
    const key = rawKey as SystemTemplateKey;
    templates[key] = readSnapshotEntry(entry, branchId, key);
  }

  return {
    version: BRANCH_SYSTEM_TEMPLATE_SNAPSHOT_VERSION,
    createdAt: value['createdAt'],
    createdBy: value['createdBy'],
    templates,
  };
}

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
  const templates: Partial<Record<SystemTemplateKey, BranchSystemTemplateSnapshotEntry>> = {};
  for (const [rawKey, entry] of Object.entries(snapshot.templates)) {
    if (!entry || !SYSTEM_TEMPLATE_KEYS.includes(rawKey as SystemTemplateKey)) continue;
    templates[rawKey as SystemTemplateKey] = {
      ...entry,
      customVariables: cloneCustomVariables(entry.customVariables),
    };
  }
  return {
    version: BRANCH_SYSTEM_TEMPLATE_SNAPSHOT_VERSION,
    createdAt: snapshot.createdAt,
    createdBy: snapshot.createdBy,
    templates,
  };
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

  async findBranchSnapshot(branchId: string): Promise<BranchSystemTemplateSnapshot | null> {
    const branch = await this.prisma.branch.findUnique({
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
  ): Promise<SystemTemplateEntity | null> {
    return this.prisma.$transaction(async (transaction) => {
      const branch = await transaction.branch.findUnique({
        where: { id: branchId },
        select: { id: true, systemTemplateSnapshot: true },
      });
      if (!branch) {
        throw new BranchSystemTemplateSnapshotError(branchId, undefined, 'branch not found');
      }

      const snapshot = parseSnapshot(branch.systemTemplateSnapshot, branchId);
      if (snapshot) {
        const entry = snapshot.templates[key];
        if (!entry) {
          throw new BranchSystemTemplateSnapshotError(
            branchId,
            key,
            'template key is missing from the frozen snapshot',
          );
        }
        return entryToEntity(key, entry);
      }

      const row = await transaction.system_template.findUnique({ where: { templateKey: key } });
      return row ? SystemTemplateMapper.toDomain(row) : null;
    }, {
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
      if (snapshot) {
        return SYSTEM_TEMPLATE_KEYS.map((key) => {
          const entry = snapshot.templates[key];
          if (!entry) {
            throw new BranchSystemTemplateSnapshotError(
              branchId,
              key,
              'template key is missing from the frozen snapshot',
            );
          }
          return entryToEntity(key, entry);
        });
      }

      const rows = await transaction.system_template.findMany({
        orderBy: { templateKey: 'asc' },
      });
      const rowsByKey = new Map(
        rows.map((row) => [row.templateKey as SystemTemplateKey, row as GlobalSystemTemplateRow]),
      );
      return SYSTEM_TEMPLATE_KEYS.map((key) => {
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
      const globalRows = snapshot
        ? null
        : await transaction.system_template.findMany({ orderBy: { templateKey: 'asc' } });
      const globalRowsByKey = new Map(
        (globalRows ?? []).map((row) => [row.templateKey as SystemTemplateKey, row as GlobalSystemTemplateRow]),
      );

      const currentTemplate = snapshot
        ? (() => {
          const entry = snapshot.templates[key];
          if (!entry) {
            throw new BranchSystemTemplateSnapshotError(
              branchId,
              key,
              'template key is missing from the frozen snapshot',
            );
          }
          return entryToEntity(key, entry);
        })()
        : (globalRowsByKey.get(key)
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
              createSnapshotEntry(templateKey, globalRowsByKey.get(templateKey), snapshotAt),
            ]),
          ) as BranchSystemTemplateSnapshot['templates'],
        } satisfies BranchSystemTemplateSnapshot;

      nextSnapshot.templates[key] = {
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
