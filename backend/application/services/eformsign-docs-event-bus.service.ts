import { Injectable, Logger } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

export interface EformsignDocsChangedEvent {
    branchId: string;
    documentId?: string;
    reason: string;
}

@Injectable()
export class EformsignDocsEventBus {
    private readonly logger = new Logger(EformsignDocsEventBus.name);
    private readonly subject = new Subject<EformsignDocsChangedEvent>();

    readonly events$: Observable<EformsignDocsChangedEvent> = this.subject.asObservable();

    emit(event: EformsignDocsChangedEvent): void {
        this.logger.debug(`emit ${event.reason} branch=${event.branchId} doc=${event.documentId ?? "-"}`);
        this.subject.next(event);
    }
}
