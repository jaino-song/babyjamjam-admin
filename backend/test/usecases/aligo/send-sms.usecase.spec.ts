import { SendAligoSmsUsecase } from "application/usecases/aligo/send-sms.usecase";
import { IAligoSmsApiPort } from "domain/ports/aligo-sms-api.port";

describe("SendAligoSmsUsecase", () => {
    const createMockSmsApi = (): jest.Mocked<IAligoSmsApiPort> => ({
        sendSms: jest.fn(),
    });

    let usecase: SendAligoSmsUsecase;
    let smsApi: jest.Mocked<IAligoSmsApiPort>;

    beforeEach(() => {
        smsApi = createMockSmsApi();
        usecase = new SendAligoSmsUsecase(smsApi);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should normalize receiver, resolve LMS, and map schedule/test options", async () => {
        smsApi.sendSms.mockResolvedValue({
            result_code: 1,
            message: "",
            msg_id: 123456,
            success_cnt: 1,
            error_cnt: 0,
            msg_type: "LMS",
        });

        const result = await usecase.execute({
            receiver: "010-1234-5678",
            recipientName: "홍길동",
            title: "안내",
            message: "%고객명%님 안녕하세요. 장문 테스트 메시지입니다.",
            msgType: "AUTO",
            scheduledDate: "20260309",
            scheduledTime: "2019",
            testMode: true,
        });

        expect(smsApi.sendSms).toHaveBeenCalledWith({
            receiver: "01012345678",
            message: "%고객명%님 안녕하세요. 장문 테스트 메시지입니다.",
            title: "안내",
            msgType: "LMS",
            destination: "01012345678|홍길동",
            scheduledDate: "20260309",
            scheduledTime: "2019",
            testModeYn: "Y",
        });
        expect(result.request.receiver).toBe("01012345678");
        expect(result.request.msgType).toBe("LMS");
        expect(result.response.msg_id).toBe(123456);
    });

    it("should throw when the receiver phone number is invalid", async () => {
        await expect(
            usecase.execute({
                receiver: "invalid-number",
                message: "테스트",
            }),
        ).rejects.toThrow("Invalid receiver phone number: invalid-number");
    });
});
