import { AligoService } from "application/services/aligo.service";
import {
    SendAligoAlimtalkUsecase,
    SendAligoSmsUsecase,
} from "application/usecases/aligo";
import { ClientEntity } from "domain/entities/client.entity";

describe("AligoService", () => {
    const createMockSendAlimtalkUsecase = () => ({
        execute: jest.fn(),
    });
    const createMockSendSmsUsecase = () => ({
        execute: jest.fn(),
    });

    const createMockClient = (): ClientEntity =>
        new ClientEntity(
            1,
            "홍길동",
            "서울시 강남구",
            "010-1234-5678",
            "A가-1형",
            15,
            "100000",
            "50000",
            "50000",
            new Date("2025-01-15"),
            new Date("2025-03-15"),
            false,
            true,
            "900101",
            "active",
            false,
            null
        );

    let service: AligoService;
    let sendAlimtalkUsecase: ReturnType<typeof createMockSendAlimtalkUsecase>;
    let sendSmsUsecase: ReturnType<typeof createMockSendSmsUsecase>;

    beforeEach(() => {
        sendAlimtalkUsecase = createMockSendAlimtalkUsecase();
        sendSmsUsecase = createMockSendSmsUsecase();
        service = new AligoService(
            sendAlimtalkUsecase as unknown as SendAligoAlimtalkUsecase,
            sendSmsUsecase as unknown as SendAligoSmsUsecase,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("sendContractSignedAlimtalk", () => {
        it("should send CONTRACT_SIGNED template scoped to the client's branch", async () => {
            sendAlimtalkUsecase.execute.mockResolvedValue({ code: 0, message: "success" });

            const client = createMockClient();
            client.branchId = "branch-1";

            await service.sendContractSignedAlimtalk(client, {
                contractType: "방문요양",
                signedDate: "2025-01-14",
                serviceStartDate: "2025-01-15",
                employeeName: "김직원",
            });

            expect(sendAlimtalkUsecase.execute).toHaveBeenCalledWith(
                expect.objectContaining({
                    templateKey: "CONTRACT_SIGNED",
                    // Regression: omitting branchId/clientId orphans the
                    // message_log row — invisible to the tenant-scoped
                    // GET /alimtalk-logs history.
                    branchId: "branch-1",
                    clientId: 1,
                    variables: expect.objectContaining({
                        계약유형: "방문요양",
                        담당자명: "김직원",
                    }),
                })
            );
        });
    });

    describe("error handling", () => {
        it("should rethrow when sms API fails", async () => {
            sendSmsUsecase.execute.mockRejectedValue(new Error("API Error"));

            await expect(
                service.sendSms({
                    receiver: "01012345678",
                    message: "테스트",
                })
            ).rejects.toThrow("API Error");
        });
    });
});
