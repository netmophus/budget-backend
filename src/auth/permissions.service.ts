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

/**
 * Lot 4.2 — Permission effective enrichie du contexte d'origine.
 * `via='NATIF'` = vient d'un rôle (bridge_user_role).
 * `via='DELEGATION'` = vient d'une délégation active à `dateRef` ;
 * `delegation_id` est alors renseigné. Permet à l'audit et l'UI
 * de signaler clairement quand une action est effectuée via une
 * délégation reçue.
 */
export interface EffectivePermissionWithContext extends EffectivePermission {
  via: 'NATIF' | 'DELEGATION';
  delegation_id?: string;
}

/** Mapping verbe délégué → code permission RBAC sous-jacente. */
const DELEGATION_PERM_MAPPING: Record<string, string> = {
  SAISIE: 'BUDGET.SAISIR',
  SOUMISSION: 'BUDGET.SOUMETTRE',
  VALIDATION: 'BUDGET.VALIDER',
  PUBLICATION: 'BUDGET.PUBLIER',
};

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

  /**
   * Lot 4.2 — Permissions effectives enrichies du contexte d'origine.
   * Combine permissions natives (rôles RBAC) ET permissions reçues
   * par délégation active à `dateRef`. Chaque entrée a un champ
   * `via` ('NATIF' / 'DELEGATION'), avec `delegation_id` renseigné
   * pour les délégations.
   *
   * Utilisée par :
   *  - L'API frontend pour afficher les badges « via délégation »
   *  - L'audit applicatif pour propager `via_delegation_id` lors
   *    des actions métier (SAISIR / SOUMETTRE / VALIDER / PUBLIER).
   *
   * Le service requête `delegations` directement (pas de dépendance
   * vers DelegationsService pour éviter un cycle).
   */
  async getPermissionsEffectivesAvecContexte(
    userId: string,
    dateRef?: string,
  ): Promise<EffectivePermissionWithContext[]> {
    const today = dateRef ?? new Date().toISOString().slice(0, 10);

    const natives = await this.getEffectivePermissions(userId);
    const result: EffectivePermissionWithContext[] = natives.map((p) => ({
      ...p,
      via: 'NATIF' as const,
    }));

    // Permissions issues de délégations actives à dateRef
    const delegations = (await this.userRoleRepo.manager.query<
      Array<{
        id: string;
        permissions: string[];
      }>
    >(
      `SELECT id, permissions FROM delegations
        WHERE fk_delegataire = $1
          AND actif = true
          AND date_debut <= $2
          AND date_fin >= $2`,
      [userId, today],
    )) ?? [];

    for (const d of delegations) {
      for (const verb of d.permissions) {
        const code = DELEGATION_PERM_MAPPING[verb];
        if (!code) continue;
        result.push({
          code_permission: code,
          module: 'BUDGET',
          perimetre_type: 'centre_responsabilite',
          perimetre_id: null,
          via: 'DELEGATION',
          delegation_id: String(d.id),
        });
      }
    }
    return result;
  }

  /**
   * Lot 4.2-fix.A — Détermine si l'usage d'un code permission par
   * un user passe par une délégation. Retourne `delegation_id` si
   * oui, `null` sinon.
   *
   * **Priorité NATIF** : si l'utilisateur possède la permission à
   * la fois en natif (rôle RBAC) ET via délégation, on retourne
   * `null` — il agit avec son droit propre, pas via la délégation
   * reçue. Ne pas mentir dans l'audit.
   *
   * Utilisé par les services métier (workflow + saisie) pour
   * enrichir le payload audit avec `via_delegation_id` au moment
   * d'écrire l'audit_log.
   */
  async getDelegationContextPour(
    userId: string,
    codePermission: string,
    dateRef?: string,
  ): Promise<string | null> {
    const ctx = await this.getPermissionsEffectivesAvecContexte(
      userId,
      dateRef,
    );
    const aLeNatif = ctx.some(
      (p) => p.code_permission === codePermission && p.via === 'NATIF',
    );
    if (aLeNatif) return null;
    const parDelegation = ctx.find(
      (p) => p.code_permission === codePermission && p.via === 'DELEGATION',
    );
    return parDelegation?.delegation_id ?? null;
  }
}
