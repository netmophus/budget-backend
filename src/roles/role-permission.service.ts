/**
 * RolePermissionService (PR A) — édition de la matrice rôle × permission
 * depuis l'UI admin (permission ROLE.GERER).
 *
 * Deux opérations atomiques sur `bridge_role_permission` :
 *  - ajouterPermission : INSERT idempotent (lien déjà présent → no-op,
 *    sans audit).
 *  - retirerPermission : DELETE, sous garde-fous (cf. constants).
 *
 * Comme pour UsersAdminService, l'écriture et sa ligne d'audit sont
 * solidaires dans une même transaction : si l'INSERT audit échoue, la
 * mutation est annulée (exigence réglementaire, cf. AuditService).
 */
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { UserRole } from '../users/entities/user-role.entity';
import { RolePermissionMutationDto } from './dto/role-permission-mutation.dto';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import {
  ANTI_LOCKOUT_PERMISSION,
  PROTECTED_PERMISSIONS,
  PROTECTED_ROLE,
} from './role-permission.constants';

interface AuthCaller {
  userId: string;
  email: string;
}

@Injectable()
export class RolePermissionService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    private readonly auditService: AuditService,
  ) {}

  async ajouterPermission(
    roleId: string,
    permId: string,
    currentUser: AuthCaller,
    motif?: string,
  ): Promise<RolePermissionMutationDto> {
    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    if (!role) throw new NotFoundException(`Rôle ${roleId} introuvable.`);
    const perm = await this.permissionRepo.findOne({ where: { id: permId } });
    if (!perm) throw new NotFoundException(`Permission ${permId} introuvable.`);

    // Idempotent : si le lien existe déjà, on ne réécrit rien et on
    // n'émet pas d'audit (ON CONFLICT DO NOTHING en pratique).
    const existing = await this.rolePermissionRepo.findOne({
      where: { fkRole: roleId, fkPermission: permId },
    });
    if (existing) {
      return {
        roleId: String(role.id),
        codeRole: role.codeRole,
        fkPermission: String(perm.id),
        codePermission: perm.codePermission,
        deja: true,
      };
    }

    return this.rolePermissionRepo.manager.transaction(async (tx) => {
      const rpRepo = tx.getRepository(RolePermission);
      await rpRepo.save(
        rpRepo.create({ fkRole: roleId, fkPermission: permId }),
      );

      await this.auditService.log(
        {
          utilisateur: currentUser.email,
          typeAction: 'ATTRIBUER_PERMISSION',
          entiteCible: 'bridge_role_permission',
          idCible: String(role.id),
          statut: 'success',
          payloadApres: {
            fkRole: String(role.id),
            codeRole: role.codeRole,
            fkPermission: String(perm.id),
            codePermission: perm.codePermission,
            module: perm.module,
            motif: motif ?? null,
          },
          commentaire: `Permission ${perm.codePermission} ajoutée au rôle ${role.codeRole}.`,
        },
        tx,
      );

      return {
        roleId: String(role.id),
        codeRole: role.codeRole,
        fkPermission: String(perm.id),
        codePermission: perm.codePermission,
        deja: false,
      };
    });
  }

  async retirerPermission(
    roleId: string,
    permId: string,
    currentUser: AuthCaller,
    motif?: string,
  ): Promise<RolePermissionMutationDto> {
    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    if (!role) throw new NotFoundException(`Rôle ${roleId} introuvable.`);
    const perm = await this.permissionRepo.findOne({ where: { id: permId } });
    if (!perm) throw new NotFoundException(`Permission ${permId} introuvable.`);

    const lien = await this.rolePermissionRepo.findOne({
      where: { fkRole: roleId, fkPermission: permId },
    });
    if (!lien) {
      throw new NotFoundException(
        `Le rôle ${role.codeRole} ne possède pas la permission ${perm.codePermission}.`,
      );
    }

    // Garde-fou 1 : permissions racines verrouillées sur le rôle ADMIN
    // (séparation des tâches BCEAO — l'admin système reste atteignable).
    if (
      role.codeRole === PROTECTED_ROLE &&
      PROTECTED_PERMISSIONS.includes(perm.codePermission)
    ) {
      throw new ForbiddenException(
        `La permission ${perm.codePermission} est verrouillée sur le rôle ${PROTECTED_ROLE} (séparation des tâches). Retrait interdit.`,
      );
    }

    // Garde-fou 2 : anti-lockout. Un utilisateur ne peut pas retirer
    // ROLE.GERER d'un rôle qu'il porte lui-même — il perdrait l'accès à
    // cet écran et gèlerait la matrice.
    if (perm.codePermission === ANTI_LOCKOUT_PERMISSION) {
      const porte = await this.userRoleRepo.findOne({
        where: { fkUser: currentUser.userId, fkRole: roleId, estActif: true },
      });
      if (porte) {
        throw new ForbiddenException(
          `Anti-lockout : vous ne pouvez pas retirer ${ANTI_LOCKOUT_PERMISSION} d'un rôle que vous portez (${role.codeRole}) — vous perdriez l'accès à la gestion des rôles.`,
        );
      }
    }

    return this.rolePermissionRepo.manager.transaction(async (tx) => {
      const rpRepo = tx.getRepository(RolePermission);
      await rpRepo.delete({ id: lien.id });

      await this.auditService.log(
        {
          utilisateur: currentUser.email,
          typeAction: 'RETIRER_PERMISSION',
          entiteCible: 'bridge_role_permission',
          idCible: String(role.id),
          statut: 'success',
          payloadAvant: {
            fkRole: String(role.id),
            codeRole: role.codeRole,
            fkPermission: String(perm.id),
            codePermission: perm.codePermission,
            module: perm.module,
            motif: motif ?? null,
          },
          commentaire: `Permission ${perm.codePermission} retirée du rôle ${role.codeRole}.`,
        },
        tx,
      );

      return {
        roleId: String(role.id),
        codeRole: role.codeRole,
        fkPermission: String(perm.id),
        codePermission: perm.codePermission,
        deja: false,
      };
    });
  }
}
