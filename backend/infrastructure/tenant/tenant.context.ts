import { Injectable, Scope } from '@nestjs/common';

export interface VerifiedTenantPrincipal {
    userId: string;
    branchId: string;
    globalRole: string;
    branchRole: string;
}

@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
    userId!: string;
    branchId!: string;
    globalRole!: string;
    branchRole!: string;

    get role(): string {
        return this.globalRole;
    }

    set role(value: string) {
        this.globalRole = value;
    }

    assign(principal: VerifiedTenantPrincipal): void {
        this.userId = principal.userId;
        this.branchId = principal.branchId;
        this.globalRole = principal.globalRole;
        this.branchRole = principal.branchRole;
    }
}
