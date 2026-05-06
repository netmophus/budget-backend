/**
 * PerimetreService — calcule la liste des centres de responsabilité
 * (CR) accessibles à un utilisateur selon ses rôles RBAC actifs et
 * leurs périmètres (Lot 3.3, Q5).
 *
 * **Algorithme** (cf. `docs/modele-donnees.md` §4.4) :
 *
 *  1. Charger les rôles actifs du user (`bridge_user_role.est_actif=true`
 *     ET la date du jour ∈ [`date_debut_validite`, `date_fin_validite`]
 *     quand bornées).
 *  2. Pour chaque rôle :
 *     - `perimetre_type IS NULL` ou `'global'` → renvoyer **null**
 *       immédiatement (un seul rôle global suffit à tout débloquer).
 *     - `perimetre_type = 'structure'` → ajouter au set d'union les CR
 *       attachés à la structure cible **+ ses descendants récursifs**
 *       (WITH RECURSIVE sur `dim_structure.fk_structure_parent`,
 *       version_courante=true).
 *     - `perimetre_type = 'centre_responsabilite'` → ajouter
 *       directement le CR cible (pas de descendance car CR est plat).
 *  3. Retourner `Array.from(set)` ; vide = aucun CR accessible.
 *
 * **Convention de retour** :
 *  - `null` = aucun filtre (admin global, voit tout)
 *  - `[]`   = aucun CR autorisé (l'utilisateur a des rôles mais sur
 *    périmètres invalides) → le caller doit retourner 0 résultat
 *  - `string[]` = liste explicite des `id` de CR autorisés
 *
 * **Sécurité** : si `userId` n'a aucun rôle actif, on lève
 * `UnauthorizedException` (situation impossible pour un user
 * authentifié sauf bug ou révocation de tous les rôles).
 */
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UserPerimetre } from '../../users/entities/user-perimetre.entity';
import { UserRole } from '../../users/entities/user-role.entity';

@Injectable()
export class PerimetreService {
  private readonly logger = new Logger(PerimetreService.name);

  constructor(
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(UserPerimetre)
    private readonly userPerimetreRepo: Repository<UserPerimetre>,
  ) {}

  /**
   * Liste des `id` de CR accessibles à l'utilisateur. `null` = pas de
   * filtre (admin global). `[]` = aucun CR (situation rare mais
   * possible). Stringifié bigint.
   *
   * Lot 4.1 — la source de vérité bascule de `bridge_user_role` vers
   * `user_perimetres`. Pour ne pas casser les déploiements en cours
   * (où le backfill peut ne pas être encore exécuté), on lit les
   * deux sources et on en fait l'union (dette tracée — Lot 6 :
   * retirer la lecture `bridge_user_role.perimetre_type` une fois la
   * coexistence stabilisée).
   *
   * Le rôle global ('global' dans `bridge_user_role.perimetre_type`)
   * reste détecté via le bridge (court-circuit admin).
   */
  async getCrAutorisesPourUser(userId: string): Promise<string[] | null> {
    // 1. Détection admin global via bridge_user_role (inchangé).
    const roles = await this.loadRolesActifs(userId);
    if (roles.length === 0) {
      throw new UnauthorizedException(
        `Aucun rôle actif pour l'utilisateur ${userId}. Accès budget refusé.`,
      );
    }
    if (
      roles.some((r) => (r.perimetreType ?? 'global').toLowerCase() === 'global')
    ) {
      return null;
    }

    // 2. Union de user_perimetres (Lot 4.1) et des anciennes
    //    affectations bridge_user_role (rétrocompat).
    const setIds = new Set<string>(await this.getPerimetreEffectif(userId));
    for (const id of await this.crsViaBridgeUserRole(roles)) {
      setIds.add(id);
    }
    return Array.from(setIds);
  }

  /**
   * Lecture historique (rétrocompat Lot 1-3) : extrait les CR
   * autorisés depuis `bridge_user_role.perimetre_type` (structure ou
   * centre_responsabilite). Sera supprimée au Lot 6 une fois la
   * bascule complète vers user_perimetres terminée.
   */
  private async crsViaBridgeUserRole(roles: UserRole[]): Promise<string[]> {
    const setIds = new Set<string>();
    for (const ur of roles) {
      const ptype = (ur.perimetreType ?? 'global').toLowerCase();
      if (ptype === 'structure' && ur.perimetreId) {
        const idsCr = await this.crsSousStructure(ur.perimetreId);
        idsCr.forEach((id) => setIds.add(id));
      } else if (ptype === 'centre_responsabilite' && ur.perimetreId) {
        const exists = await this.userRoleRepo.manager.query<
          Array<{ id: string }>
        >(
          `SELECT id FROM dim_centre_responsabilite
           WHERE id = $1 AND version_courante = true`,
          [ur.perimetreId],
        );
        if (exists.length > 0) setIds.add(String(exists[0]!.id));
      }
    }
    return Array.from(setIds);
  }

  /**
   * Calcule l'union des CR autorisés à l'utilisateur via l'ensemble
   * de ses affectations `user_perimetres` actives à la date `dateRef`
   * (par défaut aujourd'hui).
   *
   * Logique selon `cible_type` :
   *  - STRUCTURE → BFS itératif sur `dim_structure.fk_structure_parent`
   *    pour collecter tous les CR rattachés à la sous-arborescence.
   *  - CR        → ajouter directement (vérification version_courante).
   *  - CR_SET    → ajouter directement chaque id de `cible_cr_ids`.
   *
   * Filtres appliqués :
   *  - actif = true
   *  - date_debut <= dateRef
   *  - date_fin IS NULL OR date_fin >= dateRef
   *
   * Retour : tableau d'`id` de CR dédupliqués (jamais `null`, contrairement
   * à `getCrAutorisesPourUser` qui retourne `null` pour les admins).
   */
  async getPerimetreEffectif(
    userId: string,
    dateRef?: string,
  ): Promise<string[]> {
    const today = dateRef ?? new Date().toISOString().slice(0, 10);
    const perimetres = await this.userPerimetreRepo
      .createQueryBuilder('up')
      .where('up.fkUser = :userId', { userId })
      .andWhere('up.actif = true')
      .andWhere('up.dateDebut <= :today', { today })
      .andWhere('(up.dateFin IS NULL OR up.dateFin >= :today)', { today })
      .getMany();

    const setIds = new Set<string>();
    for (const p of perimetres) {
      if (p.cibleType === 'STRUCTURE') {
        if (!p.cibleId) {
          this.logger.warn(
            `Affectation ${p.id} (user ${userId}) : STRUCTURE sans cible_id. Ignorée.`,
          );
          continue;
        }
        const idsCr = await this.crsSousStructure(p.cibleId);
        idsCr.forEach((id) => setIds.add(id));
      } else if (p.cibleType === 'CR') {
        if (!p.cibleId) {
          this.logger.warn(
            `Affectation ${p.id} (user ${userId}) : CR sans cible_id. Ignorée.`,
          );
          continue;
        }
        const exists = await this.userRoleRepo.manager.query<
          Array<{ id: string }>
        >(
          `SELECT id FROM dim_centre_responsabilite
           WHERE id = $1 AND version_courante = true`,
          [p.cibleId],
        );
        if (exists.length > 0) setIds.add(String(exists[0]!.id));
      } else if (p.cibleType === 'CR_SET') {
        if (!p.cibleCrIds || p.cibleCrIds.length === 0) {
          this.logger.warn(
            `Affectation ${p.id} (user ${userId}) : CR_SET sans cible_cr_ids. Ignorée.`,
          );
          continue;
        }
        // Vérification version_courante en lot.
        const placeholders = p.cibleCrIds
          .map((_, i) => `$${i + 1}`)
          .join(',');
        const valides = await this.userRoleRepo.manager.query<
          Array<{ id: string }>
        >(
          `SELECT id FROM dim_centre_responsabilite
           WHERE id IN (${placeholders}) AND version_courante = true`,
          p.cibleCrIds,
        );
        valides.forEach((r) => setIds.add(String(r.id)));
      }
    }
    return Array.from(setIds);
  }

/* getPerimetresActifsPourUser déplacé dans UserPerimetreService.lister
   (Lot 4.1) — évite un import croisé UsersModule ↔ BudgetModule. */

  /**
   * Liste des `id` de structures couvertes par les rôles actifs du
   * user (utile pour d'autres modules — ex: filtrer dim_structure
   * dans une page d'arborescence).
   *
   * `null` = pas de filtre (admin). `[]` = aucune structure couverte.
   */
  async getStructuresAutoriseesPourUser(
    userId: string,
  ): Promise<string[] | null> {
    const roles = await this.loadRolesActifs(userId);
    if (roles.length === 0) {
      throw new UnauthorizedException(
        `Aucun rôle actif pour l'utilisateur ${userId}.`,
      );
    }

    const setIds = new Set<string>();
    for (const ur of roles) {
      const ptype = (ur.perimetreType ?? 'global').toLowerCase();
      if (ptype === 'global') return null;
      if (ptype === 'structure' && ur.perimetreId) {
        const ids = await this.descendantsStructure(ur.perimetreId);
        ids.forEach((id) => setIds.add(id));
      }
      // perimetre_type='centre_responsabilite' n'élargit pas le
      // périmètre structure (un CR appartient à une seule structure
      // mais cela n'autorise pas l'accès à toute la structure).
    }
    return Array.from(setIds);
  }

  // ─── Helpers privés ────────────────────────────────────────────────

  private async loadRolesActifs(userId: string): Promise<UserRole[]> {
    const today = new Date().toISOString().slice(0, 10);
    return this.userRoleRepo
      .createQueryBuilder('ur')
      .where('ur.fkUser = :userId', { userId })
      .andWhere('ur.estActif = :estActif', { estActif: true })
      .andWhere(
        `(ur.dateDebutValidite IS NULL OR ur.dateDebutValidite <= :today)`,
        { today },
      )
      .andWhere(
        `(ur.dateFinValidite IS NULL OR ur.dateFinValidite >= :today)`,
        { today },
      )
      .getMany();
  }

  /**
   * Calcule la liste des `id` de structures = la cible + tous ses
   * descendants (version_courante=true ET est_actif=true).
   *
   * **Implémentation BFS itérative** : la requête naturelle serait
   * un `WITH RECURSIVE` PostgreSQL (cf. `docs/modele-donnees.md`
   * §4.4), mais pg-mem (utilisé par les tests unitaires) ne le
   * supporte pas — d'où une boucle JS qui charge les enfants par
   * couches successives. Perf acceptable tant que la profondeur ≤ 6
   * et la largeur < 1000 structures (cas MVP : < 100 structures,
   * profondeur ≤ 5). Index `ix_dim_structure_parent` couvre la
   * jointure de chaque couche.
   *
   * Si la perf devient un enjeu en prod (>10 000 structures), on
   * pourra basculer conditionnellement sur `WITH RECURSIVE` en
   * détectant le driver via `dataSource.options.type === 'postgres'`.
   *
   * Retour `[]` si la structure cible est introuvable / non courante
   * / désactivée (warning loggué).
   */
  private async descendantsStructure(
    structureId: string,
  ): Promise<string[]> {
    const racine = await this.userRoleRepo.manager.query<
      Array<{ id: string }>
    >(
      `SELECT id FROM dim_structure
        WHERE id = $1 AND version_courante = true AND est_actif = true`,
      [structureId],
    );
    if (racine.length === 0) {
      this.logger.warn(
        `Structure ${structureId} introuvable / non courante / désactivée. Aucun CR rattaché ne sera autorisé.`,
      );
      return [];
    }

    const all = new Set<string>([String(racine[0]!.id)]);
    let frontiere = [String(racine[0]!.id)];
    while (frontiere.length > 0) {
      // IN ($1, $2, …) plutôt que ANY($1::bigint[]) car pg-mem ne
      // supporte pas la syntaxe ANY array.
      const placeholders = frontiere.map((_, i) => `$${i + 1}`).join(',');
      const enfants = await this.userRoleRepo.manager.query<
        Array<{ id: string }>
      >(
        `SELECT id FROM dim_structure
          WHERE fk_structure_parent IN (${placeholders})
            AND version_courante = true`,
        frontiere,
      );
      const next: string[] = [];
      for (const e of enfants) {
        const id = String(e.id);
        if (!all.has(id)) {
          all.add(id);
          next.push(id);
        }
      }
      frontiere = next;
    }
    return Array.from(all);
  }

  /**
   * CR rattachés à la structure cible OU à un de ses descendants
   * (version_courante=true ET est_actif=true).
   */
  private async crsSousStructure(structureId: string): Promise<string[]> {
    const idsStruct = await this.descendantsStructure(structureId);
    if (idsStruct.length === 0) return [];
    const placeholders = idsStruct.map((_, i) => `$${i + 1}`).join(',');
    const rows = await this.userRoleRepo.manager.query<
      Array<{ id: string }>
    >(
      `SELECT id FROM dim_centre_responsabilite
        WHERE fk_structure IN (${placeholders})
          AND version_courante = true
          AND est_actif = true`,
      idsStruct,
    );
    return rows.map((r) => String(r.id));
  }
}
