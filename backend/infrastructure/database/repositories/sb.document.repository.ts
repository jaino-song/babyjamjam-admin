import { Injectable } from "@nestjs/common";
import { DocumentEntity } from "domain/entities/document.entity";
import { IDocumentRepository } from "domain/repositories/document.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { DocumentMapper } from "infrastructure/database/mapper/document.mapper";

@Injectable()
export class SbDocumentRepository implements IDocumentRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(id: string): Promise<DocumentEntity | null> {
        const doc = await this.prismaService.document.findUnique({
            where: { id },
        });
        return doc ? DocumentMapper.toDomain(doc) : null;
    }

    async findByOrgId(orgid: string): Promise<DocumentEntity[]> {
        const docs = await this.prismaService.document.findMany({
            where: { orgId: orgid },
        });
        return docs.map(DocumentMapper.toDomain);
    }

    async findByCategoryId(categoryId: string): Promise<DocumentEntity[]> {
        const docs = await this.prismaService.document.findMany({
            where: { categoryId },
        });
        return docs.map(DocumentMapper.toDomain);
    }

    async findAll(): Promise<DocumentEntity[]> {
        const docs = await this.prismaService.document.findMany();
        return docs.map(DocumentMapper.toDomain);
    }

    async create(doc: DocumentEntity): Promise<DocumentEntity> {
        const created = await this.prismaService.document.create({
            data: DocumentMapper.toPrismaCreate(doc),
        });
        return DocumentMapper.toDomain(created);
    }

    async update(doc: DocumentEntity): Promise<DocumentEntity> {
        if (!doc.id) {
            throw new Error("Cannot update document without id");
        }
        const updated = await this.prismaService.document.update({
            where: { id: doc.id },
            data: DocumentMapper.toPrismaUpdate(doc),
        });
        return DocumentMapper.toDomain(updated);
    }

    async delete(id: string): Promise<void> {
        await this.prismaService.document.delete({
            where: { id },
        });
    }
}
