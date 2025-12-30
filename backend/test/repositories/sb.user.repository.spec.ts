import { SbUserRepository } from "infrastructure/database/repositories/sb.user.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { UserEntity } from "domain/entities/user.entity";

describe("SbUserRepository", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    const createMockPrismaUser = () => ({
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    });

    const createUserRow = (overrides = {}) => ({
        id: "user-1",
        kakaoId: "kakao-1",
        email: "user@example.com",
        name: "Jane Doe",
        profile_image: "http://example.com/avatar.png",
        role: "admin",
        created_at: new Date("2024-01-01T00:00:00.000Z"),
        ...overrides,
    });

    const createUserEntity = (overrides = {}) => {
        const defaults = {
            id: "",
            kakaoId: "kakao-test",
            email: "test@example.com",
            name: "Test User",
            profileImage: "http://example.com/test.png",
            role: "user",
            createdAt: new Date("2024-01-01T00:00:00.000Z"),
        };
        const merged = { ...defaults, ...overrides };
        return new UserEntity(
            merged.id,
            merged.kakaoId,
            merged.email,
            merged.name,
            merged.profileImage,
            merged.role,
            merged.createdAt,
        );
    };

    let userModel: ReturnType<typeof createMockPrismaUser>;
    let prisma: PrismaService;
    let repository: SbUserRepository;

    beforeEach(() => {
        userModel = createMockPrismaUser();
        prisma = { user: userModel } as unknown as PrismaService;
        repository = new SbUserRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // findById
    // ============================================
    describe("findById", () => {
        describe("given a user exists with the specified id", () => {
            it("should return the mapped UserEntity", async () => {
                // Arrange
                const row = createUserRow();
                userModel.findUnique.mockResolvedValue(row);

                // Act
                const result = await repository.findById("user-1");

                // Assert
                expect(userModel.findUnique).toHaveBeenCalledWith({ where: { id: "user-1" } });
                expect(result).toBeInstanceOf(UserEntity);
                expect(result).toMatchObject({
                    id: "user-1",
                    kakaoId: "kakao-1",
                    email: "user@example.com",
                    name: "Jane Doe",
                    profileImage: "http://example.com/avatar.png",
                    role: "admin",
                });
            });
        });

        describe("given no user exists with the specified id", () => {
            it("should return null", async () => {
                // Arrange
                userModel.findUnique.mockResolvedValue(null);

                // Act
                const result = await repository.findById("missing");

                // Assert
                expect(userModel.findUnique).toHaveBeenCalledWith({ where: { id: "missing" } });
                expect(result).toBeNull();
            });
        });
    });

    // ============================================
    // findByKakaoId
    // ============================================
    describe("findByKakaoId", () => {
        describe("given a user exists with the specified kakaoId", () => {
            it("should return the mapped UserEntity", async () => {
                // Arrange
                const now = new Date();
                const row = createUserRow({
                    id: "user-2",
                    kakaoId: "kakao-2",
                    created_at: now,
                });
                userModel.findUnique.mockResolvedValue(row);

                // Act
                const result = await repository.findByKakaoId("kakao-2");

                // Assert
                expect(userModel.findUnique).toHaveBeenCalledWith({ where: { kakaoId: "kakao-2" } });
                expect(result).toBeInstanceOf(UserEntity);
                expect(result).toMatchObject({
                    id: "user-2",
                    kakaoId: "kakao-2",
                    createdAt: now,
                });
            });
        });

        describe("given a user with null optional fields", () => {
            it("should handle null values and default role to user", async () => {
                // Arrange
                const now = new Date();
                const row = createUserRow({
                    id: "user-3",
                    kakaoId: "kakao-3",
                    email: null,
                    name: null,
                    profile_image: null,
                    role: null,
                    created_at: now,
                });
                userModel.findUnique.mockResolvedValue(row);

                // Act
                const result = await repository.findByKakaoId("kakao-3");

                // Assert
                expect(result).toMatchObject({
                    id: "user-3",
                    kakaoId: "kakao-3",
                    email: null,
                    name: null,
                    profileImage: null,
                    role: "user", // default role
                });
            });
        });

        describe("given no user exists with the kakaoId", () => {
            it("should return null", async () => {
                // Arrange
                userModel.findUnique.mockResolvedValue(null);

                // Act
                const result = await repository.findByKakaoId("non-existent");

                // Assert
                expect(result).toBeNull();
            });
        });
    });

    // ============================================
    // create
    // ============================================
    describe("create", () => {
        describe("given a valid UserEntity", () => {
            it("should persist user and return created entity", async () => {
                // Arrange
                const entity = createUserEntity({
                    kakaoId: "kakao-new",
                    email: "new@example.com",
                    name: "New User",
                    profileImage: "http://example.com/new.png",
                    role: "manager",
                });
                const createdRow = createUserRow({
                    id: "user-new",
                    kakaoId: "kakao-new",
                    email: "new@example.com",
                    name: "New User",
                    profile_image: "http://example.com/new.png",
                    role: "manager",
                });
                userModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(entity);

                // Assert
                expect(userModel.create).toHaveBeenCalledWith({
                    data: {
                        kakaoId: "kakao-new",
                        email: "new@example.com",
                        name: "New User",
                        profile_image: "http://example.com/new.png",
                        role: "manager",
                    },
                });
                expect(result).toMatchObject({
                    id: "user-new",
                    kakaoId: "kakao-new",
                });
            });
        });

        describe("given entity with minimal fields", () => {
            it("should create user with provided fields only", async () => {
                // Arrange
                const entity = createUserEntity({
                    kakaoId: "kakao-minimal",
                    email: null,
                    name: null,
                    profileImage: null,
                    role: "user",
                });
                const createdRow = createUserRow({
                    id: "user-minimal",
                    kakaoId: "kakao-minimal",
                    email: null,
                    name: null,
                    profile_image: null,
                    role: "user",
                });
                userModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(entity);

                // Assert
                expect(result.id).toBe("user-minimal");
            });
        });
    });

    // ============================================
    // update
    // ============================================
    describe("update", () => {
        describe("given an existing UserEntity with changes", () => {
            it("should update user with correct data", async () => {
                // Arrange
                const entity = createUserEntity({
                    id: "user-4",
                    kakaoId: "kakao-4",
                    email: "updated@example.com",
                    name: "Updated User",
                    profileImage: "http://example.com/updated.png",
                    role: "manager",
                });
                const updatedRow = createUserRow({
                    id: "user-4",
                    kakaoId: "kakao-4",
                    email: "updated@example.com",
                    name: "Updated User",
                    profile_image: "http://example.com/updated.png",
                    role: "manager",
                });
                userModel.update.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(entity);

                // Assert
                expect(userModel.update).toHaveBeenCalledWith({
                    where: { id: "user-4" },
                    data: {
                        email: "updated@example.com",
                        name: "Updated User",
                        profile_image: "http://example.com/updated.png",
                        role: "manager",
                    },
                });
                expect(result).toMatchObject({
                    id: "user-4",
                    role: "manager",
                });
            });
        });

        describe("given role change from user to admin", () => {
            it("should correctly update the role", async () => {
                // Arrange
                const entity = createUserEntity({
                    id: "user-5",
                    kakaoId: "kakao-5",
                    role: "admin",
                });
                const updatedRow = createUserRow({
                    id: "user-5",
                    role: "admin",
                });
                userModel.update.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(entity);

                // Assert
                expect(userModel.update).toHaveBeenCalledWith({
                    where: { id: "user-5" },
                    data: expect.objectContaining({
                        role: "admin",
                    }),
                });
                expect(result.role).toBe("admin");
            });
        });
    });

    // ============================================
    // delete
    // ============================================
    describe("delete", () => {
        describe("given a valid user id", () => {
            it("should delete the user", async () => {
                // Arrange
                userModel.delete.mockResolvedValue(undefined);

                // Act
                await repository.delete("user-5");

                // Assert
                expect(userModel.delete).toHaveBeenCalledWith({ where: { id: "user-5" } });
            });
        });

        describe("given different user ids", () => {
            it.each(["user-1", "user-abc", "uuid-123-456"])("should delete user with id %s", async (id) => {
                // Arrange
                userModel.delete.mockResolvedValue(undefined);

                // Act
                await repository.delete(id);

                // Assert
                expect(userModel.delete).toHaveBeenCalledWith({ where: { id } });
            });
        });
    });
});
