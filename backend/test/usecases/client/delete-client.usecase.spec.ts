import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { DeleteClientUsecase } from "application/usecases/client/delete-client.usecase";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { clearSchemaCapabilityCache } from "infrastructure/database/schema-capabilities";
import { MockClientRepository, ClientFactory } from "../../utils";

describe("DeleteClientUsecase", () => {
    // ============================================
    // Basic contract (in-memory MockClientRepository)
    // ============================================
    describe("execute (against IClientRepository contract)", () => {
        let usecase: DeleteClientUsecase;
        let mockRepository: MockClientRepository;
        const branchId = "org-1";

        beforeEach(() => {
            mockRepository = new MockClientRepository();
            usecase = new DeleteClientUsecase(mockRepository);
        });

        afterEach(() => {
            mockRepository.reset();
        });

        it("should delete existing client", async () => {
            const existingClient = ClientFactory.create({ id: 1 });
            mockRepository.setData([existingClient]);

            await usecase.execute(branchId, 1);

            const result = await mockRepository.findById(branchId, 1);
            expect(result).toBeNull();
        });

        it("should throw NotFoundException when client not found", async () => {
            await expect(usecase.execute(branchId, 999)).rejects.toThrow(NotFoundException);
        });

        it("should throw NotFoundException with correct message", async () => {
            await expect(usecase.execute(branchId, 42)).rejects.toThrow(
                "Client with id 42 not found",
            );
        });

        it("should not affect other clients when deleting", async () => {
            const clients = ClientFactory.createMany(3);
            mockRepository.setData(clients);

            await usecase.execute(branchId, 2);

            const remaining = mockRepository.getAllData();
            expect(remaining).toHaveLength(2);
            expect(remaining.map((c) => c.id)).toEqual([1, 3]);
        });

        it("should allow deleting all clients one by one", async () => {
            const clients = ClientFactory.createMany(2);
            mockRepository.setData(clients);

            await usecase.execute(branchId, 1);
            await usecase.execute(branchId, 2);

            const remaining = mockRepository.getAllData();
            expect(remaining).toHaveLength(0);
        });
    });

    // ============================================
    // P1-10: service_record_case FK guard (SbClientRepository + mocked PrismaService)
    //
    // client -> service_record_case is onDelete: Restrict (schema.prisma). These
    // tests exercise the real SbClientRepository.delete() transaction (not the
    // in-memory mock above) so the completed/submitted-record guard and the
    // residual P2003 defense-in-depth are actually covered end-to-end through
    // the usecase.
    // ============================================
    describe("execute (against SbClientRepository + mocked PrismaService)", () => {
        const branchId = "org-1";
        const clientId = 5;

        let clientModel: { findFirst: jest.Mock; deleteMany: jest.Mock };
        let serviceRecordCaseModel: { findUnique: jest.Mock; delete: jest.Mock };
        let serviceRecordDayModel: { count: jest.Mock };
        let prisma: PrismaService;
        let repository: SbClientRepository;
        let usecase: DeleteClientUsecase;

        const clientRow = () => ({
            id: clientId,
            name: "Jane Doe",
            address: "Seoul",
            phone: "010-1111-2222",
            type: "A",
            duration: 15,
            fullPrice: "100000",
            grant: "50000",
            actualPrice: "50000",
            startDate: new Date("2024-01-01T00:00:00.000Z"),
            endDate: new Date("2024-06-01T00:00:00.000Z"),
            careCenter: true,
            voucherClient: false,
            birthday: "900101",
            serviceStatus: "completed",
            breastPump: true,
            eDocId: null,
            dueDate: null,
            branchId,
        });

        beforeEach(() => {
            clearSchemaCapabilityCache();

            clientModel = { findFirst: jest.fn(), deleteMany: jest.fn() };
            serviceRecordCaseModel = { findUnique: jest.fn(), delete: jest.fn() };
            serviceRecordDayModel = { count: jest.fn() };

            const tx = {
                client: clientModel,
                service_record_case: serviceRecordCaseModel,
                service_record_day: serviceRecordDayModel,
            };

            prisma = {
                client: clientModel,
                $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
                $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
            } as unknown as PrismaService;

            repository = new SbClientRepository(prisma);
            usecase = new DeleteClientUsecase(repository);

            clientModel.findFirst.mockResolvedValue(clientRow());
        });

        it("(a) throws 409 and deletes nothing when the case has a submitted day", async () => {
            serviceRecordCaseModel.findUnique.mockResolvedValue({ id: "case-1", completedAt: null });
            serviceRecordDayModel.count.mockResolvedValue(1);

            await expect(usecase.execute(branchId, clientId)).rejects.toThrow(ConflictException);
            await expect(usecase.execute(branchId, clientId)).rejects.toThrow(
                "완료된 제공기록지가 있는 고객은 삭제할 수 없습니다. 서비스 종료 처리를 이용해 주세요.",
            );

            expect(serviceRecordCaseModel.delete).not.toHaveBeenCalled();
            expect(clientModel.deleteMany).not.toHaveBeenCalled();
        });

        it("(a) throws 409 and deletes nothing when the case itself is completed", async () => {
            serviceRecordCaseModel.findUnique.mockResolvedValue({
                id: "case-1",
                completedAt: new Date("2024-05-01T00:00:00.000Z"),
            });

            await expect(usecase.execute(branchId, clientId)).rejects.toThrow(ConflictException);

            // Short-circuits on completedAt before even counting submitted days.
            expect(serviceRecordDayModel.count).not.toHaveBeenCalled();
            expect(serviceRecordCaseModel.delete).not.toHaveBeenCalled();
            expect(clientModel.deleteMany).not.toHaveBeenCalled();
        });

        it("(b) deletes the empty case and the client when there is no completed/submitted history", async () => {
            serviceRecordCaseModel.findUnique.mockResolvedValue({ id: "case-1", completedAt: null });
            serviceRecordDayModel.count.mockResolvedValue(0);
            serviceRecordCaseModel.delete.mockResolvedValue({ id: "case-1" });
            clientModel.deleteMany.mockResolvedValue({ count: 1 });

            await usecase.execute(branchId, clientId);

            expect(serviceRecordCaseModel.delete).toHaveBeenCalledWith({ where: { id: "case-1" } });
            expect(clientModel.deleteMany).toHaveBeenCalledWith({
                where: { id: clientId, branchId },
            });
        });

        it("(b) deletes the client directly when it has no service_record_case at all", async () => {
            serviceRecordCaseModel.findUnique.mockResolvedValue(null);
            clientModel.deleteMany.mockResolvedValue({ count: 1 });

            await usecase.execute(branchId, clientId);

            expect(serviceRecordCaseModel.delete).not.toHaveBeenCalled();
            expect(clientModel.deleteMany).toHaveBeenCalledWith({
                where: { id: clientId, branchId },
            });
        });

        it("(c) converts a residual P2003 foreign key violation into 409 (defense-in-depth)", async () => {
            serviceRecordCaseModel.findUnique.mockResolvedValue(null);
            clientModel.deleteMany.mockRejectedValue(
                new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed", {
                    code: "P2003",
                    clientVersion: "test",
                }),
            );

            await expect(usecase.execute(branchId, clientId)).rejects.toThrow(ConflictException);
            await expect(usecase.execute(branchId, clientId)).rejects.toThrow(
                "완료된 제공기록지가 있는 고객은 삭제할 수 없습니다. 서비스 종료 처리를 이용해 주세요.",
            );
        });

        it("rethrows unrelated errors untouched", async () => {
            serviceRecordCaseModel.findUnique.mockResolvedValue(null);
            clientModel.deleteMany.mockRejectedValue(new Error("boom"));

            await expect(usecase.execute(branchId, clientId)).rejects.toThrow("boom");
        });
    });
});
