"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserMapper = void 0;
const user_entity_1 = require("../../../domain/entities/user.entity");
class UserMapper {
    static toDomain(row) {
        return new user_entity_1.UserEntity(row.id, row.kakaoId, row.email, row.name, row.profile_image, row.role || 'user', row.created_at);
    }
    static toPrismaCreate(entity) {
        return {
            kakaoId: entity.kakaoId,
            email: entity.email,
            name: entity.name,
            profile_image: entity.profileImage,
            role: entity.role,
        };
    }
    static toPrismaUpdate(entity) {
        return {
            email: entity.email,
            name: entity.name,
            profile_image: entity.profileImage,
            role: entity.role,
        };
    }
}
exports.UserMapper = UserMapper;
//# sourceMappingURL=user.mapper.js.map