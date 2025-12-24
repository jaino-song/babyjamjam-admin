import { Injectable } from "@nestjs/common";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EformsignDocMapper } from "infrastructure/database/mapper/eformsign-doc.mapper";

@Injectable()
export class SbEformsignDocRepository implements IEformsignDocRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(id: number): Promise<EformsignDocEntity | null> {
        const doc = await this.prismaService.eformsign_doc.findUnique({
            where: { id },
        });
        return doc ? EformsignDocMapper.toDomain(doc) : null;
    }

    async findByDocumentId(documentId: string): Promise<EformsignDocEntity | null> {
        const doc = await this.prismaService.eformsign_doc.findUnique({
            where: { document_id: documentId },
        });
        return doc ? EformsignDocMapper.toDomain(doc) : null;
    }

    async findByClientId(clientId: number): Promise<EformsignDocEntity[]> {
        const docs = await this.prismaService.eformsign_doc.findMany({
            where: { client_id: clientId },
        });
        return docs.map(EformsignDocMapper.toDomain);
    }

    async findAll(): Promise<EformsignDocEntity[]> {
        const docs = await this.prismaService.eformsign_doc.findMany();
        return docs.map(EformsignDocMapper.toDomain);
    }

    // async create(doc: EformsignDocEntity): Promise<EformsignDocEntity> {
    //     const created = await this.prismaService.eformsign_doc.create({
    //         data: EformsignDocMapper.toPrismaCreate(doc),
    //     });
    //     return EformsignDocMapper.toDomain(created);
    // }

    // async update(doc: EformsignDocEntity): Promise<EformsignDocEntity> {
    //     if (!doc.id) {
    //         throw new Error("Cannot update eformsign_doc without id");
    //     }
    //     const updated = await this.prismaService.eformsign_doc.update({
    //         where: { id: doc.id },
    //         data: EformsignDocMapper.toPrismaUpdate(doc),
    //     });
    //     return EformsignDocMapper.toDomain(updated);
    // }

    // async upsertByDocumentId(doc: EformsignDocEntity): Promise<EformsignDocEntity> {
    //     const data = EformsignDocMapper.toPrismaCreate(doc);
    //     const upserted = await this.prismaService.eformsign_doc.upsert({
    //         where: { document_id: doc.documentId },
    //         create: data,
    //         update: data,
    //     });
    //     return EformsignDocMapper.toDomain(upserted);
    // }

    // async delete(id: number): Promise<void> {
    //     await this.prismaService.eformsign_doc.delete({
    //         where: { id },
    //     });
    // }

    // async deleteByDocumentId(documentId: string): Promise<void> {
    //     await this.prismaService.eformsign_doc.delete({
    //         where: { document_id: documentId },
    //     });
    // }
}
