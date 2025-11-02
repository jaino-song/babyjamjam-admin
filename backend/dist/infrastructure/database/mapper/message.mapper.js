"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageMapper = void 0;
const message_entity_1 = require("../../../domain/entities/message.entity");
class MessageMapper {
    static toDomain(row) {
        return new message_entity_1.MessageEntity(row.id, row.title || '', row.text || '', row.created_at, row.edited_at);
    }
    static toPrismaCreate(entity) {
        return {
            title: entity.title,
            text: entity.text,
        };
    }
    static toPrismaUpdate(entity) {
        return {
            title: entity.title,
            text: entity.text,
            edited_at: entity.editedAt,
        };
    }
}
exports.MessageMapper = MessageMapper;
//# sourceMappingURL=message.mapper.js.map