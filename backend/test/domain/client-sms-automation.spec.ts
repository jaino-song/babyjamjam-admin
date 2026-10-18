import { ClientEntity } from "domain/entities/client.entity";
import { ClientMapper } from "infrastructure/database/mapper/client.mapper";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";

describe("client smsAutomationEnabled mapping", () => {
    const createProps = {
        name: "Automation Client",
        address: null,
        phone: "010-1234-5678",
        type: null,
        duration: null,
        fullPrice: null,
        grant: null,
        actualPrice: null,
        startDate: null,
        endDate: null,
        careCenter: false,
        voucherClient: true,
        birthday: null,
        dueDate: null,
        birthDate: null,
        serviceStatus: null,
        breastPump: false,
        eDocId: null,
    };
    const row = {
        id: 1,
        name: "Row Client",
        address: null,
        phone: "010-1234-5678",
        type: null,
        duration: null,
        fullPrice: null,
        grant: null,
        actualPrice: null,
        startDate: null,
        endDate: null,
        careCenter: false,
        voucherClient: true,
        birthday: null,
        serviceStatus: null,
        bookingConfirmedAt: null,
        breastPump: false,
        eDocId: null,
    };

    it("defaults to true on create and carries an explicit false into the create payload", () => {
        const defaulted = ClientEntity.create(createProps, KR_BUILTIN_CALENDAR);
        const optedOut = ClientEntity.create({ ...createProps, smsAutomationEnabled: false }, KR_BUILTIN_CALENDAR);

        expect(defaulted.smsAutomationEnabled).toBe(true);
        expect(ClientMapper.toPrismaCreate(defaulted).smsAutomationEnabled).toBe(true);
        expect(optedOut.smsAutomationEnabled).toBe(false);
        expect(ClientMapper.toPrismaCreate(optedOut).smsAutomationEnabled).toBe(false);
    });

    it("reads the stored flag, defaulting a row without the column to true", () => {
        expect(ClientMapper.toDomain(row).smsAutomationEnabled).toBe(true);
        expect(ClientMapper.toDomain({ ...row, smsAutomationEnabled: false }).smsAutomationEnabled).toBe(false);
    });

    it("never writes the flag from the entity-wide update payload", () => {
        const entity = ClientMapper.toDomain({ ...row, smsAutomationEnabled: false });

        expect(ClientMapper.toPrismaUpdate(entity)).not.toHaveProperty("smsAutomationEnabled");
    });
});
