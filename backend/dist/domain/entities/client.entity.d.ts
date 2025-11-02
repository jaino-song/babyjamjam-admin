interface UpdateClientProps {
    name?: string;
    primaryEmployeeId?: number;
    secondaryEmployeeId?: number | null;
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
}
interface CreateClientProps {
    name: string;
    primaryEmployeeId: number;
    secondaryEmployeeId: number | null;
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
}
export declare class ClientEntity {
    readonly id: number;
    name: string;
    primaryEmployeeId: number;
    secondaryEmployeeId: number | null;
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
    constructor(id: number, name: string, primaryEmployeeId: number, secondaryEmployeeId: number | null, address: string | null, phone: string | null, type: string | null, duration: number | null, fullPrice: string | null, grant: string | null, actualPrice: string | null, startDate: Date | null, endDate: Date | null, careCenter: boolean, voucherClient: boolean);
    isGoingToCareCenter(): boolean;
    isVoucherClient(): boolean;
    static create(props: CreateClientProps): ClientEntity;
    update(props: UpdateClientProps): void;
    static fromPrisma(prismaData: {
        id: number;
        name: string;
        primaryEmployeeId: number;
        secondaryEmployeeId: number | null;
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
    }): ClientEntity;
    toPersistence(): {
        id: number;
        name: string;
        primaryEmployeeId: number;
        secondaryEmployeeId: number | null;
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
    };
}
export {};
