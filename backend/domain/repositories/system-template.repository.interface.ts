import { SystemTemplateKey } from '../constants/system-template-registry';
import { SystemTemplateEntity } from '../entities/system-template.entity';
import { SystemTemplateVersionEntity } from '../entities/system-template-version.entity';
import {
  BranchSystemTemplateSnapshot,
  BranchSystemTemplateSnapshotEntry,
} from '../entities/branch-system-template-snapshot';
import type { Prisma } from '@prisma/client';

export const SYSTEM_TEMPLATE_REPOSITORY = Symbol('SYSTEM_TEMPLATE_REPOSITORY');

export interface BranchSystemTemplateMutationResult {
  template: SystemTemplateEntity;
  changed: boolean;
}

export type ValidateBranchSystemTemplateCandidate = (
  key: SystemTemplateKey,
  content: string,
  customVariables: BranchSystemTemplateSnapshotEntry['customVariables'],
  transaction: Prisma.TransactionClient,
) => Promise<void>;

export interface ISystemTemplateRepository {
  findByKey(key: SystemTemplateKey, transaction?: Prisma.TransactionClient): Promise<SystemTemplateEntity | null>;
  findAll(): Promise<SystemTemplateEntity[]>;
  findBranchSnapshot(branchId: string): Promise<BranchSystemTemplateSnapshot | null>;
  findByBranchKey(branchId: string, key: SystemTemplateKey): Promise<SystemTemplateEntity | null>;
  findAllByBranch(branchId: string): Promise<SystemTemplateEntity[]>;
  updateBranchTemplate(
    branchId: string,
    key: SystemTemplateKey,
    content: string,
    userId: string,
    customVariables: BranchSystemTemplateSnapshotEntry['customVariables'] | undefined,
    validateCandidate: ValidateBranchSystemTemplateCandidate,
    transaction?: Prisma.TransactionClient,
  ): Promise<BranchSystemTemplateMutationResult>;
  save(template: SystemTemplateEntity, transaction?: Prisma.TransactionClient): Promise<SystemTemplateEntity>;
  getVersionHistory(templateKey: SystemTemplateKey): Promise<SystemTemplateVersionEntity[]>;
  getVersionByNumber(
    templateKey: SystemTemplateKey,
    versionNumber: number,
    transaction?: Prisma.TransactionClient,
  ): Promise<SystemTemplateVersionEntity | null>;
  createVersion(
    templateId: string,
    content: string,
    userId: string | null,
    transaction?: Prisma.TransactionClient,
  ): Promise<SystemTemplateVersionEntity>;
}
