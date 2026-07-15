import { Module } from "@nestjs/common";
import {
    CreateUserUsecase,
    FindUserByIdUsecase,
    FindUserByKakaoIdUsecase,
    UpdateUserUsecase,
    DeleteUserUsecase,
} from "application/usecases/user";
import {
    SbUserRepository,
} from "infrastructure/database/repositories/sb.user.repository";
import { UserService } from "application/services/user.service";
import { UserController } from "interface/controllers/user.controller";
import { USER_REPOSITORY } from "domain/repositories/user.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { OwnerOnlyGuard } from "infrastructure/auth/owner-only.guard";

@Module({
    imports: [DatabaseModule],
    controllers: [UserController],
    providers: [
        CreateUserUsecase,
        FindUserByIdUsecase,
        FindUserByKakaoIdUsecase,
        UpdateUserUsecase,
        DeleteUserUsecase,
        UserService,
        OwnerOrAdminGuard,
        OwnerOnlyGuard,
        {
            provide: USER_REPOSITORY,
            useClass: SbUserRepository,
        },
    ],
    exports: [UserService],
})
export class UserModule {}
