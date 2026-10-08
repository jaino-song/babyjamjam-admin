import { Injectable, Logger } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

/** Emitted after an admin service-record edit is confirmed and committed. */
export interface ServiceRecordCaseChangedEvent {
    branchId: string;
    clientId: number;
    caseId: string;
    caseVersion: number;
}

/**
 * In-process bus that lets open admin editors learn that a record changed.
 * Same shape as EformsignDocsEventBus; it does not fan out across instances.
 */
@Injectable()
export class ServiceRecordCaseEventBus {
    private readonly logger = new Logger(ServiceRecordCaseEventBus.name);
    private readonly subject = new Subject<ServiceRecordCaseChangedEvent>();

    readonly events$: Observable<ServiceRecordCaseChangedEvent> = this.subject.asObservable();

    emit(event: ServiceRecordCaseChangedEvent): void {
        this.logger.debug(`emit branch=${event.branchId} case=${event.caseId} version=${event.caseVersion}`);
        this.subject.next(event);
    }
}
