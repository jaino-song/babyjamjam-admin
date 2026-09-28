import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";

@Injectable()
export class VoucherPriceReadGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const tenant = request.tenant;

        if (!tenant) {
            return false;
        }

        return tenant.globalRole === "owner"
            || tenant.branchRole === "admin"
            || tenant.branchRole === "manager";
    }
}
