import { Module } from "@nestjs/common";

import { SystemAdminService } from "application/services/system-admin.service";
import { DatabaseModule } from "infrastructure/database/database.module";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import { SystemAdminController } from "interface/controllers/system-admin.controller";

@Module({
    imports: [DatabaseModule],
    controllers: [SystemAdminController],
    providers: [SystemAdminService, OwnerGuard],
    exports: [SystemAdminService],
})
export class SystemAdminModule {}
