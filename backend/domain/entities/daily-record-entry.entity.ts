interface DailyRecordEntryProps {
    id?: string;
    eformsignDocId: number;
    recordDate: Date;
    content: string | null;
    submittedBy: string | null;
    submittedAt: Date;
    organizationId: string | null;
    createdAt: Date;
}

export class DailyRecordEntryEntity {
    private readonly props: DailyRecordEntryProps;

    constructor(props: DailyRecordEntryProps) {
        this.props = { ...props };
        this.assertInvariants();
    }

    private assertInvariants(): void {
        if (typeof this.props.eformsignDocId !== "number" || this.props.eformsignDocId <= 0) {
            throw new Error("DailyRecordEntryEntity: eformsignDocId must be a positive number");
        }
        if (!(this.props.recordDate instanceof Date) || Number.isNaN(this.props.recordDate.getTime())) {
            throw new Error("DailyRecordEntryEntity: recordDate must be a valid Date");
        }
        if (!(this.props.submittedAt instanceof Date) || Number.isNaN(this.props.submittedAt.getTime())) {
            throw new Error("DailyRecordEntryEntity: submittedAt must be a valid Date");
        }
        if (!(this.props.createdAt instanceof Date) || Number.isNaN(this.props.createdAt.getTime())) {
            throw new Error("DailyRecordEntryEntity: createdAt must be a valid Date");
        }
    }

    get id(): string | undefined { return this.props.id; }
    get eformsignDocId(): number { return this.props.eformsignDocId; }
    get recordDate(): Date { return this.props.recordDate; }
    get content(): string | null { return this.props.content; }
    get submittedBy(): string | null { return this.props.submittedBy; }
    get submittedAt(): Date { return this.props.submittedAt; }
    get organizationId(): string | null { return this.props.organizationId; }
    get createdAt(): Date { return this.props.createdAt; }

    /**
     * Use this when creating a new entry from an incoming request.
     * id is DB-generated; submittedAt/createdAt default to now.
     */
    static create(
        props: Omit<DailyRecordEntryProps, "id" | "submittedAt" | "createdAt">
            & Partial<Pick<DailyRecordEntryProps, "submittedAt" | "createdAt">>,
    ): DailyRecordEntryEntity {
        const now = new Date();
        return new DailyRecordEntryEntity({
            ...props,
            submittedAt: props.submittedAt ?? now,
            createdAt: props.createdAt ?? now,
        });
    }

    /**
     * Reconstitute an entity from persistence data (used by Mapper).
     */
    static reconstitute(props: DailyRecordEntryProps): DailyRecordEntryEntity {
        return new DailyRecordEntryEntity(props);
    }
}
