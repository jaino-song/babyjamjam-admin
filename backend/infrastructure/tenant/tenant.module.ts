import { Global, Module } from '@nestjs/common';
import { TenantContext } from './tenant.context';
import { TenantGuard } from './tenant.guard';
import { DatabaseModule } from '../database/database.module';

@Global()
@Module({
    imports: [DatabaseModule],
    providers: [TenantContext, TenantGuard],
    exports: [TenantContext, TenantGuard],
})
export class TenantModule {}
