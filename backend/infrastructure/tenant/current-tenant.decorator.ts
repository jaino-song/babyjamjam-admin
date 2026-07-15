import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentTenant = createParamDecorator(
    (...args: [unknown, ExecutionContext]) => {
        const ctx = args[1];
        const request = ctx.switchToHttp().getRequest();
        return {
            userId: request.user?.userId,
            branchId: request.user?.branchId,
            role: request.user?.role,
            branchRole: request.user?.branchRole,
        };
    },
);
