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
    eDocId?: string | null;
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
    eDocId: string | null;
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
        public eDocId: string | null,
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
            props.eDocId,
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
        this.eDocId = props.eDocId ?? this.eDocId;
    }

    /**
     * Reconstitute an entity from persistence data (used by Mapper).
     * This method is infrastructure-agnostic - it only knows domain types.
     */
    static reconstitute(
        id: number,
        name: string,
        address: string | null,
        phone: string | null,
        type: string | null,
        duration: number | null,
        fullPrice: string | null,
        grant: string | null,
        actualPrice: string | null,
        startDate: Date | null,
        endDate: Date | null,
        careCenter: boolean,
        voucherClient: boolean,
        birthday: string | null,
        contractStatus: string | null,
        breastPump: boolean,
        eDocId: string | null,
    ): ClientEntity {
        return new ClientEntity(
            id,
            name,
            address,
            phone,
            type,
            duration,
            fullPrice,
            grant,
            actualPrice,
            startDate,
            endDate,
            careCenter,
            voucherClient,
            birthday,
            contractStatus,
            breastPump,
            eDocId,
        );
    }
}
