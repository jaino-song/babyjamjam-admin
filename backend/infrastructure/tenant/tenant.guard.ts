import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from './tenant.context';

@Injectable()
export class TenantGuard implements CanActivate {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user?.organizationId) {
            throw new ForbiddenException('Organization selection required');
        }

        const membership = await this.prisma.user_organization.findFirst({
            where: {
                user_id: user.userId,
                organization_id: user.organizationId,
            },
        });

        if (!membership) {
            throw new ForbiddenException('Access denied to this organization');
        }

        this.tenantContext.userId = user.userId;
        this.tenantContext.organizationId = user.organizationId;
        this.tenantContext.role = user.role;
        this.tenantContext.orgRole = membership.role;

        return true;
    }
}
