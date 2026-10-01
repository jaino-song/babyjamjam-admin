import { ClientEntity } from "domain/entities/client.entity";
import { createKrBusinessDayCalendar, KOREAN_HOLIDAY_CALENDAR, KR_BUILTIN_CALENDAR } from "domain/utils/business-days";

function createClient(phone: string | null = "010-1234-5678"): ClientEntity {
    return ClientEntity.create({
        name: "테스트 고객",
        address: "인천",
        phone,
        type: "A",
        duration: 10,
        fullPrice: "100000",
        grant: null,
        actualPrice: "100000",
        startDate: null,
        endDate: null,
        careCenter: false,
        voucherClient: false,
        birthday: null,
        dueDate: null,
        birthDate: null,
        serviceStatus: "waiting",
        breastPump: false,
        eDocId: null,
    }, KR_BUILTIN_CALENDAR);
}

describe("ClientEntity legacy persisted prices", () => {
    function restore(prices: [string | null, string | null, string | null]) {
        return ClientEntity.reconstitute(
            1, "레거시 고객", null, null, null, null,
            ...prices,
            null, null, false, false, null, null, null, false, null,
        );
    }

    it.each(["", "  ", "\t\n", null])("reads blank persisted prices as absent: %p", (blank) => {
        const client = restore([blank, blank, blank]);
        expect([client.fullPrice, client.grant, client.actualPrice]).toEqual([null, null, null]);
    });

    it("preserves zero and normalizes formatted amounts alongside a blank field", () => {
        const client = restore(["0", " 1,000원 ", ""]);
        expect([client.fullPrice, client.grant, client.actualPrice]).toEqual(["0", "1000", null]);
    });

    it.each([0, 1, 2])("still rejects nonblank malformed persisted price at position %i", (index) => {
        const prices: [string, string, string] = ["1000", "0", "1000"];
        prices[index] = "1.5";
        expect(() => restore(prices)).toThrow("Invalid Korean won amount");
    });

    it.each(["fullPrice", "grant", "actualPrice"] as const)("keeps blank %s invalid for new writes", (field) => {
        expect(() => ClientEntity.create({ ...createClient(), [field]: "" }, KR_BUILTIN_CALENDAR)).toThrow("Invalid Korean won amount");
        expect(() => createClient().update({ [field]: " " }, KR_BUILTIN_CALENDAR)).toThrow("Invalid Korean won amount");
    });
});

describe("ClientEntity canonical phone identity", () => {
    it("keeps the display phone while deriving a canonical key", () => {
        const client = createClient();

        expect(client.phone).toBe("010-1234-5678");
        expect(client.phoneNormalized).toBe("01012345678");
    });

    it("updates the canonical key when a phone is changed or cleared", () => {
        const client = createClient();

        client.update({ phone: " +82 10 1234 5678 " }, KR_BUILTIN_CALENDAR);
        expect(client.phone).toBe(" +82 10 1234 5678 ");
        expect(client.phoneNormalized).toBe("01012345678");

        client.update({ phone: null }, KR_BUILTIN_CALENDAR);
        expect(client.phone).toBeNull();
        expect(client.phoneNormalized).toBeNull();
    });

    it("preserves an explicitly persisted null key for an invalid legacy value", () => {
        const client = ClientEntity.reconstitute(
            1,
            "레거시 고객",
            null,
            "전화번호 없음",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            false,
            false,
            null,
            null,
            null,
            false,
            null,
            null,
            null,
            "branch-a",
            false,
            null,
            null,
        );

        expect(client.phoneNormalized).toBeNull();
    });

    it("rejects malformed phone values on create and update without partial mutation", () => {
        expect(() => createClient("not-a-phone")).toThrow("올바른 국내 전화번호 형식이 아닙니다.");

        const client = createClient();
        expect(() => client.update({ phone: "not-a-phone", name: "unchanged" }, KR_BUILTIN_CALENDAR)).toThrow("올바른 국내 전화번호 형식이 아닙니다.");
        expect(client.phone).toBe("010-1234-5678");
        expect(client.phoneNormalized).toBe("01012345678");
    });
});

describe("ClientEntity confirmed non-business-day service", () => {
    const period = { startDate: new Date("2026-08-26"), endDate: new Date("2026-09-14"), duration: 15 };
    it("preserves the confirmed period on create and update without persisting consent", () => {
        const props = { ...createClient(), ...period };
        expect(() => ClientEntity.create(props, KR_BUILTIN_CALENDAR)).toThrow();
        const client = ClientEntity.create({ ...props, allowBusinessDayMismatch: true }, KR_BUILTIN_CALENDAR);
        expect(client.duration).toBe(15);
        expect(client.endDate).toEqual(period.endDate);
        expect(client).not.toHaveProperty("allowBusinessDayMismatch");
        expect(() => client.update({ ...period }, KR_BUILTIN_CALENDAR)).toThrow();
        client.update({ ...period, allowBusinessDayMismatch: true }, KR_BUILTIN_CALENDAR);
        client.update({ name: "이름 수정" }, KR_BUILTIN_CALENDAR);
        expect(client.duration).toBe(15);
    });
    it("does not bypass reversed dates or invalid session counts", () => {
        const client = createClient();
        expect(() => client.update({ ...period, duration: 0, allowBusinessDayMismatch: true }, KR_BUILTIN_CALENDAR)).toThrow();
        expect(() => client.update({ ...period, startDate: period.endDate, endDate: period.startDate, allowBusinessDayMismatch: true }, KR_BUILTIN_CALENDAR)).toThrow();
        expect(client.startDate).toBeNull();
    });
});

describe("ClientEntity branch calendar", () => {
    // 2026-05-04..08 has 4 business days (5/5 is a holiday); the branch adds 5/7 off.
    const branchCalendar = createKrBusinessDayCalendar(
        [...(KOREAN_HOLIDAY_CALENDAR[2026] ?? []), "2026-05-07"],
        { supportedYears: [2026], version: "branch-test" },
    );
    const props = () => ({
        ...createClient(),
        duration: 3,
        startDate: new Date("2026-05-04T00:00:00Z"),
        endDate: new Date("2026-05-08T00:00:00Z"),
    });

    it("validates the create duration against the supplied calendar", () => {
        expect(ClientEntity.create({ ...props(), duration: 4 }, KR_BUILTIN_CALENDAR).duration).toBe(4);
        expect(ClientEntity.create(props(), branchCalendar).duration).toBe(3);
        expect(() => ClientEntity.create({ ...props(), duration: 4 }, branchCalendar)).toThrow("1일 이상 3일 이하");
    });

    it("fills a missing duration on update from the supplied calendar, and rejects one it cannot fit", () => {
        const client = ClientEntity.create({ ...props(), duration: null, endDate: null, startDate: null }, branchCalendar);
        client.update({ startDate: new Date("2026-05-04T00:00:00Z"), endDate: new Date("2026-05-08T00:00:00Z") }, branchCalendar);
        expect(client.duration).toBe(3);

        const other = ClientEntity.create({ ...props(), duration: 2, endDate: new Date("2026-05-06T00:00:00Z") }, branchCalendar);
        expect(() => other.update({ endDate: new Date("2026-05-08T00:00:00Z"), duration: 4 }, branchCalendar)).toThrow("1일 이상 3일 이하");
        other.update({ endDate: new Date("2026-05-08T00:00:00Z"), duration: 4 }, KR_BUILTIN_CALENDAR);
        expect(other.duration).toBe(4);
    });
});
