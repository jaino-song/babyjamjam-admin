import { Inject, Injectable } from "@nestjs/common";
import { ClientEntity } from "domain/entities/client.entity";
import {
    ClientWithInitialSchedule,
    CLIENT_REPOSITORY,
    IClientRepository,
    InitialClientSchedule,
} from "domain/repositories/client.repository.interface";
import type { Prisma } from "@prisma/client";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import type { KrBusinessDayCalendar } from "domain/utils/business-days";

type CreateClientParams = {
    name: string;
    address: string | null;
    phone: string | null;
    type: string | null;
    duration: number | null;
    allowBusinessDayMismatch?: boolean;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    startDate: Date | null;
    endDate: Date | null;
    careCenter: boolean | null;
    voucherClient: boolean;
    birthday: string | null;
    dueDate: Date | null;
    birthDate: Date | null;
    serviceStatus: string | null;
    breastPump: boolean;
    eDocId?: string | null;
    areaId?: string | null;
};

@Injectable()
export class CreateClientUsecase {
    constructor(
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
        private readonly holidayCalendar: HolidayCalendarService,
    ) {}

    /**
     * SAVED computation: the derived duration is persisted, so the branch
     * calendar is read fresh. A caller that opens a transaction passes the
     * calendar it loaded BEFORE the transaction began (`calendar`); the read
     * here is only the fallback, and must not happen inside an open transaction
     * (it needs a second pooled connection).
     */
    async execute(
        branchid: string,
        params: CreateClientParams,
        transaction?: Prisma.TransactionClient,
        calendar?: KrBusinessDayCalendar,
    ): Promise<ClientEntity> {
        const branchCalendar = calendar ?? await this.holidayCalendar.forBranch(branchid, { fresh: true });
        const client = ClientEntity.create({
            ...params,
            eDocId: params.eDocId ?? null,
        }, branchCalendar);
        return this.clientRepository.create(branchid, client, transaction);
    }

    async executeWithInitialSchedule(
        branchid: string,
        params: CreateClientParams,
        schedule: InitialClientSchedule,
        transaction?: Prisma.TransactionClient,
        calendar?: KrBusinessDayCalendar,
    ): Promise<ClientWithInitialSchedule> {
        const branchCalendar = calendar ?? await this.holidayCalendar.forBranch(branchid, { fresh: true });
        const client = ClientEntity.create({
            ...params,
            eDocId: params.eDocId ?? null,
        }, branchCalendar);
        return this.clientRepository.createWithInitialSchedule(branchid, client, schedule, transaction);
    }
}
