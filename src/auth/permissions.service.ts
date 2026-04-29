import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.entity';
import { PermissionsMode } from './decorators/require-permissions.decorator';

export type PerimetreType = 'global' | 'structure' | 'centre_responsabilite';

export interface EffectivePermission {
  code_permission: string;
  module: string;
  perimetre_type: PerimetreType;
  perimetre_id: string | null;
}

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
  ) {}

  async getEffectivePermissions(
    userId: string,
  ): Promise<EffectivePermission[]> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !user.estActif) {
      return [];
    }

    const today = new Date().toISOString().slice(0, 10);

    const userRoles = await this.userRoleRepo
      .createQueryBuilder('ur')
      .innerJoinAndSelect('ur.role', 'role')
      .leftJoinAndSelect('role.rolePermissions', 'rp')
      .leftJoinAndSelect('rp.permission', 'perm')
      .where('ur.fk_user = :userId', { userId })
      .andWhere('ur.est_actif = :true', { true: true })
      .andWhere('role.est_actif = :true', { true: true })
      .andWhere(
        '(ur.date_debut_validite IS NULL OR ur.date_debut_validite <= :today)',
        { today },
      )
      .andWhere(
        '(ur.date_fin_validite IS NULL OR ur.date_fin_validite >= :today)',
        { today },
      )
      .getMany();

    const result: EffectivePermission[] = [];
    for (const ur of userRoles) {
      const perimetreType: PerimetreType = (ur.perimetreType ??
        'global') as PerimetreType;
      for (const rp of ur.role.rolePermissions ?? []) {
        if (!rp.permission) continue;
        result.push({
          code_permission: rp.permission.codePermission,
          module: rp.permission.module,
          perimetre_type: perimetreType,
          perimetre_id: ur.perimetreId,
        });
      }
    }
    return result;
  }

  async hasPermission(
    userId: string,
    codes: string[],
    mode: PermissionsMode = 'any',
  ): Promise<boolean> {
    const effective = await this.getEffectivePermissions(userId);
    const possessed = new Set(effective.map((p) => p.code_permission));

    if (mode === 'all') {
      return codes.every((c) => possessed.has(c));
    }
    return codes.some((c) => possessed.has(c));
  }
}
