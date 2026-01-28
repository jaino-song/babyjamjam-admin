import { Injectable } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";

export interface DocumentCategory {
    id: string;
    value: string;
    label: string;
    color: string;
    isCustom: boolean;
    createdAt: Date;
}

@Injectable()
export class DocumentCategoryService {
    constructor(private readonly prisma: PrismaService) {}

    async findAll(): Promise<DocumentCategory[]> {
        const categories = await this.prisma.document_category.findMany({
            orderBy: { createdAt: "asc" },
        });
        return categories.map((c) => ({
            id: c.id,
            value: c.value,
            label: c.label,
            color: c.color,
            isCustom: c.isCustom,
            createdAt: c.createdAt,
        }));
    }

    async create(params: {
        value: string;
        label: string;
        color: string;
    }): Promise<DocumentCategory> {
        const category = await this.prisma.document_category.create({
            data: {
                value: params.value,
                label: params.label,
                color: params.color,
                isCustom: true,
            },
        });
        return {
            id: category.id,
            value: category.value,
            label: category.label,
            color: category.color,
            isCustom: category.isCustom,
            createdAt: category.createdAt,
        };
    }

    async delete(id: string): Promise<void> {
        await this.prisma.document_category.delete({
            where: { id },
        });
    }
}
