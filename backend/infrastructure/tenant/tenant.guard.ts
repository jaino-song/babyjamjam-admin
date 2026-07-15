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

        if (!user?.branchId) {
            throw new ForbiddenException('Branch selection required');
        }

        // Owners have access to all branches without membership check
        if (user.role === 'owner') {
            // Verify the branch exists
            const org = await this.prisma.branch.findUnique({
                where: { id: user.branchId },
                select: { id: true },
            });

            if (!org) {
                throw new ForbiddenException('Branch not found');
            }

            this.tenantContext.userId = user.userId;
            this.tenantContext.branchId = user.branchId;
            this.tenantContext.role = user.role;
            this.tenantContext.branchRole = 'owner';

            return true;
        }

        // Regular users must have membership
        const membership = await this.prisma.user_branch.findFirst({
            where: {
                userId: user.userId,
                branchId: user.branchId,
            },
        });

        if (!membership) {
            throw new ForbiddenException('Access denied to this branch');
        }

        this.tenantContext.userId = user.userId;
        this.tenantContext.branchId = user.branchId;
        this.tenantContext.role = user.role;
        this.tenantContext.branchRole = membership.role ?? 'member';

        return true;
    }
}
