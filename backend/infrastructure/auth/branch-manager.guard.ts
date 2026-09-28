import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";

@Injectable()
export class BranchManagerGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const tenant = context.switchToHttp().getRequest().tenant;
        if (!tenant) {
            return false;
        }

        return tenant.globalRole === "owner"
            || tenant.branchRole === "admin"
            || tenant.branchRole === "manager";
    }
}
