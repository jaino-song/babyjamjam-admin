"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserEntity = void 0;
class UserEntity {
    constructor(id, kakaoId, email, name, profileImage, role, createdAt) {
        this.id = id;
        this.kakaoId = kakaoId;
        this.email = email;
        this.name = name;
        this.profileImage = profileImage;
        this.role = role;
        this.createdAt = createdAt;
    }
    isAdmin() {
        return this.role === "admin";
    }
    canManageDocuments() {
        return ['admin', 'manager'].includes(this.role);
    }
    updateProfile(name, email) {
        this.name = name;
        this.email = email;
    }
    static create(kakaoId, name, profileImage, email) {
        return new UserEntity('', kakaoId, email || null, name || null, profileImage || null, 'user', new Date());
    }
    static fromPrisma(prismaData) {
        return new UserEntity(prismaData.id, prismaData.kakaoId, prismaData.email, prismaData.name, prismaData.profile_image, prismaData.role || 'user', prismaData.created_at);
    }
    toPersistence() {
        return {
            id: this.id,
            kakaoId: this.kakaoId,
            email: this.email,
            name: this.name,
            profile_image: this.profileImage,
            role: this.role,
            created_at: this.createdAt,
        };
    }
}
exports.UserEntity = UserEntity;
//# sourceMappingURL=user.entity.js.map