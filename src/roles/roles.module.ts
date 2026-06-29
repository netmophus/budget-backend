import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { UserRole } from '../users/entities/user-role.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { PermissionsController } from './permissions.controller';
import { RolePermissionService } from './role-permission.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Role, Permission, RolePermission, UserRole]),
    AuditModule,
  ],
  controllers: [RolesController, PermissionsController],
  providers: [RolesService, RolePermissionService],
  exports: [TypeOrmModule, RolesService],
})
export class RolesModule {}
