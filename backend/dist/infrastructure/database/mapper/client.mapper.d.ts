import { ClientEntity } from "domain/entities/client.entity";
type ClientRow = {
    id: number;
    name: string;
    primary_employee_id: number;
    secondary_employee_id: number | null;
    address: string | null;
    phone: string | null;
    type: string | null;
    duration: number | null;
    full_price: string | null;
    grant: string | null;
    actual_price: string | null;
    start_date: Date | null;
    end_date: Date | null;
    care_center: boolean;
    voucher_client: boolean;
};
export declare class ClientMapper {
    static toDomain(row: ClientRow): ClientEntity;
    static toPrismaCreate(entity: ClientEntity): {
        name: string;
        primary_employee_id: number;
        secondary_employee_id: number;
        address: string;
        phone: string;
        type: string;
        duration: number;
        full_price: string;
        grant: string;
        actual_price: string;
        start_date: Date;
        end_date: Date;
        care_center: boolean;
        voucher_client: boolean;
    };
    static toPrismaUpdate(entity: ClientEntity): {
        name: string;
        primary_employee_id: number;
        secondary_employee_id: number;
        address: string;
        phone: string;
        type: string;
        duration: number;
        full_price: string;
        grant: string;
        actual_price: string;
        start_date: Date;
        end_date: Date;
        care_center: boolean;
        voucher_client: boolean;
    };
}
export {};
