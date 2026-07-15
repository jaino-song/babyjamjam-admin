import { Injectable, Scope } from '@nestjs/common';

@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
    userId!: string;
    branchId!: string;
    role!: string;
    branchRole!: string;
}
