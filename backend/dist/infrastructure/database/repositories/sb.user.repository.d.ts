import { IUserRepository } from "domain/repositories/user.repository.interface";
import { UserEntity } from "domain/entities/user.entity";
import { PrismaService } from "../prisma.service";
export declare class SbUserRepository implements IUserRepository {
    private prismaService;
    constructor(prismaService: PrismaService);
    findById(id: string): Promise<UserEntity | null>;
    findByKakaoId(kakaoId: string): Promise<UserEntity | null>;
    create(user: UserEntity): Promise<UserEntity>;
    update(user: UserEntity): Promise<UserEntity>;
    delete(id: string): Promise<void>;
}
