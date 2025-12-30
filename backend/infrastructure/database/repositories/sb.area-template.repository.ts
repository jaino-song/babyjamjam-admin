import { IAreaTemplateRepository } from "domain/repositories/area-template.repository.interface";
import { PrismaService } from "../prisma.service";
import { AreaTemplateEntity } from "domain/entities/area-template.entity";
import { Injectable } from "@nestjs/common";
import { AreaTemplateMapper } from "../mapper/area-template.mapper";

@Injectable()
export class SbAreaTemplateRepository implements IAreaTemplateRepository {
    constructor(private prismaService: PrismaService) {}

    async findAll(): Promise<AreaTemplateEntity[]> {
        const areaTemplates = await this.prismaService.area_template.findMany();
        return areaTemplates.map(AreaTemplateMapper.toDomain);
    }

    async findByArea(area: string): Promise<AreaTemplateEntity | null> {
        const areaTemplate = await this.prismaService.area_template.findUnique({
            where: { area },
        });
        return areaTemplate ? AreaTemplateMapper.toDomain(areaTemplate) : null;
    }

    async create(areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity> {
        const created = await this.prismaService.area_template.create({
            data: AreaTemplateMapper.toPrismaCreate(areaTemplate),
        });
        return AreaTemplateMapper.toDomain(created);
    }

    async update(areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity> {
        const updated = await this.prismaService.area_template.update({
            where: { area: areaTemplate.area },
            data: AreaTemplateMapper.toPrismaUpdate(areaTemplate),
        });
        return AreaTemplateMapper.toDomain(updated);
    }

    async delete(area: string): Promise<void> {
        await this.prismaService.area_template.delete({
            where: { area },
        });
    }
}
