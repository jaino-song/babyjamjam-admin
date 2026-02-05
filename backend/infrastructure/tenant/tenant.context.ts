import { Injectable, Scope } from '@nestjs/common';

@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
    userId!: string;
    organizationId!: string;
    role!: string;
    orgRole!: string;
}
