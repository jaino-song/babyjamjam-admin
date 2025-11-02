"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageEntity = void 0;
class MessageEntity {
    constructor(id, title, text, createdAt, editedAt) {
        this.id = id;
        this.title = title;
        this.text = text;
        this.createdAt = createdAt;
        this.editedAt = editedAt;
    }
    edit(title, text) {
        this.title = title;
        this.text = text;
        this.editedAt = new Date();
    }
    isEdited() {
        return this.editedAt !== null && this.editedAt > this.createdAt;
    }
    static create(title, text) {
        return new MessageEntity(0, title, text, new Date(), null);
    }
    static fromPrisma(prismaData) {
        return new MessageEntity(prismaData.id, prismaData.title || '', prismaData.text || '', prismaData.created_at, prismaData.edited_at);
    }
    toPersistence() {
        return {
            id: this.id,
            title: this.title,
            text: this.text,
            created_at: this.createdAt,
            edited_at: this.editedAt,
        };
    }
}
exports.MessageEntity = MessageEntity;
//# sourceMappingURL=message.entity.js.map