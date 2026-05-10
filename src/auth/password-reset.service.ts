/**
 * PasswordResetService (Lot 6.5.A) — orchestration du flux forgot
 * password self-service.
 *
 * Flux :
 *  - `demanderReset(email, ip, ua)` : POST /auth/forgot-password.
 *    - Si email → user actif : génère un UUID v4 (token clair),
 *      stocke le hash SHA-256 + expiration 30 min, INSERT
 *      email_log SANS le token clair, publie le job BullMQ avec
 *      `secrets={ token, lien_reset, expiration_minutes }` (transit
 *      éphémère via Redis), audit `DEMANDE_RESET_MDP_USER`.
 *    - Sinon : audit `DEMANDE_RESET_MDP_INCONNU`, AUCUNE INSERT,
 *      AUCUNE publication queue. Réponse identique au cas connu
 *      (anti-énumération).
 *  - `executerReset(token, nouveauMdp, ip, ua)` :
 *    POST /auth/reset-password. Hash le token reçu, cherche un
 *    token non utilisé non expiré, applique la nouvelle policy mdp,
 *    UPDATE user (mot_de_passe_hash, doit_changer_mdp=false,
 *    date_expiration_mdp=now+90j), marque le token utilisé, audit
 *    `RESET_MDP_USER_VALIDE`. NE re-émet PAS de tokens JWT — le user
 *    doit faire un login normal après.
 *  - `nettoyerTokensExpires()` : DELETE password_reset_token WHERE
 *    date_expiration < now() - 30 jours. Audit
 *    `NETTOYAGE_RESET_TOKENS` avec count.
 *
 * Sécurité — invariants :
 *  - Token clair JAMAIS persisté en base (seul le hash SHA-256).
 *  - Token clair JAMAIS dans email_log.payload ni audit_log
 *    (transit unique via Redis BullMQ).
 *  - Réponse forgot-password identique pour email connu/inconnu.
 *  - Token usable une seule fois (utilise=true après reset).
 */
import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import { LessThan, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { EmailLog } from '../notifications/entities/email-log.entity';
import { EmailQueueProducer } from '../notifications/email-queue.producer';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { validatePasswordPolicy } from './password-policy';

const TOKEN_DUREE_MINUTES = 30;
const TOKEN_RETENTION_JOURS = 30;
const BCRYPT_ROUNDS = 12;

export interface ForgotPasswordResult {
  success: true;
  message: string;
}

export interface ResetPasswordResult {
  success: true;
  message: string;
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly appBaseUrl: string;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(PasswordResetToken)
    private readonly tokenRepo: Repository<PasswordResetToken>,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
    private readonly emailQueue: EmailQueueProducer,
    config: ConfigService,
  ) {
    this.appBaseUrl =
      config.get<string>('APP_BASE_URL') ?? 'http://localhost:5173';
  }

  /** Hash SHA-256 hex (64 caractères) — utilisé pour stocker le token. */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Réponse uniformisée pour forgot-password (anti-énumération).
   * Même message exact pour email connu et inconnu.
   */
  private reponseUniformeForgot(): ForgotPasswordResult {
    return {
      success: true,
      message:
        "Si l'email existe, un lien de réinitialisation a été envoyé.",
    };
  }

  /**
   * POST /auth/forgot-password — branche unique.
   *
   * Le code prend deux chemins selon que l'email correspond à un user
   * actif ou non, mais retourne le MÊME objet réponse dans les 2 cas
   * (sécurité anti-énumération).
   */
  async demanderReset(
    email: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<ForgotPasswordResult> {
    const cleEmail = email.trim().toLowerCase();
    const user = await this.userRepo.findOne({ where: { email: cleEmail } });

    if (!user || !user.estActif) {
      // Cas inconnu : audit + réponse uniforme. AUCUNE I/O DB
      // mutante, AUCUN email publié.
      await this.auditService.log({
        utilisateur: cleEmail || 'anonymous',
        ipSource: ip,
        userAgent,
        typeAction: 'DEMANDE_RESET_MDP_INCONNU',
        entiteCible: 'auth',
        statut: 'failure',
        commentaire: !user
          ? 'Email inconnu (forgot-password).'
          : 'Compte inactif (forgot-password).',
      });
      return this.reponseUniformeForgot();
    }

    // Cas connu : génération token + INSERT + publication queue.
    const tokenClair = randomUUID();
    const tokenHash = this.hashToken(tokenClair);
    const dateExpiration = new Date(
      Date.now() + TOKEN_DUREE_MINUTES * 60_000,
    );
    const lienReset = `${this.appBaseUrl}/reset-password?token=${tokenClair}`;

    let emailLogId: string | null = null;

    await this.userRepo.manager.transaction(async (tx) => {
      const tokenRepo = tx.getRepository(PasswordResetToken);
      const t = tokenRepo.create({
        fkUser: user.id,
        token: tokenHash,
        dateExpiration,
        utilise: false,
        utilisateurCreation: 'forgot-password',
      });
      await tokenRepo.save(t);

      const emailRepo = tx.getRepository(EmailLog);
      const log = emailRepo.create({
        evenement: 'RESET_PASSWORD_SELF_SERVICE',
        fkDestinataire: user.id,
        destinataireEmail: user.email,
        sujet: '[MIZNAS] Réinitialisation de votre mot de passe',
        template: 'reset-password-self-service',
        // SÉCURITÉ : payload SANS le token clair ni le lien complet
        // (qui contient le token). Seulement la durée d'expiration
        // pour le rendu UI.
        payload: {
          raison: 'forgot_password_self_service',
          expiration_minutes: TOKEN_DUREE_MINUTES,
        },
        statut: 'EN_ATTENTE',
        tentatives: 0,
      });
      const saved = await emailRepo.save(log);
      emailLogId = saved.id;

      await this.auditService.log(
        {
          utilisateur: user.email,
          ipSource: ip,
          userAgent,
          typeAction: 'DEMANDE_RESET_MDP_USER',
          entiteCible: 'user',
          idCible: String(user.id),
          statut: 'success',
          // SÉCURITÉ : pas de token clair en payload audit non plus.
          payloadApres: {
            email: user.email,
            expiration_minutes: TOKEN_DUREE_MINUTES,
          },
          commentaire: `Lien de réinitialisation généré (validité ${String(TOKEN_DUREE_MINUTES)} min).`,
        },
        tx,
      );
    });

    // Publication HORS transaction (cf. pattern Lot 6.4.C). Si
    // Redis tombe, email_log reste EN_ATTENTE et peut être rejoué
    // via /admin/email-log/:id/rejouer.
    if (emailLogId !== null) {
      await this.emailQueue.publier(emailLogId, {
        token: tokenClair,
        lien_reset: lienReset,
        expiration_minutes: String(TOKEN_DUREE_MINUTES),
      });
    }

    return this.reponseUniformeForgot();
  }

  /**
   * POST /auth/reset-password — valide le token + applique le nouveau
   * mdp. NE RE-ÉMET PAS de tokens JWT : le user doit faire un login
   * normal après pour récupérer son access/refresh token.
   */
  async executerReset(
    tokenClair: string,
    nouveauMdp: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<ResetPasswordResult> {
    const tokenHash = this.hashToken(tokenClair);
    const t = await this.tokenRepo.findOne({
      where: { token: tokenHash },
      relations: ['user'],
    });

    // Cas 1 : token inexistant ou déjà utilisé → 400 INVALID_TOKEN.
    if (!t || t.utilise) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_TOKEN',
        message:
          'Lien de réinitialisation invalide ou déjà utilisé. Refaites une demande.',
      });
    }

    // Cas 2 : token expiré → 410 EXPIRED_TOKEN.
    if (t.dateExpiration.getTime() < Date.now()) {
      throw new GoneException({
        statusCode: 410,
        code: 'EXPIRED_TOKEN',
        message:
          'Lien de réinitialisation expiré. Refaites une demande.',
      });
    }

    // Cas 3 : policy mdp non respectée — défense en profondeur (le
    // DTO @MotDePasseValide() bloque déjà mais on revérifie ici).
    const policy = validatePasswordPolicy(nouveauMdp);
    if (!policy.ok) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'PASSWORD_POLICY',
        message: policy.erreurs.join(' '),
      });
    }

    const user = t.user;
    const nouveauHash = await bcrypt.hash(nouveauMdp, BCRYPT_ROUNDS);

    await this.userRepo.manager.transaction(async (tx) => {
      const userRepo = tx.getRepository(User);
      user.motDePasseHash = nouveauHash;
      user.doitChangerMdp = false;
      user.dateExpirationMdp = this.authService.nouvelleDateExpiration();
      user.dateModification = new Date();
      user.utilisateurModification = 'reset-password-self-service';
      await userRepo.save(user);

      const tokenRepo = tx.getRepository(PasswordResetToken);
      t.utilise = true;
      t.dateModification = new Date();
      t.utilisateurModification = 'reset-password-self-service';
      await tokenRepo.save(t);

      await this.auditService.log(
        {
          utilisateur: user.email,
          ipSource: ip,
          userAgent,
          typeAction: 'RESET_MDP_USER_VALIDE',
          entiteCible: 'user',
          idCible: String(user.id),
          statut: 'success',
          commentaire:
            'Mot de passe réinitialisé via lien email self-service.',
        },
        tx,
      );
    });

    return {
      success: true,
      message:
        'Mot de passe changé avec succès. Vous pouvez maintenant vous connecter.',
    };
  }

  /**
   * Cron `0 3 * * *` — supprime les tokens dont date_expiration est
   * antérieure à `now() - 30 jours`. Garde les tokens récents pour
   * audit / forensics. Audit `NETTOYAGE_RESET_TOKENS` avec count.
   */
  async nettoyerTokensExpires(): Promise<{ supprimes: number }> {
    const seuil = new Date(
      Date.now() - TOKEN_RETENTION_JOURS * 86_400_000,
    );
    const r = await this.tokenRepo.delete({ dateExpiration: LessThan(seuil) });
    const supprimes = r.affected ?? 0;

    if (supprimes > 0) {
      await this.auditService.log({
        utilisateur: 'system (cron)',
        typeAction: 'NETTOYAGE_RESET_TOKENS',
        entiteCible: 'password_reset_token',
        statut: 'success',
        commentaire: `Cron quotidien : ${String(supprimes)} token(s) supprimé(s) (date_expiration < now() - ${String(TOKEN_RETENTION_JOURS)} jours).`,
        payloadApres: {
          supprimes,
          seuilJours: TOKEN_RETENTION_JOURS,
        },
      });
      this.logger.log(`[Cron] ${String(supprimes)} reset token(s) purgé(s).`);
    }

    return { supprimes };
  }
}
