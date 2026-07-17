import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class OwnerOrAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const tenant = request.tenant;
    if (tenant) {
      return tenant.globalRole === 'owner' || tenant.branchRole === 'admin';
    }
    const role = request.user?.role;
    return role === 'admin' || role === 'owner';
  }
}
