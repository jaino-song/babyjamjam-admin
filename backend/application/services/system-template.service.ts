import { BadRequestException, Injectable } from "@nestjs/common";
import { SystemTemplateWithRegistryDto } from "application/dto/system-template-with-registry.dto";
import {
    GetAllSystemTemplatesUseCase,
    GetSystemTemplateUseCase,
    GetVersionContentUseCase,
    GetVersionHistoryUseCase,
    RenderTemplateUseCase,
    ResetToDefaultUseCase,
    RollbackToVersionUseCase,
    UpdateSystemTemplateUseCase,
    ValidateTemplateContentUseCase,
} from "application/usecases/system-template";
import { SYSTEM_TEMPLATE_REGISTRY, SystemTemplateKey } from "domain/constants/system-template-registry";
import { SystemTemplateEntity, VariableValidationResult } from "domain/entities/system-template.entity";
import { SystemTemplateVersionEntity } from "domain/entities/system-template-version.entity";

@Injectable()
export class SystemTemplateService {
    constructor(
        private readonly getAllUseCase: GetAllSystemTemplatesUseCase,
        private readonly getByKeyUseCase: GetSystemTemplateUseCase,
        private readonly updateUseCase: UpdateSystemTemplateUseCase,
        private readonly validateUseCase: ValidateTemplateContentUseCase,
        private readonly renderUseCase: RenderTemplateUseCase,
        private readonly getVersionHistoryUseCase: GetVersionHistoryUseCase,
        private readonly getVersionContentUseCase: GetVersionContentUseCase,
        private readonly rollbackUseCase: RollbackToVersionUseCase,
        private readonly resetToDefaultUseCase: ResetToDefaultUseCase,
    ) {}

    async getAll(): Promise<SystemTemplateWithRegistryDto[]> {
        const entities = await this.getAllUseCase.execute();
        return entities.map((entity) => this.enrichFromRegistry(entity));
    }

    async getByKey(key: string): Promise<SystemTemplateWithRegistryDto> {
        const entity = await this.getByKeyUseCase.execute(this.toKey(key));
        return this.enrichFromRegistry(entity);
    }

    update(key: string, content: string, userId: string): Promise<SystemTemplateEntity> {
        return this.updateUseCase.execute(this.toKey(key), content, userId);
    }

    validate(key: string, content: string): Promise<VariableValidationResult> {
        return this.validateUseCase.execute(this.toKey(key), content);
    }

    async preview(key: string, data: Record<string, unknown>, content?: string): Promise<string> {
        if (!content) {
            return this.renderUseCase.execute(this.toKey(key), data);
        }

        return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (match: string, variableKey: string) => {
            const value = data[variableKey];
            if (value === undefined || value === null) return match;
            return String(value);
        });
    }

    getVersionHistory(key: string): Promise<SystemTemplateVersionEntity[]> {
        return this.getVersionHistoryUseCase.execute(this.toKey(key));
    }

    getVersionContent(key: string, versionNumber: number): Promise<SystemTemplateVersionEntity> {
        return this.getVersionContentUseCase.execute(this.toKey(key), versionNumber);
    }

    rollback(key: string, versionNumber: number, userId: string): Promise<SystemTemplateEntity> {
        return this.rollbackUseCase.execute(this.toKey(key), versionNumber, userId);
    }

    resetToDefault(key: string, userId: string): Promise<SystemTemplateEntity> {
        return this.resetToDefaultUseCase.execute(this.toKey(key), userId);
    }

    private enrichFromRegistry(entity: SystemTemplateEntity): SystemTemplateWithRegistryDto {
        const registryEntry = SYSTEM_TEMPLATE_REGISTRY[entity.templateKey];
        return {
            id: entity.id,
            templateKey: entity.templateKey,
            name: registryEntry?.name ?? entity.templateKey,
            description: registryEntry?.description ?? "",
            content: entity.content,
            requiredVariables: registryEntry?.requiredVariables ?? [],
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
        };
    }

    private toKey(key: string): SystemTemplateKey {
        const allowedKeys = Object.values(SystemTemplateKey) as string[];
        if (!allowedKeys.includes(key)) {
            throw new BadRequestException(`Invalid template key: ${key}`);
        }
        return key as SystemTemplateKey;
    }
}
