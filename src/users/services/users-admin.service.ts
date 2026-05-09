/**
 * UsersAdminService (Lot Administration) — orchestre les opérations
 * d'administration utilisateurs accessibles depuis l'UI admin
 * (page /admin/utilisateurs) :
 *
 *  - CRUD : creer / modifier / désactiver / réactiver
 *  - Mot de passe : reset-password (génère un temporaire)
 *  - Sessions : forcerDeconnexion (révoque les refresh tokens)
 *  - Historique : 50 dernières lignes audit_log de connexion
 *  - Rôles : lister / attribuer / retirer (cumul autorisé)
 *
 * Garde-fous obligatoires :
 *  - Pas d'auto-désactivation
 *  - Pas de retrait du dernier rôle actif
 *  - Mot de passe initial ≥ 12 caractères (validé côté DTO)
 *  - Mot de passe en clair JAMAIS persisté dans audit_log
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { AuthService } from '../../auth/auth.service';
import { genererMotDePasseTemporaire } from '../../auth/password-policy';
import { EmailQueueProducer } from '../../notifications/email-queue.producer';
import { EmailLog } from '../../notifications/entities/email-log.entity';
import { Role } from '../../roles/entities/role.entity';
import {
  AttribuerRoleDto,
  CreerUserDto,
  HistoriqueConnexionItemDto,
  ModifierUserDto,
  MotifDto,
  ResetPasswordResponseDto,
  UserRoleResumeDto,
} from '../dto/admin-user.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/user-role.entity';

const BCRYPT_COST = 10;
/** Lot 6.4.C — durée de validité d'un mdp temporaire (jours). */
const RESET_MDP_DUREE_JOURS = 7;

interface AuthCaller {
  userId: string;
  email: string;
}

function toUserResponse(u: User): UserResponseDto {
  return {
    id: u.id,
    email: u.email,
    nom: u.nom,
    prenom: u.prenom,
    estActif: u.estActif,
    dateDerniereConnexion: u.dateDerniereConnexion,
    dateCreation: u.dateCreation,
  };
}

function formatDateFr(d: Date): string {
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

@Injectable()
export class UsersAdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(EmailLog)
    private readonly emailLogRepo: Repository<EmailLog>,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
    private readonly emailQueue: EmailQueueProducer,
  ) {}

  // ─── Création ──────────────────────────────────────────────

  async creer(dto: CreerUserDto, currentUser: AuthCaller): Promise<UserResponseDto> {
    // Email unique
    const existant = await this.userRepo.findOne({
      where: { email: dto.email },
    });
    if (existant) {
      throw new ConflictException(
        `L'email ${dto.email} est déjà utilisé par un autre compte.`,
      );
    }

    // Vérifier que tous les rôles existent et sont actifs
    const roles = await this.roleRepo.findByIds(dto.fkRoles);
    if (roles.length !== dto.fkRoles.length) {
      throw new BadRequestException(
        `Certains rôles demandés sont introuvables.`,
      );
    }
    for (const r of roles) {
      if (!r.estActif) {
        throw new BadRequestException(
          `Le rôle ${r.codeRole} est désactivé et ne peut pas être attribué.`,
        );
      }
    }

    const hash = await bcrypt.hash(dto.motDePasseInitial, BCRYPT_COST);

    return this.userRepo.manager.transaction(async (tx) => {
      const userRepo = tx.getRepository(User);
      const userRoleRepo = tx.getRepository(UserRole);

      const user = userRepo.create({
        email: dto.email,
        motDePasseHash: hash,
        nom: dto.nom,
        prenom: dto.prenom,
        estActif: true,
        utilisateurCreation: currentUser.email,
      });
      const saved = await userRepo.save(user);

      for (const role of roles) {
        const ur = userRoleRepo.create({
          fkUser: saved.id,
          fkRole: role.id,
          perimetreType: 'global',
          perimetreId: null,
          estActif: true,
          utilisateurCreation: currentUser.email,
        });
        await userRoleRepo.save(ur);
      }

      await this.auditService.log(
        {
          utilisateur: currentUser.email,
          typeAction: 'CREER_USER',
          entiteCible: 'user',
          idCible: String(saved.id),
          statut: 'success',
          payloadApres: {
            email: saved.email,
            nom: saved.nom,
            prenom: saved.prenom,
            roles: roles.map((r) => r.codeRole),
            // mot_de_passe_hash exclu (security)
          },
          commentaire: `Création du user ${saved.email} avec ${roles.length} rôle(s).`,
        },
        tx,
      );

      return toUserResponse(saved);
    });
  }

  // ─── Modification ──────────────────────────────────────────

  async modifier(
    id: string,
    dto: ModifierUserDto,
    currentUser: AuthCaller,
  ): Promise<UserResponseDto> {
    const u = await this.userRepo.findOne({ where: { id } });
    if (!u) throw new NotFoundException(`User ${id} introuvable.`);

    if (dto.email && dto.email !== u.email) {
      const conflict = await this.userRepo.findOne({
        where: { email: dto.email },
      });
      if (conflict && conflict.id !== id) {
        throw new ConflictException(
          `L'email ${dto.email} est déjà utilisé par un autre compte.`,
        );
      }
      u.email = dto.email;
    }
    if (dto.nom) u.nom = dto.nom;
    if (dto.prenom) u.prenom = dto.prenom;
    u.dateModification = new Date();
    u.utilisateurModification = currentUser.email;

    return this.userRepo.manager.transaction(async (tx) => {
      const saved = await tx.getRepository(User).save(u);
      await this.auditService.log(
        {
          utilisateur: currentUser.email,
          typeAction: 'MODIFIER_USER',
          entiteCible: 'user',
          idCible: String(saved.id),
          statut: 'success',
          payloadApres: { email: saved.email, nom: saved.nom, prenom: saved.prenom },
          commentaire: `Modification de ${saved.email}.`,
        },
        tx,
      );
      return toUserResponse(saved);
    });
  }

  // ─── Désactivation / réactivation ──────────────────────────

  async desactiver(id: string, currentUser: AuthCaller): Promise<UserResponseDto> {
    if (id === currentUser.userId) {
      throw new ForbiddenException(
        'Auto-désactivation interdite. Demandez à un autre administrateur.',
      );
    }
    const u = await this.userRepo.findOne({ where: { id } });
    if (!u) throw new NotFoundException(`User ${id} introuvable.`);
    if (!u.estActif) return toUserResponse(u);
    u.estActif = false;
    u.dateModification = new Date();
    u.utilisateurModification = currentUser.email;
    return this.userRepo.manager.transaction(async (tx) => {
      const saved = await tx.getRepository(User).save(u);
      await this.auditService.log(
        {
          utilisateur: currentUser.email,
          typeAction: 'DESACTIVER_USER',
          entiteCible: 'user',
          idCible: String(saved.id),
          statut: 'success',
          payloadApres: { email: saved.email, estActif: false },
          commentaire: `Désactivation du user ${saved.email}.`,
        },
        tx,
      );
      return toUserResponse(saved);
    });
  }

  async reactiver(id: string, currentUser: AuthCaller): Promise<UserResponseDto> {
    const u = await this.userRepo.findOne({ where: { id } });
    if (!u) throw new NotFoundException(`User ${id} introuvable.`);
    if (u.estActif) return toUserResponse(u);
    u.estActif = true;
    u.dateModification = new Date();
    u.utilisateurModification = currentUser.email;
    return this.userRepo.manager.transaction(async (tx) => {
      const saved = await tx.getRepository(User).save(u);
      await this.auditService.log(
        {
          utilisateur: currentUser.email,
          typeAction: 'REACTIVER_USER',
          entiteCible: 'user',
          idCible: String(saved.id),
          statut: 'success',
          payloadApres: { email: saved.email, estActif: true },
          commentaire: `Réactivation du user ${saved.email}.`,
        },
        tx,
      );
      return toUserResponse(saved);
    });
  }

  // ─── Reset password ────────────────────────────────────────

  /**
   * Lot 6.4.C — refactor pour async + email :
   *  1. Génère un mdp temporaire 32 chars conforme à la policy
   *     (≥1 maj/min/chiffre/spécial garantis).
   *  2. UPDATE user : nouveau hash + doitChangerMdp=true +
   *     dateExpirationMdp = now + 7 jours.
   *  3. Audit RESET_PASSWORD_USER (mot de passe en clair JAMAIS
   *     stocké en payload).
   *  4. INSERT email_log statut EN_ATTENTE — payload SANS le mdp en
   *     clair (juste raison + admin émetteur + date d'expiration).
   *  5. Publier le job BullMQ avec `secrets = { mdpTemporaire,
   *     dateExpiration }`. Les secrets transitent uniquement dans
   *     le job (Redis éphémère) et le mail SMTP. Au worker, ils sont
   *     fusionnés au moment du rendu Handlebars sans repasser par
   *     email_log.payload.
   *  6. Réponse API : `{ success, message }` — PAS le mdp.
   *
   * BREAKING CHANGE Lot 6.4.C : la réponse ne contient plus
   * `motDePasseTemporaire`. Le frontend Admin doit afficher un toast
   * "Email envoyé à <email>" au lieu d'afficher le mdp.
   *
   * Le job email est publié EN DEHORS de la transaction DB pour
   * éviter qu'un échec de commit ne laisse un job orphelin dans
   * Redis (côté inverse, si Redis tombe après le commit, l'email_log
   * reste EN_ATTENTE et peut être rejoué via /admin/email-log/:id/rejouer).
   */
  async resetPassword(
    id: string,
    currentUser: AuthCaller,
  ): Promise<ResetPasswordResponseDto> {
    const u = await this.userRepo.findOne({ where: { id } });
    if (!u) throw new NotFoundException(`User ${id} introuvable.`);

    const motDePasseTemporaire = genererMotDePasseTemporaire();
    const hash = await bcrypt.hash(motDePasseTemporaire, BCRYPT_COST);
    const dateExpirationMdp =
      this.authService.nouvelleDateExpiration(RESET_MDP_DUREE_JOURS);
    const dateExpirationFr = formatDateFr(dateExpirationMdp);

    u.motDePasseHash = hash;
    u.doitChangerMdp = true;
    u.dateExpirationMdp = dateExpirationMdp;
    u.dateModification = new Date();
    u.utilisateurModification = currentUser.email;

    let emailLogId: string | null = null;

    await this.userRepo.manager.transaction(async (tx) => {
      await tx.getRepository(User).save(u);
      await this.auditService.log(
        {
          utilisateur: currentUser.email,
          typeAction: 'RESET_PASSWORD_USER',
          entiteCible: 'user',
          idCible: String(u.id),
          statut: 'success',
          // SÉCURITÉ : le mot de passe en clair n'apparaît PAS dans
          // payloadApres ni nulle part ailleurs persisté.
          payloadApres: {
            email: u.email,
            longueurMotDePasseGenere: motDePasseTemporaire.length,
            dateExpiration: dateExpirationFr,
          },
          commentaire: `Reset password pour ${u.email} (mdp envoyé par email, doitChangerMdp=true).`,
        },
        tx,
      );

      // INSERT email_log statut EN_ATTENTE. Le payload NE contient
      // PAS le mdp — uniquement la raison + métadonnées non sensibles.
      const emailRepo = tx.getRepository(EmailLog);
      const log = emailRepo.create({
        evenement: 'RESET_PASSWORD_ADMIN',
        fkDestinataire: u.id,
        destinataireEmail: u.email,
        sujet: '[MIZNAS] Votre mot de passe a été réinitialisé',
        template: 'reset-password-admin',
        payload: {
          raison: 'reset_admin',
          adminEmail: currentUser.email,
          dateExpiration: dateExpirationFr,
        },
        statut: 'EN_ATTENTE',
        tentatives: 0,
      });
      const saved = await emailRepo.save(log);
      emailLogId = saved.id;
    });

    // Publication du job BullMQ HORS transaction : si la transaction
    // rollback, on ne publie pas un job orphelin. Si la publication
    // fail (Redis down), email_log reste EN_ATTENTE et peut être
    // republié manuellement via /admin/email-log/:id/rejouer.
    if (emailLogId !== null) {
      await this.emailQueue.publier(emailLogId, {
        mdpTemporaire: motDePasseTemporaire,
        dateExpiration: dateExpirationFr,
      });
    }

    return {
      success: true,
      message: `Email de réinitialisation envoyé à ${u.email}.`,
    };
  }

  // ─── Forcer déconnexion ────────────────────────────────────

  async forcerDeconnexion(
    id: string,
    currentUser: AuthCaller,
  ): Promise<{ revoquees: boolean }> {
    const u = await this.userRepo.findOne({ where: { id } });
    if (!u) throw new NotFoundException(`User ${id} introuvable.`);
    await this.authService.revokerTousTokensActifs(String(u.id), 'forced');
    await this.auditService.log({
      utilisateur: currentUser.email,
      typeAction: 'FORCER_DECONNEXION_USER',
      entiteCible: 'user',
      idCible: String(u.id),
      statut: 'success',
      payloadApres: { email: u.email },
      commentaire: `Forcer déconnexion de ${u.email} : tous les refresh tokens actifs révoqués.`,
    });
    return { revoquees: true };
  }

  // ─── Historique connexions ─────────────────────────────────

  async getHistoriqueConnexion(
    id: string,
  ): Promise<HistoriqueConnexionItemDto[]> {
    const u = await this.userRepo.findOne({ where: { id } });
    if (!u) throw new NotFoundException(`User ${id} introuvable.`);
    const rows = (await this.userRepo.manager.query<
      Array<{
        id: string;
        date_action: Date;
        type_action: string;
        statut: string;
        ip_source: string | null;
        user_agent: string | null;
      }>
    >(
      `SELECT id, date_action, type_action, statut, ip_source, user_agent
         FROM audit_log
        WHERE utilisateur = $1
          AND type_action IN ('LOGIN','LOGIN_FAILED','LOGOUT')
        ORDER BY id DESC
        LIMIT 50`,
      [u.email],
    )) ?? [];
    return rows.map((r) => ({
      id: String(r.id),
      dateAction: new Date(r.date_action).toISOString(),
      typeAction: r.type_action,
      statut: r.statut,
      ipSource: r.ip_source,
      userAgent: r.user_agent,
    }));
  }

  // ─── Rôles ─────────────────────────────────────────────────

  async listerRoles(id: string): Promise<UserRoleResumeDto[]> {
    const u = await this.userRepo.findOne({ where: { id } });
    if (!u) throw new NotFoundException(`User ${id} introuvable.`);
    const rows = await this.userRoleRepo.find({
      where: { fkUser: id, estActif: true },
      relations: { role: true },
    });
    return rows.map((ur) => ({
      id: String(ur.id),
      fkRole: String(ur.fkRole),
      codeRole: ur.role.codeRole,
      libelle: ur.role.libelle,
      estActif: ur.estActif,
      dateCreation: ur.dateCreation.toISOString(),
    }));
  }

  async attribuerRole(
    id: string,
    dto: AttribuerRoleDto,
    currentUser: AuthCaller,
  ): Promise<UserRoleResumeDto> {
    const u = await this.userRepo.findOne({ where: { id } });
    if (!u) throw new NotFoundException(`User ${id} introuvable.`);
    const role = await this.roleRepo.findOne({ where: { id: dto.fkRole } });
    if (!role) throw new BadRequestException(`Rôle ${dto.fkRole} introuvable.`);
    if (!role.estActif) {
      throw new BadRequestException(
        `Le rôle ${role.codeRole} est désactivé et ne peut pas être attribué.`,
      );
    }

    return this.userRepo.manager.transaction(async (tx) => {
      const urRepo = tx.getRepository(UserRole);
      // Idempotent : si une ligne existe déjà (active ou inactive), on
      // la (ré)active. Sinon on insère.
      let existing = await urRepo.findOne({
        where: { fkUser: id, fkRole: dto.fkRole },
      });
      if (existing) {
        if (!existing.estActif) {
          existing.estActif = true;
          existing.dateModification = new Date();
          existing.utilisateurModification = currentUser.email;
          existing = await urRepo.save(existing);
        }
      } else {
        existing = urRepo.create({
          fkUser: id,
          fkRole: dto.fkRole,
          perimetreType: 'global',
          perimetreId: null,
          estActif: true,
          utilisateurCreation: currentUser.email,
        });
        existing = await urRepo.save(existing);
      }

      await this.auditService.log(
        {
          utilisateur: currentUser.email,
          typeAction: 'ATTRIBUER_ROLE',
          entiteCible: 'bridge_user_role',
          idCible: String(existing.id),
          statut: 'success',
          payloadApres: {
            fkUser: id,
            fkRole: String(role.id),
            codeRole: role.codeRole,
            libelleRole: role.libelle,
            motif: dto.motif ?? null,
          },
          commentaire: `Attribution du rôle ${role.codeRole} au user ${u.email}.`,
        },
        tx,
      );

      return {
        id: String(existing.id),
        fkRole: String(existing.fkRole),
        codeRole: role.codeRole,
        libelle: role.libelle,
        estActif: existing.estActif,
        dateCreation: existing.dateCreation.toISOString(),
      };
    });
  }

  async retirerRole(
    id: string,
    fkRole: string,
    dto: MotifDto,
    currentUser: AuthCaller,
  ): Promise<{ retire: boolean }> {
    const u = await this.userRepo.findOne({ where: { id } });
    if (!u) throw new NotFoundException(`User ${id} introuvable.`);
    const ligne = await this.userRoleRepo.findOne({
      where: { fkUser: id, fkRole },
      relations: { role: true },
    });
    if (!ligne || !ligne.estActif) {
      throw new NotFoundException(
        `Affectation de rôle introuvable ou déjà inactive pour ce user.`,
      );
    }

    // Garde-fou : un user doit toujours avoir ≥ 1 rôle actif.
    const nbActifs = await this.userRoleRepo.count({
      where: { fkUser: id, estActif: true },
    });
    if (nbActifs <= 1) {
      throw new BadRequestException(
        'Un utilisateur doit toujours avoir au moins un rôle actif. ' +
          'Attribuez un autre rôle avant de retirer celui-ci.',
      );
    }

    return this.userRepo.manager.transaction(async (tx) => {
      const urRepo = tx.getRepository(UserRole);
      ligne.estActif = false;
      ligne.dateModification = new Date();
      ligne.utilisateurModification = currentUser.email;
      const saved = await urRepo.save(ligne);

      await this.auditService.log(
        {
          utilisateur: currentUser.email,
          typeAction: 'RETIRER_ROLE',
          entiteCible: 'bridge_user_role',
          idCible: String(saved.id),
          statut: 'success',
          payloadApres: {
            fkUser: id,
            fkRole: String(ligne.fkRole),
            codeRole: ligne.role.codeRole,
            libelleRole: ligne.role.libelle,
            motif: dto.motif ?? null,
          },
          commentaire: `Retrait du rôle ${ligne.role.codeRole} du user ${u.email}.`,
        },
        tx,
      );
      return { retire: true };
    });
  }
}
