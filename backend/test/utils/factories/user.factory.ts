import { UserEntity } from "domain/entities/user.entity";

/**
 * UserEntity를 생성하기 위한 테스트 팩토리
 */
export interface CreateUserFactoryParams {
    id?: string;
    kakaoId?: string;
    email?: string | null;
    name?: string | null;
    profileImage?: string | null;
    role?: string | null;
    createdAt?: Date;
}

export class UserFactory {
    /**
     * 기본값이 적용된 UserEntity 생성
     */
    static create(params: CreateUserFactoryParams = {}): UserEntity {
        return UserEntity.reconstitute(
            params.id ?? "user_test_12345",
            params.kakaoId ?? "kakao_12345678",
            params.email ?? "test@example.com",
            params.name ?? "Test User",
            params.profileImage ?? "https://example.com/profile.jpg",
            params.role ?? "user",
            params.createdAt ?? new Date("2024-01-01"),
            null,
            false,
            null,
            params.kakaoId ? "kakao" : "email",
        );
    }

    /**
     * 여러 UserEntity 생성
     */
    static createMany(count: number, baseParams: CreateUserFactoryParams = {}): UserEntity[] {
        return Array.from({ length: count }, (_, index) =>
            UserFactory.create({
                ...baseParams,
                id: baseParams.id ?? `user_test_${index + 1}`,
                kakaoId: baseParams.kakaoId ?? `kakao_${index + 1}`,
                name: baseParams.name ?? `Test User ${index + 1}`,
                email: `test${index + 1}@example.com`,
            })
        );
    }

    /**
     * 관리자 사용자 생성
     */
    static createAdmin(params: CreateUserFactoryParams = {}): UserEntity {
        return UserFactory.create({
            ...params,
            role: "admin",
        });
    }

    /**
     * 매니저 사용자 생성
     */
    static createManager(params: CreateUserFactoryParams = {}): UserEntity {
        return UserFactory.create({
            ...params,
            role: "manager",
        });
    }

    /**
     * 일반 사용자 생성
     */
    static createRegularUser(params: CreateUserFactoryParams = {}): UserEntity {
        return UserFactory.create({
            ...params,
            role: "user",
        });
    }
}
