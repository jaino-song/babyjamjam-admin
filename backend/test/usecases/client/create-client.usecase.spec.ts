import { CreateClientUsecase } from "application/usecases/client/create-client.usecase";
import { MockClientRepository } from "../../utils/mocks";
import { createHolidayCalendarStub } from "../../utils/holiday-calendar.stub";
import { createKrBusinessDayCalendar, KOREAN_HOLIDAY_CALENDAR } from "domain/utils/business-days";

/** A 2026 branch calendar: the built-in public holidays plus the given branch-added days off. */
const branchCalendar2026 = (extra: string[]) => createKrBusinessDayCalendar(
    [...(KOREAN_HOLIDAY_CALENDAR[2026] ?? []), ...extra],
    { supportedYears: [2026], version: "branch-test" },
);

describe("CreateClientUsecase", () => {
    let usecase: CreateClientUsecase;
    let mockRepository: MockClientRepository;
    const branchId = "org-1";

    beforeEach(() => {
        mockRepository = new MockClientRepository();
        usecase = new CreateClientUsecase(mockRepository, createHolidayCalendarStub());
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should create a new client with all fields", async () => {
            // Arrange
            const params = {
                name: "테스트 고객",
                address: "서울시 강남구",
                phone: "010-1234-5678",
                type: "A형",
                duration: 246,
                fullPrice: "1000000",
                grant: "500000",
                actualPrice: "500000",
                startDate: new Date("2024-01-01"),
                endDate: new Date("2024-12-31"),
                // 2024 has 245 Korean business days; retaining the nominal
                // 246-day duration requires the explicit mismatch confirmation.
                allowBusinessDayMismatch: true,
                careCenter: false,
                voucherClient: true,
                birthday: "1990-01-01",
                dueDate: new Date("2024-03-01"),
                birthDate: null,
                serviceStatus: "active",
                breastPump: false,
                eDocId: null,
            };

            // Act
            const result = await usecase.execute(branchId, params);

            // Assert
            expect(result).toBeDefined();
            expect(result.id).toBe(1);
            expect(result.name).toBe("테스트 고객");
            expect(result.address).toBe("서울시 강남구");
            expect(result.phone).toBe("010-1234-5678");
            expect(result.voucherClient).toBe(true);
        });

        it("should accept a supplied duration smaller than the business-day count and persist it unchanged", async () => {
            const params = {
                name: "회차 수 고정 고객",
                address: null,
                phone: null,
                type: null,
                duration: 1,
                fullPrice: "1000",
                grant: "0",
                actualPrice: "1000",
                startDate: new Date("2024-01-02T00:00:00.000Z"),
                endDate: new Date("2024-01-05T00:00:00.000Z"),
                careCenter: false,
                voucherClient: false,
                birthday: null,
                dueDate: null,
                birthDate: null,
                serviceStatus: null,
                breastPump: false,
            };

            const result = await usecase.execute(branchId, params);

            expect(result.duration).toBe(1);
        });

        it("should reject a complete-range duration that exceeds the business-day count before repository persistence", async () => {
            const params = {
                name: "기간 초과 고객",
                address: null,
                phone: null,
                type: null,
                duration: 5,
                fullPrice: "1000",
                grant: "0",
                actualPrice: "1000",
                startDate: new Date("2024-01-02T00:00:00.000Z"),
                endDate: new Date("2024-01-05T00:00:00.000Z"),
                careCenter: false,
                voucherClient: false,
                birthday: null,
                dueDate: null,
                birthDate: null,
                serviceStatus: null,
                breastPump: false,
            };

            await expect(usecase.execute(branchId, params)).rejects.toThrow(
                "서비스 기간은 1일 이상 4일 이하여야 합니다.",
            );
            expect(mockRepository.getAllData()).toHaveLength(0);
        });

        it("should validate the persisted duration against the branch calendar, loaded fresh", async () => {
            // 2026-05-04..08 has 4 business days (5/5 is a holiday); the branch adds 5/7 off.
            const holidayCalendar = createHolidayCalendarStub();
            (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(branchCalendar2026(["2026-05-07"]));
            const branchUsecase = new CreateClientUsecase(mockRepository, holidayCalendar);
            const params = {
                name: "지점 휴일 고객",
                address: null,
                phone: null,
                type: null,
                duration: 3,
                fullPrice: "1000",
                grant: "0",
                actualPrice: "1000",
                startDate: new Date("2026-05-04T00:00:00.000Z"),
                endDate: new Date("2026-05-08T00:00:00.000Z"),
                careCenter: false,
                voucherClient: false,
                birthday: null,
                dueDate: null,
                birthDate: null,
                serviceStatus: null,
                breastPump: false,
            };

            const created = await branchUsecase.execute(branchId, params);
            expect(created.duration).toBe(3);
            expect(holidayCalendar.forBranch).toHaveBeenCalledWith(branchId, { fresh: true });

            // Four sessions fit the built-in calendar but not the branch's.
            const builtin = await usecase.execute(branchId, { ...params, duration: 4 });
            expect(builtin.duration).toBe(4);
            await expect(branchUsecase.execute(branchId, { ...params, duration: 4 }))
                .rejects.toThrow("서비스 기간은 1일 이상 3일 이하여야 합니다.");
        });

        it("should create client with minimal required fields", async () => {
            // Arrange
            const params = {
                name: "최소 정보 고객",
                address: null,
                phone: null,
                type: null,
                duration: null,
                fullPrice: null,
                grant: null,
                actualPrice: null,
                startDate: null,
                endDate: null,
                careCenter: false,
                voucherClient: false,
                birthday: null,
                dueDate: null,
                birthDate: null,
                serviceStatus: null,
                breastPump: false,
            };

            // Act
            const result = await usecase.execute(branchId, params);

            // Assert
            expect(result).toBeDefined();
            expect(result.name).toBe("최소 정보 고객");
            expect(result.address).toBeNull();
        });

        it("should auto-increment client id for multiple creates", async () => {
            // Arrange
            const params1 = {
                name: "고객1",
                address: null,
                phone: null,
                type: null,
                duration: null,
                fullPrice: null,
                grant: null,
                actualPrice: null,
                startDate: null,
                endDate: null,
                careCenter: false,
                voucherClient: false,
                birthday: null,
                dueDate: null,
                birthDate: null,
                serviceStatus: null,
                breastPump: false,
            };
            const params2 = { ...params1, name: "고객2" };

            // Act
            const client1 = await usecase.execute(branchId, params1);
            const client2 = await usecase.execute(branchId, params2);

            // Assert
            expect(client1.id).toBe(1);
            expect(client2.id).toBe(2);
        });
    });
});
