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

        // Owners have access to all organizations without membership check
        if (user.role === 'owner') {
            // Verify the organization exists
            const org = await this.prisma.organization.findUnique({
                where: { id: user.organizationId },
            });

            if (!org) {
                throw new ForbiddenException('Organization not found');
            }

            this.tenantContext.userId = user.userId;
            this.tenantContext.organizationId = user.organizationId;
            this.tenantContext.role = user.role;
            this.tenantContext.orgRole = 'owner';

            return true;
        }

        // Regular users must have membership
        const membership = await this.prisma.user_organization.findFirst({
            where: {
                userId: user.userId,
                organizationId: user.organizationId,
            },
        });

        if (!membership) {
            throw new ForbiddenException('Access denied to this organization');
        }

        this.tenantContext.userId = user.userId;
        this.tenantContext.organizationId = user.organizationId;
        this.tenantContext.role = user.role;
        this.tenantContext.orgRole = membership.role ?? 'member';

        return true;
    }
}
