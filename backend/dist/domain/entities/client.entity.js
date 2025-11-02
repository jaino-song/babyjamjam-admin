"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientEntity = void 0;
class ClientEntity {
    constructor(id, name, primaryEmployeeId, secondaryEmployeeId, address, phone, type, duration, fullPrice, grant, actualPrice, startDate, endDate, careCenter, voucherClient) {
        this.id = id;
        this.name = name;
        this.primaryEmployeeId = primaryEmployeeId;
        this.secondaryEmployeeId = secondaryEmployeeId;
        this.address = address;
        this.phone = phone;
        this.type = type;
        this.duration = duration;
        this.fullPrice = fullPrice;
        this.grant = grant;
        this.actualPrice = actualPrice;
        this.startDate = startDate;
        this.endDate = endDate;
        this.careCenter = careCenter;
        this.voucherClient = voucherClient;
    }
    isGoingToCareCenter() {
        return this.careCenter;
    }
    isVoucherClient() {
        return this.voucherClient;
    }
    static create(props) {
        return new ClientEntity(0, props.name, props.primaryEmployeeId, props.secondaryEmployeeId, props.address, props.phone, props.type, props.duration, props.fullPrice, props.grant, props.actualPrice, props.startDate, props.endDate, props.careCenter, props.voucherClient);
    }
    update(props) {
        this.name = props.name ?? this.name;
        this.primaryEmployeeId = props.primaryEmployeeId ?? this.primaryEmployeeId;
        this.secondaryEmployeeId = props.secondaryEmployeeId ?? this.secondaryEmployeeId;
        this.address = props.address ?? this.address;
        this.phone = props.phone ?? this.phone;
        this.type = props.type ?? this.type;
        this.duration = props.duration ?? this.duration;
        this.fullPrice = props.fullPrice ?? this.fullPrice;
        this.grant = props.grant ?? this.grant;
        this.actualPrice = props.actualPrice ?? this.actualPrice;
        this.startDate = props.startDate ?? this.startDate;
        this.endDate = props.endDate ?? this.endDate;
        this.careCenter = props.careCenter ?? this.careCenter;
        this.voucherClient = props.voucherClient ?? this.voucherClient;
    }
    static fromPrisma(prismaData) {
        return new ClientEntity(prismaData.id, prismaData.name, prismaData.primaryEmployeeId, prismaData.secondaryEmployeeId, prismaData.address, prismaData.phone, prismaData.type, prismaData.duration, prismaData.fullPrice, prismaData.grant, prismaData.actualPrice, prismaData.startDate, prismaData.endDate, prismaData.careCenter, prismaData.voucherClient);
    }
    toPersistence() {
        return {
            id: this.id,
            name: this.name,
            primaryEmployeeId: this.primaryEmployeeId,
            secondaryEmployeeId: this.secondaryEmployeeId,
            address: this.address,
            phone: this.phone,
            type: this.type,
            duration: this.duration,
            fullPrice: this.fullPrice,
            grant: this.grant,
            actualPrice: this.actualPrice,
            startDate: this.startDate,
            endDate: this.endDate,
            careCenter: this.careCenter,
            voucherClient: this.voucherClient,
        };
    }
}
exports.ClientEntity = ClientEntity;
//# sourceMappingURL=client.entity.js.map