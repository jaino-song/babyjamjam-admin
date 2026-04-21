const MAX_ATTEMPTS = 3;

export type AlimtalkLogStatus = "pending" | "sent" | "failed";

export class AlimtalkLogEntity {
    constructor(
        public readonly id: number,
        public branchId: string | null,
        public provider: string,
        public templateKey: string,
        public triggerJobId: string | null,
        public receiver: string,
        public clientId: number | null,
        public messageBody: string,
        public variables: Record<string, string>,
        public status: AlimtalkLogStatus,
        public aligoMid: string | null,
        public errorMessage: string | null,
        public attempts: number,
        public lastAttemptAt: Date | null,
        public nextRetryAt: Date | null,
        public createdAt: Date,
        public updatedAt: Date,
    ) {}

    markSent(aligoMid?: string): void {
        this.status = "sent";
        this.aligoMid = aligoMid ?? null;
        this.lastAttemptAt = new Date();
        this.nextRetryAt = null;
        this.attempts += 1;
    }

    markFailed(errorMessage: string): void {
        this.attempts += 1;
        this.lastAttemptAt = new Date();
        this.errorMessage = errorMessage;

        if (this.canRetry()) {
            this.scheduleRetry();
        } else {
            this.status = "failed";
            this.nextRetryAt = null;
        }
    }

    canRetry(): boolean {
        return this.attempts < MAX_ATTEMPTS;
    }

    private scheduleRetry(): void {
        const backoffSeconds = Math.pow(2, this.attempts) * 2; // 2s, 4s, 8s
        this.nextRetryAt = new Date(Date.now() + backoffSeconds * 1000);
    }

    static create(params: {
        branchId?: string;
        provider: string;
        templateKey: string;
        triggerJobId?: string;
        receiver: string;
        clientId?: number;
        messageBody: string;
        variables: Record<string, string>;
    }): AlimtalkLogEntity {
        const now = new Date();
        return new AlimtalkLogEntity(
            0,
            params.branchId ?? null,
            params.provider,
            params.templateKey,
            params.triggerJobId ?? null,
            params.receiver,
            params.clientId ?? null,
            params.messageBody,
            params.variables,
            "pending",
            null,
            null,
            0,
            null,
            null,
            now,
            now,
        );
    }

    static reconstitute(
        id: number,
        branchId: string | null,
        provider: string,
        templateKey: string,
        triggerJobId: string | null,
        receiver: string,
        clientId: number | null,
        messageBody: string,
        variables: Record<string, string>,
        status: AlimtalkLogStatus,
        aligoMid: string | null,
        errorMessage: string | null,
        attempts: number,
        lastAttemptAt: Date | null,
        nextRetryAt: Date | null,
        createdAt: Date,
        updatedAt: Date = createdAt,
    ): AlimtalkLogEntity {
        return new AlimtalkLogEntity(
            id, branchId, provider, templateKey, triggerJobId, receiver, clientId,
            messageBody, variables, status, aligoMid, errorMessage, attempts,
            lastAttemptAt, nextRetryAt, createdAt, updatedAt,
        );
    }
}
