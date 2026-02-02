import { Module } from '@nestjs/common';
import { TenantContext } from './tenant.context';
import { TenantGuard } from './tenant.guard';
import { PrismaService } from '../database/prisma.service';

@Module({
    providers: [TenantContext, TenantGuard, PrismaService],
    exports: [TenantContext, TenantGuard],
})
export class TenantModule {}
