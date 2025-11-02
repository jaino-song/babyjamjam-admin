import { CreateUserUsecase, FindUserByIdUsecase, FindUserByKakaoIdUsecase, UpdateUserUsecase, DeleteUserUsecase } from "application/usecases/user";
import { UserEntity } from "domain/entities/user.entity";
export declare class UserService {
    private readonly createUserUsecase;
    private readonly findUserByIdUsecase;
    private readonly findUserByKakaoIdUsecase;
    private readonly updateUserUsecase;
    private readonly deleteUserUsecase;
    constructor(createUserUsecase: CreateUserUsecase, findUserByIdUsecase: FindUserByIdUsecase, findUserByKakaoIdUsecase: FindUserByKakaoIdUsecase, updateUserUsecase: UpdateUserUsecase, deleteUserUsecase: DeleteUserUsecase);
    create(params: {
        kakaoId: string;
        name?: string;
        email?: string;
        profileImage?: string;
    }): Promise<UserEntity>;
    findById(id: string): Promise<UserEntity | null>;
    findByKakaoId(kakaoId: string): Promise<UserEntity | null>;
    update(id: string, params: {
        name?: string;
        email?: string;
        profileImage?: string;
        role?: string | null;
    }): Promise<UserEntity>;
    delete(id: string): Promise<void>;
}
