export declare class CreateClientDto {
    name: string;
    primaryEmployeeId: number;
    secondaryEmployeeId?: number | null;
    address?: string | null;
    phone?: string | null;
    type?: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    careCenter: boolean;
    voucherClient: boolean;
}
export declare class UpdateClientDto {
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
    startDate?: string | null;
    endDate?: string | null;
    careCenter?: boolean;
    voucherClient?: boolean;
}
