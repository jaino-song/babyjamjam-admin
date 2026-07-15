import { Injectable } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

export type EformsignHeadlessProgressStep =
    | "client-started"
    | "info-inserted"
    | "creating"
    | "sent"
    | "failed";

export interface EformsignHeadlessProgressEvent {
    progressId: string;
    step: EformsignHeadlessProgressStep;
    at: number;
    reason?: string;
    failedStep?: EformsignHeadlessProgressStep;
}

@Injectable()
export class EformsignHeadlessProgressService {
    private readonly subject = new Subject<EformsignHeadlessProgressEvent>();

    readonly events$: Observable<EformsignHeadlessProgressEvent> = this.subject.asObservable();

    emit(
        progressId: string | undefined,
        step: EformsignHeadlessProgressStep,
        reason?: string,
        failedStep?: EformsignHeadlessProgressStep,
    ): void {
        if (!progressId) return;
        this.subject.next({
            progressId,
            step,
            at: Date.now(),
            reason,
            failedStep,
        });
    }
}
