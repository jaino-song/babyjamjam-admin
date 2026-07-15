import { AlimtalkService } from "application/services/alimtalk.service";
import { SystemSettingService } from "application/services/system-setting.service";
import { AligoService } from "application/services/aligo.service";
import { ClientEntity } from "domain/entities/client.entity";

describe("AlimtalkService", () => {
    const createMockSystemSettingService = () => ({
        getAlimtalkProvider: jest.fn(),
        isAlimtalkEnabled: jest.fn(),
    });

    const createMockAligoService = () => ({
        sendContractSignedAlimtalk: jest.fn(),
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

    let service: AlimtalkService;
    let systemSettingService: ReturnType<typeof createMockSystemSettingService>;
    let aligoService: ReturnType<typeof createMockAligoService>;

    beforeEach(() => {
        systemSettingService = createMockSystemSettingService();
        aligoService = createMockAligoService();

        service = new AlimtalkService(
            systemSettingService as unknown as SystemSettingService,
            aligoService as unknown as AligoService
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("sendContractSignedAlimtalk", () => {
        const contractInfo = {
            contractType: "방문요양",
            signedDate: "2025-01-14",
            serviceStartDate: "2025-01-15",
            employeeName: "김직원",
        };

        it("should route to Aligo when provider is aligo_alimtalk", async () => {
            systemSettingService.getAlimtalkProvider.mockResolvedValue("aligo_alimtalk");

            await service.sendContractSignedAlimtalk(createMockClient(), contractInfo);

            expect(aligoService.sendContractSignedAlimtalk).toHaveBeenCalled();
        });
    });

    describe("getProvider", () => {
        it("should return current provider", async () => {
            systemSettingService.getAlimtalkProvider.mockResolvedValue("aligo_alimtalk");

            const result = await service.getProvider();

            expect(result).toBe("aligo_alimtalk");
        });
    });

});
