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
            user_branch: {
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
        describe('given user with valid branchid and membership', () => {
            it('should return true and populate tenantcontext', async () => {
                // #given
                const user = {
                    userId: 'user-123',
                    branchId: 'org-123',
                    role: 'user',
                    branchRole: 'admin',
                };
                const mockContext = createMockContext(user);
                mockPrismaService.user_branch.findFirst.mockResolvedValue({
                    user_id: user.userId,
                    branch_id: user.branchId,
                    role: 'admin',
                });

                // #when
                const result = await guard.canActivate(mockContext as any);

                // #then
                expect(result).toBe(true);
                expect(tenantContext.userId).toBe(user.userId);
                expect(tenantContext.branchId).toBe(user.branchId);
            });
        });

        describe('given user without branchid', () => {
            it('should throw forbiddenexception', async () => {
                // #given
                const user = { userId: 'user-123', role: 'user' };
                const mockContext = createMockContext(user);

                // #when & #then
                await expect(guard.canActivate(mockContext as any))
                    .rejects.toThrow(ForbiddenException);
            });
        });

        describe('given user not member of branch', () => {
            it('should throw forbiddenexception', async () => {
                // #given
                const user = {
                    userId: 'user-123',
                    branchId: 'org-123',
                    role: 'user',
                };
                const mockContext = createMockContext(user);
                mockPrismaService.user_branch.findFirst.mockResolvedValue(null);

                // #when & #then
                await expect(guard.canActivate(mockContext as any))
                    .rejects.toThrow(ForbiddenException);
            });
        });
    });
});
