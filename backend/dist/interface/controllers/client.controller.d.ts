import { ClientService } from "application/services/client.service";
import { CreateClientDto, UpdateClientDto } from "interface/dto/client.dto";
export declare class ClientController {
    private readonly clientService;
    constructor(clientService: ClientService);
    create(dto: CreateClientDto): Promise<import("../../domain/entities/client.entity").ClientEntity>;
    findAll(): Promise<import("../../domain/entities/client.entity").ClientEntity[]>;
    findById(id: string): Promise<import("../../domain/entities/client.entity").ClientEntity>;
    update(id: string, dto: UpdateClientDto): Promise<import("../../domain/entities/client.entity").ClientEntity>;
    delete(id: string): Promise<void>;
}
