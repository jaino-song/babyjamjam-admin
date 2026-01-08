import { ClientEntity } from "domain/entities/client.entity";
import { IClientRepository, PaginatedResult } from "domain/repositories/client.repository.interface";

/**
 * 테스트용 Mock Client Repository
 * In-memory 저장소로 동작하며, 테스트 간 독립성 보장
 */
export class MockClientRepository implements IClientRepository {
    private clients: Map<number, ClientEntity> = new Map();
    private nextId: number = 1;

    /**
     * 테스트 데이터 초기화
     */
    reset(): void {
        this.clients.clear();
        this.nextId = 1;
    }

    /**
     * 테스트 데이터 직접 설정
     */
    setData(clients: ClientEntity[]): void {
        this.clients.clear();
        clients.forEach(client => {
            this.clients.set(client.id, client);
            if (client.id >= this.nextId) {
                this.nextId = client.id + 1;
            }
        });
    }

    /**
     * 저장된 모든 데이터 조회 (테스트 검증용)
     */
    getAllData(): ClientEntity[] {
        return Array.from(this.clients.values());
    }

    async findById(id: number): Promise<ClientEntity | null> {
        return this.clients.get(id) ?? null;
    }

    async findAll(): Promise<ClientEntity[]> {
        return Array.from(this.clients.values());
    }

    async findAllPaginated(
        page: number,
        limit: number,
        search?: string,
    ): Promise<PaginatedResult<ClientEntity>> {
        let data = Array.from(this.clients.values());

        // 검색 필터 적용
        if (search) {
            const searchLower = search.toLowerCase();
            data = data.filter(
                client =>
                    client.name.toLowerCase().includes(searchLower) ||
                    client.address?.toLowerCase().includes(searchLower) ||
                    client.phone?.toLowerCase().includes(searchLower),
            );
        }

        const total = data.length;
        const totalPages = Math.ceil(total / limit);
        const startIndex = (page - 1) * limit;
        const paginatedData = data.slice(startIndex, startIndex + limit);

        return {
            data: paginatedData,
            total,
            page,
            limit,
            totalPages,
        };
    }

    async create(client: ClientEntity): Promise<ClientEntity> {
        // ID가 없으면 자동 생성
        const id = client.id > 0 ? client.id : this.nextId++;
        const newClient = ClientEntity.reconstitute(
            id,
            client.name,
            client.address,
            client.phone,
            client.type,
            client.duration,
            client.fullPrice,
            client.grant,
            client.actualPrice,
            client.startDate,
            client.endDate,
            client.careCenter,
            client.voucherClient,
            client.birthday,
            client.serviceStatus,
            client.breastPump,
            client.eDocId,
        );
        this.clients.set(id, newClient);
        return newClient;
    }

    async update(client: ClientEntity): Promise<ClientEntity> {
        if (!this.clients.has(client.id)) {
            throw new Error(`Client with id ${client.id} not found`);
        }
        this.clients.set(client.id, client);
        return client;
    }

    async delete(id: number): Promise<void> {
        if (!this.clients.has(id)) {
            throw new Error(`Client with id ${id} not found`);
        }
        this.clients.delete(id);
    }
}
