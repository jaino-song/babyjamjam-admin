import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ClientEntity } from "domain/entities/client.entity";

describe("SbClientRepository", () => {
    const clientModel = {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    };

    const prisma = { client: clientModel } as unknown as PrismaService;
    const repository = new SbClientRepository(prisma);

    const row = {
        id: 1,
        name: "John Doe",
        primary_employee_id: 10,
        secondary_employee_id: 11,
        address: "Incheon",
        phone: "010-1111-2222",
        type: "A",
        duration: 15,
        full_price: "100000",
        grant: "50000",
        actual_price: "50000",
        start_date: new Date("2024-01-01T00:00:00.000Z"),
        end_date: new Date("2024-06-01T00:00:00.000Z"),
        care_center: true,
        voucher_client: false,
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns a client when findById finds a match", async () => {
        clientModel.findUnique.mockResolvedValue(row);

        const result = await repository.findById(1);

        expect(clientModel.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
        expect(result).toMatchObject({
            id: 1,
            name: "John Doe",
            primaryEmployeeId: 10,
            careCenter: true,
        });
        expect(result).toBeInstanceOf(ClientEntity);
    });

    it("returns null when findById has no match", async () => {
        clientModel.findUnique.mockResolvedValue(null);

        const result = await repository.findById(99);

        expect(clientModel.findUnique).toHaveBeenCalledWith({ where: { id: 99 } });
        expect(result).toBeNull();
    });

    it("returns mapped clients for findAll", async () => {
        clientModel.findMany.mockResolvedValue([row, { ...row, id: 2, name: "Jane" }]);

        const result = await repository.findAll();

        expect(clientModel.findMany).toHaveBeenCalledWith();
        expect(result).toHaveLength(2);
        expect(result[1]).toMatchObject({ id: 2, name: "Jane" });
    });

    it("creates a client via Prisma", async () => {
        const entity = ClientEntity.create({
            name: "Create",
            primaryEmployeeId: 1,
            secondaryEmployeeId: 2,
            address: "Somewhere",
            phone: "010-0000-1111",
            type: "B",
            duration: 12,
            fullPrice: "120000",
            grant: "60000",
            actualPrice: "60000",
            startDate: new Date("2024-02-01T00:00:00.000Z"),
            endDate: new Date("2024-08-01T00:00:00.000Z"),
            careCenter: false,
            voucherClient: true,
        });

        const createdRow = { ...row, id: 5, name: "Create" };
        clientModel.create.mockResolvedValue(createdRow);

        const result = await repository.create(entity);

        expect(clientModel.create).toHaveBeenCalledWith({
            data: {
                name: "Create",
                primary_employee_id: 1,
                secondary_employee_id: 2,
                address: "Somewhere",
                phone: "010-0000-1111",
                type: "B",
                duration: 12,
                full_price: "120000",
                grant: "60000",
                actual_price: "60000",
                start_date: new Date("2024-02-01T00:00:00.000Z"),
                end_date: new Date("2024-08-01T00:00:00.000Z"),
                care_center: false,
                voucher_client: true,
            },
        });
        expect(result).toMatchObject({ id: 5, name: "Create" });
    });

    it("updates a client via Prisma", async () => {
        const entity = new ClientEntity(
            7,
            "Update",
            3,
            null,
            "Addr",
            "010-3333-4444",
            "C",
            6,
            "60000",
            "30000",
            "30000",
            new Date("2024-03-01T00:00:00.000Z"),
            new Date("2024-09-01T00:00:00.000Z"),
            true,
            false,
        );

        const updatedRow = { ...row, id: 7, name: "Update" };
        clientModel.update.mockResolvedValue(updatedRow);

        const result = await repository.update(entity);

        expect(clientModel.update).toHaveBeenCalledWith({
            where: { id: 7 },
            data: {
                name: "Update",
                primary_employee_id: 3,
                secondary_employee_id: null,
                address: "Addr",
                phone: "010-3333-4444",
                type: "C",
                duration: 6,
                full_price: "60000",
                grant: "30000",
                actual_price: "30000",
                start_date: new Date("2024-03-01T00:00:00.000Z"),
                end_date: new Date("2024-09-01T00:00:00.000Z"),
                care_center: true,
                voucher_client: false,
            },
        });
        expect(result).toMatchObject({ id: 7, name: "Update" });
    });

    it("deletes a client", async () => {
        clientModel.delete.mockResolvedValue(undefined);

        await repository.delete(4);

        expect(clientModel.delete).toHaveBeenCalledWith({ where: { id: 4 } });
    });
});