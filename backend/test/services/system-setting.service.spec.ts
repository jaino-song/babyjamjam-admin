import { SystemSettingService } from "application/services/system-setting.service";
import { GetSettingUsecase } from "application/usecases/system-setting/get-setting.usecase";
import { UpdateSettingUsecase } from "application/usecases/system-setting/update-setting.usecase";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";

describe("SystemSettingService", () => {
    const createMockGetSettingUsecase = () => ({
        execute: jest.fn(),
        executeEntity: jest.fn(),
        executeWithDefault: jest.fn(),
    });

    const createMockUpdateSettingUsecase = () => ({
        execute: jest.fn(),
    });

    let service: SystemSettingService;
    let getSettingUsecase: ReturnType<typeof createMockGetSettingUsecase>;
    let updateSettingUsecase: ReturnType<typeof createMockUpdateSettingUsecase>;

    beforeEach(() => {
        getSettingUsecase = createMockGetSettingUsecase();
        updateSettingUsecase = createMockUpdateSettingUsecase();
        service = new SystemSettingService(
            getSettingUsecase as unknown as GetSettingUsecase,
            updateSettingUsecase as unknown as UpdateSettingUsecase
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("message automation past trigger config", () => {
        it("should return the default config when no setting is stored", async () => {
            getSettingUsecase.execute.mockResolvedValue(null);

            const result = await service.getMessageAutomationPastTriggerConfig("branch-1");

            expect(getSettingUsecase.execute).toHaveBeenCalledWith(
                "branch:branch-1:message_automation:past_trigger"
            );
            expect(result).toEqual({
                sendIntervalMinutes: 1,
                ruleOrder: [],
            });
        });

        it("should parse and normalize the stored config", async () => {
            getSettingUsecase.execute.mockResolvedValue(JSON.stringify({
                sendIntervalMinutes: 3,
                ruleOrder: ["rule-2", "rule-1", "rule-2"],
            }));

            const result = await service.getMessageAutomationPastTriggerConfig("branch-1");

            expect(result).toEqual({
                sendIntervalMinutes: 3,
                ruleOrder: ["rule-2", "rule-1"],
            });
        });

        it("should fall back to the default config when stored JSON is invalid", async () => {
            getSettingUsecase.execute.mockResolvedValue("{");

            const result = await service.getMessageAutomationPastTriggerConfig("branch-1");

            expect(result).toEqual({
                sendIntervalMinutes: 1,
                ruleOrder: [],
            });
        });

        it("should persist a normalized branch-scoped config", async () => {
            const entity = new SystemSettingEntity(
                "branch:branch-1:message_automation:past_trigger",
                JSON.stringify({
                    sendIntervalMinutes: 1440,
                    ruleOrder: ["rule-1", "rule-2"],
                }),
                new Date(),
            );
            updateSettingUsecase.execute.mockResolvedValue(entity);

            const result = await service.setMessageAutomationPastTriggerConfig("branch-1", {
                sendIntervalMinutes: 2000,
                ruleOrder: ["rule-1", "rule-2", "rule-1"],
            });

            expect(updateSettingUsecase.execute).toHaveBeenCalledWith(
                "branch:branch-1:message_automation:past_trigger",
                JSON.stringify({
                    sendIntervalMinutes: 1440,
                    ruleOrder: ["rule-1", "rule-2"],
                }),
            );
            expect(result).toBe(entity);
        });
    });
});
