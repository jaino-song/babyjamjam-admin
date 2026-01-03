import { CreateUserUsecase } from "application/usecases/user/create-user.usecase";
import { MockUserRepository, UserFactory } from "../../utils";

describe("CreateUserUsecase", () => {
    let usecase: CreateUserUsecase;
    let mockRepository: MockUserRepository;

    beforeEach(() => {
        mockRepository = new MockUserRepository();
        usecase = new CreateUserUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should create a new user when kakaoId does not exist", async () => {
            // Arrange
            const kakaoId = "kakao_new_user";
            const name = "신규 사용자";
            const email = "new@example.com";
            const profileImage = "https://example.com/profile.jpg";

            // Act
            const result = await usecase.execute(kakaoId, name, email, profileImage);

            // Assert
            expect(result).toBeDefined();
            expect(result.kakaoId).toBe("kakao_new_user");
            expect(result.name).toBe("신규 사용자");
            expect(result.email).toBe("new@example.com");
        });

        it("should return existing user when kakaoId already exists", async () => {
            // Arrange
            const existingUser = UserFactory.create({
                id: "user_existing",
                kakaoId: "kakao_existing",
                name: "기존 사용자",
                email: "existing@example.com",
            });
            mockRepository.setData([existingUser]);

            // Act
            const result = await usecase.execute(
                "kakao_existing",
                "다른 이름",
                "other@example.com",
            );

            // Assert
            expect(result.id).toBe("user_existing");
            expect(result.name).toBe("기존 사용자"); // 기존 사용자 정보 유지
            expect(result.email).toBe("existing@example.com");
        });

        it("should not create duplicate users", async () => {
            // Arrange
            const kakaoId = "kakao_12345";

            // Act
            await usecase.execute(kakaoId, "User 1", "user1@test.com");
            await usecase.execute(kakaoId, "User 2", "user2@test.com");

            // Assert
            const allUsers = mockRepository.getAllData();
            expect(allUsers).toHaveLength(1);
        });

        it("should create user with minimal info (only kakaoId)", async () => {
            // Arrange
            const kakaoId = "kakao_minimal";

            // Act
            const result = await usecase.execute(kakaoId);

            // Assert
            expect(result).toBeDefined();
            expect(result.kakaoId).toBe("kakao_minimal");
        });

        it("should persist new user to repository", async () => {
            // Arrange
            const kakaoId = "kakao_persist_test";

            // Act
            await usecase.execute(kakaoId, "Persist Test", "persist@test.com");

            // Assert
            const persisted = await mockRepository.findByKakaoId(kakaoId);
            expect(persisted).not.toBeNull();
            expect(persisted?.name).toBe("Persist Test");
        });
    });
});
