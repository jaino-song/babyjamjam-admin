import { Module } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DatabaseModule } from "infrastructure/database/database.module";
import { AligoModule } from "module/aligo.module";
import { MessageModule } from "module/message.module";
import { SystemTemplateModule } from "module/system-template.module";
import { SystemSettingModule } from "module/system-setting.module";
import { EformsignDocModule } from "module/eformsign-doc.module";
import { AdminServiceRecordController } from "interface/controllers/admin-service-record.controller";
import { OWNER_RECORD_JSON_JWT_DECODER, OwnerRecordJsonBearerGuard, OwnerRecordJsonController } from "interface/controllers/owner-record-json.controller";
import { ServiceRecordEntryController } from "interface/controllers/service-record-entry.controller";
import { ServiceRecordPeriodMismatchService } from "application/services/service-record-period-mismatch.service";
import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { ServiceRecordCaseEventBus } from "application/services/service-record-case-event-bus.service";
import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import { ServiceRecordTokenService } from "application/services/service-record-token.service";
import { ServiceRecordLinkGroupService } from "application/services/service-record-link-group.service";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import { ServiceRecordGuard } from "infrastructure/auth/service-record.guard";
import { ServiceRecordEditAgentCapabilitiesProvider } from "application/usecases/service-record/service-record-edit-agent-capabilities.provider";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { ServiceRecordFinalizationSchedulerService } from "application/services/service-record-finalization-scheduler.service";
import { ServiceRecordLinkReconciliationService } from "application/services/service-record-link-reconciliation.service";
import { MessageAutomationIntentService } from "application/services/message-automation-intent.service";
import { ServiceRecordSecurityEventService } from "application/services/service-record-security-event.service";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { SERVICE_RECORD_EDIT_REPOSITORY } from "domain/repositories/service-record-edit.repository.interface";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import { HolidayModule } from "./holiday.module";

/**
 * No-login daily service-record capture (BJJ-247).
 * Exports the token + link services so the assignment / replacement / termination
 * hooks (employee-schedule + client modules) can issue and revoke links.
 */
@Module({
    imports: [DatabaseModule, AligoModule, MessageModule, SystemTemplateModule, SystemSettingModule, EformsignDocModule, HolidayModule],
    controllers: [ServiceRecordEntryController, AdminServiceRecordController, OwnerRecordJsonController],
    providers: [
        AdminServiceRecordService,
        ServiceRecordPeriodMismatchService,
        AdminServiceRecordEditService,
        ServiceRecordCaseEventBus,
        ServiceRecordEntryService,
        ServiceRecordTokenService,
        ServiceRecordLinkService,
        ServiceRecordLinkGroupService,
        ServiceRecordLifecycleService,
        ServiceRecordFinalizationSchedulerService,
        ServiceRecordLinkReconciliationService,
        MessageAutomationIntentService,
        ServiceRecordSecurityEventService,
        RateLimitGuard,
        OwnerOrAdminGuard,
        BranchManagerGuard,
        OwnerGuard,
        OwnerRecordJsonBearerGuard,
        {
            provide: OWNER_RECORD_JSON_JWT_DECODER,
            // Keep this decoder out of application-wide JwtService lookups.
            useFactory: (): Pick<JwtService, "decode"> => {
                const jwt = new JwtService();
                return { decode: jwt.decode.bind(jwt) };
            },
        },
        ServiceRecordGuard,
        ServiceRecordEditAgentCapabilitiesProvider,
        { provide: SERVICE_RECORD_EDIT_REPOSITORY, useClass: ServiceRecordEditRepository },
    ],
    exports: [
        ServiceRecordTokenService,
        ServiceRecordLinkService,
        ServiceRecordLifecycleService,
        MessageAutomationIntentService,
        SERVICE_RECORD_EDIT_REPOSITORY,
    ],
})
export class ServiceRecordEntryModule {}
