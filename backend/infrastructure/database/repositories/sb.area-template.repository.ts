import { IAreaTemplateRepository } from "domain/repositories/area-template.repository.interface";
import { PrismaService } from "../prisma.service";
import { AreaTemplateEntity } from "domain/entities/area-template.entity";
import { Injectable } from "@nestjs/common";
import { AreaTemplateMapper } from "../mapper/area-template.mapper";

@Injectable()
export class SbAreaTemplateRepository implements IAreaTemplateRepository {
    constructor(private prismaService: PrismaService) {}

    async findAll(organizationid: string): Promise<AreaTemplateEntity[]> {
        const docTemplates = await this.prismaService.doc_template.findMany({
            where: { area: { organizationId: organizationid } },
        });
        return docTemplates.map(AreaTemplateMapper.toDomain);
    }

    async findByArea(organizationid: string, area: string): Promise<AreaTemplateEntity | null> {
        const docTemplate = await this.prismaService.doc_template.findFirst({
            where: { areaId: area, area: { organizationId: organizationid } },
        });
        return docTemplate ? AreaTemplateMapper.toDomain(docTemplate) : null;
    }

    async create(organizationid: string, areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity> {
        const area = await this.prismaService.area.findFirst({
            where: { id: areaTemplate.areaId, organizationId: organizationid },
            select: { id: true },
        });
        if (!area) {
            throw new Error("Area not found for organization");
        }
        const created = await this.prismaService.doc_template.create({
            data: AreaTemplateMapper.toPrismaCreate(areaTemplate),
        });
        return AreaTemplateMapper.toDomain(created);
    }

    async update(organizationid: string, areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity> {
        const existing = await this.prismaService.doc_template.findFirst({
            where: { id: areaTemplate.id, area: { organizationId: organizationid } },
        });
        if (!existing) {
            throw new Error("Area template not found for organization");
        }
        const updated = await this.prismaService.doc_template.update({
            where: { id: areaTemplate.id },
            data: AreaTemplateMapper.toPrismaUpdate(areaTemplate),
        });
        return AreaTemplateMapper.toDomain(updated);
    }

    async delete(organizationid: string, id: string): Promise<void> {
        await this.prismaService.doc_template.deleteMany({
            where: { id, area: { organizationId: organizationid } },
        });
    }
}
