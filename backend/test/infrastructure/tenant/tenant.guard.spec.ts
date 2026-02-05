import { ForbiddenException } from '@nestjs/common';
import { TenantGuard } from '../../../infrastructure/tenant/tenant.guard';
import { TenantContext } from '../../../infrastructure/tenant/tenant.context';
import { PrismaService } from '../../../infrastructure/database/prisma.service';

describe('TenantGuard', () => {
    let guard: TenantGuard;
    let tenantContext: TenantContext;
    let mockPrismaService: any;

    const createMockContext = (user: any) => ({
        switchToHttp: () => ({
            getRequest: () => ({ user }),
        }),
    });

    beforeEach(() => {
        mockPrismaService = {
            user_organization: {
                findFirst: jest.fn(),
            },
        };
        tenantContext = new TenantContext();
        guard = new TenantGuard(
            mockPrismaService as unknown as PrismaService,
            tenantContext,
        );
    });

    describe('canActivate', () => {
        describe('given user with valid organizationid and membership', () => {
            it('should return true and populate tenantcontext', async () => {
                // #given
                const user = {
                    userId: 'user-123',
                    organizationId: 'org-123',
                    role: 'user',
                    orgRole: 'admin',
                };
                const mockContext = createMockContext(user);
                mockPrismaService.user_organization.findFirst.mockResolvedValue({
                    user_id: user.userId,
                    organization_id: user.organizationId,
                    role: 'admin',
                });

                // #when
                const result = await guard.canActivate(mockContext as any);

                // #then
                expect(result).toBe(true);
                expect(tenantContext.userId).toBe(user.userId);
                expect(tenantContext.organizationId).toBe(user.organizationId);
            });
        });

        describe('given user without organizationid', () => {
            it('should throw forbiddenexception', async () => {
                // #given
                const user = { userId: 'user-123', role: 'user' };
                const mockContext = createMockContext(user);

                // #when & #then
                await expect(guard.canActivate(mockContext as any))
                    .rejects.toThrow(ForbiddenException);
            });
        });

        describe('given user not member of organization', () => {
            it('should throw forbiddenexception', async () => {
                // #given
                const user = {
                    userId: 'user-123',
                    organizationId: 'org-123',
                    role: 'user',
                };
                const mockContext = createMockContext(user);
                mockPrismaService.user_organization.findFirst.mockResolvedValue(null);

                // #when & #then
                await expect(guard.canActivate(mockContext as any))
                    .rejects.toThrow(ForbiddenException);
            });
        });
    });
});
