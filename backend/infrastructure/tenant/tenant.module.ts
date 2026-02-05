import { Global, Module } from '@nestjs/common';
import { TenantContext } from './tenant.context';
import { TenantGuard } from './tenant.guard';
import { PrismaService } from '../database/prisma.service';

@Global()
@Module({
    providers: [TenantContext, TenantGuard, PrismaService],
    exports: [TenantContext, TenantGuard],
})
export class TenantModule {}
