interface UpdateClientProps {
    name?: string;
    address?: string | null;
    phone?: string | null;
    type?: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
    careCenter?: boolean;
    voucherClient?: boolean;
    birthday?: string | null;
    contractStatus?: string | null;
    breastPump?: boolean;
}

interface CreateClientProps {
    name: string;
    address: string | null;
    phone: string | null;
    type: string | null;
    duration: number | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    startDate: Date | null;
    endDate: Date | null;
    careCenter: boolean;
    voucherClient: boolean;
    birthday: string | null;
    contractStatus: string | null;
    breastPump: boolean;
}

export class ClientEntity {
    constructor(
        public readonly id: number,
        public name: string,
        public address: string | null,
        public phone: string | null,
        public type: string | null,
        public duration: number | null,
        public fullPrice: string | null,
        public grant: string | null,
        public actualPrice: string | null,
        public startDate: Date | null,
        public endDate: Date | null,
        public careCenter: boolean,
        public voucherClient: boolean,
        public birthday: string | null,
        public contractStatus: string | null,
        public breastPump: boolean,
    ) {}

    isGoingToCareCenter(): boolean {
        return this.careCenter;
    }

    isVoucherClient(): boolean {
        return this.voucherClient;
    }

    static create(
        props: CreateClientProps,
    ): ClientEntity {
        return new ClientEntity(
            0,
            props.name,
            props.address,
            props.phone,
            props.type,
            props.duration,
            props.fullPrice,
            props.grant,
            props.actualPrice,
            props.startDate,
            props.endDate,
            props.careCenter,
            props.voucherClient,
            props.birthday,
            props.contractStatus,
            props.breastPump,
        );
    }

    update(props: UpdateClientProps): void {
        this.name = props.name ?? this.name;
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
        this.birthday = props.birthday ?? this.birthday;
        this.contractStatus = props.contractStatus ?? this.contractStatus;
        this.breastPump = props.breastPump ?? this.breastPump;
    }

    static fromPrisma(prismaData: { id: number, name: string, address: string | null, phone: string | null, type: string | null, duration: number | null, fullPrice: string | null, grant: string | null, actualPrice: string | null, startDate: Date | null, endDate: Date | null, careCenter: boolean, voucherClient: boolean, birthday: string | null, contractStatus: string | null, breastPump: boolean }): ClientEntity {
        return new ClientEntity(
            prismaData.id,
            prismaData.name,
            prismaData.address,
            prismaData.phone,
            prismaData.type,
            prismaData.duration,
            prismaData.fullPrice,
            prismaData.grant,
            prismaData.actualPrice,
            prismaData.startDate,
            prismaData.endDate,
            prismaData.careCenter,
            prismaData.voucherClient,
            prismaData.birthday,
            prismaData.contractStatus,
            prismaData.breastPump,
        );
    }

    // Prepare this entity into this shape to be saved to the database
    toPersistence(): { id: number, name: string, address: string | null, phone: string | null, type: string | null, duration: number | null, fullPrice: string | null, grant: string | null, actualPrice: string | null, startDate: Date | null, endDate: Date | null, careCenter: boolean, voucherClient: boolean, birthday: string | null, contractStatus: string | null, breastPump: boolean } {
        return {
            id: this.id,
            name: this.name,
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
            birthday: this.birthday,
            contractStatus: this.contractStatus,
            breastPump: this.breastPump,
        };
    }
}
