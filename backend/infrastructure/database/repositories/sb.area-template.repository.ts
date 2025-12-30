import { IAreaTemplateRepository } from "domain/repositories/area-template.repository.interface";
import { PrismaService } from "../prisma.service";
import { AreaTemplateEntity } from "domain/entities/area-template.entity";
import { Injectable } from "@nestjs/common";
import { AreaTemplateMapper } from "../mapper/area-template.mapper";

@Injectable()
export class SbAreaTemplateRepository implements IAreaTemplateRepository {
    constructor(private prismaService: PrismaService) {}

    async findAll(): Promise<AreaTemplateEntity[]> {
        const docTemplates = await this.prismaService.doc_template.findMany();
        return docTemplates.map(AreaTemplateMapper.toDomain);
    }

    async findByArea(area: string): Promise<AreaTemplateEntity | null> {
        const docTemplate = await this.prismaService.doc_template.findFirst({
            where: { area_id: area },
        });
        return docTemplate ? AreaTemplateMapper.toDomain(docTemplate) : null;
    }

    async create(areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity> {
        const created = await this.prismaService.doc_template.create({
            data: AreaTemplateMapper.toPrismaCreate(areaTemplate),
        });
        return AreaTemplateMapper.toDomain(created);
    }

    async update(areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity> {
        const updated = await this.prismaService.doc_template.update({
            where: { id: areaTemplate.id },
            data: AreaTemplateMapper.toPrismaUpdate(areaTemplate),
        });
        return AreaTemplateMapper.toDomain(updated);
    }

    async delete(id: string): Promise<void> {
        await this.prismaService.doc_template.delete({
            where: { id },
        });
    }
}
