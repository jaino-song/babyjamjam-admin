export class MessageEntity {
    constructor(
        public readonly id: number,
        public title: string,
        public text: string,
        public readonly createdAt: Date,
        public editedAt: Date | null,
    ) {}

    edit(title: string, text: string): void {
        this.title = title;
        this.text = text;
        this.editedAt = new Date();
    }

    isEdited(): boolean {
        return this.editedAt !== null && this.editedAt > this.createdAt;
    }

    static create(title: string, text: string): MessageEntity {
        return new MessageEntity(
            0,
            title,
            text,
            new Date(),
            null,
        );
    }

    /**
     * Reconstitute an entity from persistence data (used by Mapper).
     * This method is infrastructure-agnostic - it only knows domain types.
     */
    static reconstitute(
        id: number,
        title: string,
        text: string,
        createdAt: Date,
        editedAt: Date | null,
    ): MessageEntity {
        return new MessageEntity(
            id,
            title,
            text,
            createdAt,
            editedAt,
        );
    }
}