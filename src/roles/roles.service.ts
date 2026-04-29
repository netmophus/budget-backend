import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionResponseDto } from './dto/permission-response.dto';
import { RoleResponseDto } from './dto/role-response.dto';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';

function toPermissionDto(p: Permission): PermissionResponseDto {
  return {
    id: p.id,
    codePermission: p.codePermission,
    libelle: p.libelle,
    module: p.module,
    description: p.description,
  };
}

function toRoleDto(role: Role): RoleResponseDto {
  return {
    id: role.id,
    codeRole: role.codeRole,
    libelle: role.libelle,
    description: role.description,
    estActif: role.estActif,
    permissions: (role.rolePermissions ?? [])
      .filter((rp) => rp.permission)
      .map((rp) => toPermissionDto(rp.permission)),
  };
}

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
  ) {}

  async findAll(): Promise<RoleResponseDto[]> {
    const roles = await this.roleRepo.find({
      order: { codeRole: 'ASC' },
      relations: { rolePermissions: { permission: true } },
    });
    return roles.map(toRoleDto);
  }

  async findOne(id: string): Promise<RoleResponseDto> {
    const role = await this.roleRepo.findOne({
      where: { id },
      relations: { rolePermissions: { permission: true } },
    });
    if (!role) {
      throw new NotFoundException('Rôle introuvable');
    }
    return toRoleDto(role);
  }

  async findAllPermissions(): Promise<PermissionResponseDto[]> {
    const perms = await this.permissionRepo.find({
      order: { module: 'ASC', codePermission: 'ASC' },
    });
    return perms.map(toPermissionDto);
  }
}
