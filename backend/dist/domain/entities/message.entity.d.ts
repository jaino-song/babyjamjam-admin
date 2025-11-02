export declare class MessageEntity {
    readonly id: number;
    title: string;
    text: string;
    readonly createdAt: Date;
    editedAt: Date | null;
    constructor(id: number, title: string, text: string, createdAt: Date, editedAt: Date | null);
    edit(title: string, text: string): void;
    isEdited(): boolean;
    static create(title: string, text: string): MessageEntity;
    static fromPrisma(prismaData: {
        id: number;
        title: string | null;
        text: string | null;
        created_at: Date;
        edited_at: Date | null;
    }): MessageEntity;
    toPersistence(): {
        id: number;
        title: string | null;
        text: string | null;
        created_at: Date;
        edited_at: Date | null;
    };
}
