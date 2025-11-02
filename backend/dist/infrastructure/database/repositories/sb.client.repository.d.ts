import { ClientEntity } from "domain/entities/client.entity";
import { IClientRepository } from "domain/repositories/client.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
export declare class SbClientRepository implements IClientRepository {
    private readonly prismaService;
    constructor(prismaService: PrismaService);
    findById(id: number): Promise<ClientEntity | null>;
    findAll(): Promise<ClientEntity[]>;
    create(client: ClientEntity): Promise<ClientEntity>;
    update(client: ClientEntity): Promise<ClientEntity>;
    delete(id: number): Promise<void>;
}
