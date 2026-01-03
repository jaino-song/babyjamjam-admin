import { FindUserByKakaoIdUsecase } from "application/usecases/user/find-user-by-kakao-id.usecase";
import { MockUserRepository, UserFactory } from "../../utils";

describe("FindUserByKakaoIdUsecase", () => {
    let usecase: FindUserByKakaoIdUsecase;
    let mockRepository: MockUserRepository;

    beforeEach(() => {
        mockRepository = new MockUserRepository();
        usecase = new FindUserByKakaoIdUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should return user when kakaoId exists", async () => {
            // Arrange
            const existingUser = UserFactory.create({
                id: "user_1",
                kakaoId: "kakao_12345",
                name: "테스트 유저",
            });
            mockRepository.setData([existingUser]);

            // Act
            const result = await usecase.execute("kakao_12345");

            // Assert
            expect(result).not.toBeNull();
            expect(result?.kakaoId).toBe("kakao_12345");
            expect(result?.name).toBe("테스트 유저");
        });

        it("should return null when kakaoId does not exist", async () => {
            // Arrange - empty repository

            // Act
            const result = await usecase.execute("kakao_nonexistent");

            // Assert
            expect(result).toBeNull();
        });

        it("should find correct user among multiple users", async () => {
            // Arrange
            const users = [
                UserFactory.create({ id: "user_1", kakaoId: "kakao_111", name: "User 1" }),
                UserFactory.create({ id: "user_2", kakaoId: "kakao_222", name: "User 2" }),
                UserFactory.create({ id: "user_3", kakaoId: "kakao_333", name: "User 3" }),
            ];
            mockRepository.setData(users);

            // Act
            const result = await usecase.execute("kakao_222");

            // Assert
            expect(result).not.toBeNull();
            expect(result?.id).toBe("user_2");
            expect(result?.name).toBe("User 2");
        });

        it("should return user with all fields", async () => {
            // Arrange
            const user = UserFactory.create({
                id: "user_full",
                kakaoId: "kakao_full",
                name: "Full User",
                email: "full@example.com",
                profileImage: "https://example.com/img.jpg",
                role: "admin",
            });
            mockRepository.setData([user]);

            // Act
            const result = await usecase.execute("kakao_full");

            // Assert
            expect(result?.email).toBe("full@example.com");
            expect(result?.profileImage).toBe("https://example.com/img.jpg");
            expect(result?.role).toBe("admin");
        });
    });
});
