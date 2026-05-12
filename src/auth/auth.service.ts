import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.entity';
import { MotifRevocation, RefreshToken } from './entities/refresh-token.entity';
import { validatePasswordPolicy } from './password-policy';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface PasswordFlags {
  mdpExpire: boolean;
  doitChangerMdp: boolean;
}

export interface LoginResult {
  tokens: IssuedTokens;
  user: User;
  mdpExpire: boolean;
  mdpExpireProchainement: boolean;
  doitChangerMdp: boolean;
}

const MS_PAR_JOUR = 86_400_000;

export interface CurrentUserRoleView {
  code: string;
  libelle: string;
  perimetreType: string | null;
  perimetreId: string | null;
}

export interface CurrentUserView {
  id: string;
  email: string;
  nom: string;
  prenom: string;
  roles: CurrentUserRoleView[];
  permissions: string[];
}

const DURATION_REGEX = /^(\d+)([smhd])$/;
const DURATION_MULTIPLIERS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function parseDurationMs(input: string): number {
  const match = DURATION_REGEX.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid duration: ${input}`);
  }
  const value = Number.parseInt(match[1], 10);
  return value * DURATION_MULTIPLIERS[match[2]];
}

@Injectable()
export class AuthService {
  private readonly accessExpiresInSeconds: number;
  private readonly refreshExpiresInMs: number;
  private readonly bcryptRounds: number;
  /** Lot 6.4.A — durée de validité d'un mdp standard (default 90 j). */
  readonly mdpDureeValiditeJours: number;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(RefreshToken)
    private readonly refreshRepo: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    config: ConfigService,
  ) {
    const accessDuration = config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
    const refreshDuration =
      config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    this.accessExpiresInSeconds = Math.floor(
      parseDurationMs(accessDuration) / 1000,
    );
    this.refreshExpiresInMs = parseDurationMs(refreshDuration);
    this.bcryptRounds = Number.parseInt(
      config.get<string>('BCRYPT_ROUNDS') ?? '12',
      10,
    );
    this.mdpDureeValiditeJours = Number.parseInt(
      config.get<string>('MDP_DUREE_VALIDITE_JOURS') ?? '90',
      10,
    );
  }

  /**
   * Calcule la date d'expiration future à partir d'un nombre de jours.
   * Default : `mdpDureeValiditeJours` (90 j). Utilisé par changerMdp,
   * resetPassword admin (palier C, durée 7j), creer user.
   */
  nouvelleDateExpiration(joursDuree?: number): Date {
    const jours = joursDuree ?? this.mdpDureeValiditeJours;
    return new Date(Date.now() + jours * MS_PAR_JOUR);
  }

  hashPassword(motDePasse: string): Promise<string> {
    return bcrypt.hash(motDePasse, this.bcryptRounds);
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async validateUser(email: string, motDePasse: string): Promise<User | null> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user || !user.estActif) {
      return null;
    }
    const ok = await bcrypt.compare(motDePasse, user.motDePasseHash);
    return ok ? user : null;
  }

  async login(
    email: string,
    motDePasse: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<LoginResult> {
    const user = await this.validateUser(email, motDePasse);
    if (!user) {
      await this.auditService.log({
        utilisateur: email || 'anonymous',
        ipSource: ip,
        userAgent,
        typeAction: 'LOGIN_FAILED',
        entiteCible: 'auth',
        statut: 'failure',
        commentaire: 'Email inconnu ou mot de passe invalide',
      });
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    user.dateDerniereConnexion = new Date();
    await this.userRepo.save(user);

    // Lot 6.4.A — calcul des flags d'état mot de passe.
    // `instanceof Date` couvre null + undefined (cas des mocks de
    // tests qui n'incluent pas la colonne) en une seule condition.
    const mdpExpire =
      user.dateExpirationMdp instanceof Date &&
      user.dateExpirationMdp.getTime() < Date.now();
    // Lot 6.7.1 — booléen J-7 mutuellement exclusif avec mdpExpire :
    // vrai si la date d'expiration est dans la fenêtre ]now, now+7j[.
    // Permet au frontend d'afficher un bandeau d'avertissement avant
    // le blocage effectif.
    const mdpExpireProchainement =
      user.dateExpirationMdp instanceof Date &&
      user.dateExpirationMdp.getTime() >= Date.now() &&
      user.dateExpirationMdp.getTime() < Date.now() + 7 * MS_PAR_JOUR;
    const doitChangerMdp = user.doitChangerMdp === true;

    const tokens = await this.issueTokens(user, ip, userAgent, {
      mdpExpire,
      doitChangerMdp,
    });

    await this.auditService.log({
      utilisateur: user.email,
      ipSource: ip,
      userAgent,
      typeAction: 'LOGIN',
      entiteCible: 'auth',
      idCible: user.id,
      statut: 'success',
      commentaire:
        mdpExpire || doitChangerMdp
          ? `Connexion avec flags mdpExpire=${String(mdpExpire)} doitChangerMdp=${String(doitChangerMdp)}`
          : null,
    });

    return { tokens, user, mdpExpire, mdpExpireProchainement, doitChangerMdp };
  }

  /**
   * Lot 6.4.A — Changement de mot de passe via PATCH /me/password.
   * Réutilisable pour le changement volontaire et le changement
   * forcé (mdp expiré ou doit_changer_mdp). Émet un nouveau couple
   * de tokens sans flags pour que le frontend remplace ses tokens
   * et débloque l'API.
   */
  async changerMdp(
    userId: string,
    ancienMdp: string,
    nouveauMdp: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<LoginResult> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !user.estActif) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    // 1. Vérifier l'ancien mdp.
    const ancienOk = await bcrypt.compare(ancienMdp, user.motDePasseHash);
    if (!ancienOk) {
      await this.auditService.log({
        utilisateur: user.email,
        ipSource: ip,
        userAgent,
        typeAction: 'PASSWORD_CHANGED',
        entiteCible: 'user',
        idCible: user.id,
        statut: 'failure',
        commentaire: 'Ancien mot de passe incorrect.',
      });
      throw new UnauthorizedException('Ancien mot de passe incorrect.');
    }

    // 2. Le nouveau doit être différent de l'ancien.
    if (ancienMdp === nouveauMdp) {
      throw new BadRequestException(
        "Le nouveau mot de passe doit être différent de l'ancien.",
      );
    }

    // 3. Politique partagée (défense en profondeur — le DTO valide
    // déjà via @MotDePasseValide(), mais on re-valide en service
    // pour les appels internes éventuels).
    const policy = validatePasswordPolicy(nouveauMdp);
    if (!policy.ok) {
      throw new BadRequestException(policy.erreurs.join(' '));
    }

    // 4. Hash + UPDATE.
    user.motDePasseHash = await bcrypt.hash(nouveauMdp, this.bcryptRounds);
    user.dateExpirationMdp = this.nouvelleDateExpiration();
    user.doitChangerMdp = false;
    user.dateModification = new Date();
    user.utilisateurModification = user.email;
    await this.userRepo.save(user);

    await this.auditService.log({
      utilisateur: user.email,
      ipSource: ip,
      userAgent,
      typeAction: 'PASSWORD_CHANGED',
      entiteCible: 'user',
      idCible: user.id,
      statut: 'success',
    });

    // 5. Émettre nouveaux tokens sans flags pour que le frontend
    // remplace ses tokens et débloque l'API.
    const tokens = await this.issueTokens(user, ip, userAgent, {
      mdpExpire: false,
      doitChangerMdp: false,
    });

    return {
      tokens,
      user,
      mdpExpire: false,
      mdpExpireProchainement: false,
      doitChangerMdp: false,
    };
  }

  async refresh(
    refreshTokenClear: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<IssuedTokens> {
    const tokenHash = this.hashRefreshToken(refreshTokenClear);
    const existing = await this.refreshRepo.findOne({ where: { tokenHash } });

    if (!existing) {
      throw new UnauthorizedException('Refresh invalide');
    }

    if (existing.dateRevocation !== null) {
      // Réutilisation d'un token déjà révoqué : compromission probable.
      // Tous les refresh actifs de l'utilisateur sont révoqués.
      await this.revokeAllActiveTokens(existing.fkUser, 'forced');
      await this.auditService.log({
        utilisateur: 'system',
        ipSource: ip,
        userAgent,
        typeAction: 'REFRESH_FORCED_REVOCATION',
        entiteCible: 'refresh_token',
        idCible: existing.id,
        statut: 'failure',
        commentaire: `Réutilisation d'un refresh déjà révoqué (motif initial=${
          existing.motifRevocation ?? 'unknown'
        }) — révocation forcée de tous les refresh actifs de l'utilisateur ${existing.fkUser}.`,
      });
      throw new UnauthorizedException('Refresh invalide');
    }

    if (existing.dateExpiration.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh expiré');
    }

    const user = await this.userRepo.findOne({
      where: { id: existing.fkUser },
    });
    if (!user || !user.estActif) {
      throw new UnauthorizedException('Refresh invalide');
    }

    // Rotation : ancien refresh révoqué, nouveau émis.
    existing.dateRevocation = new Date();
    existing.motifRevocation = 'rotation';
    await this.refreshRepo.save(existing);

    const tokens = await this.issueTokens(user, ip, userAgent);

    await this.auditService.log({
      utilisateur: user.email,
      ipSource: ip,
      userAgent,
      typeAction: 'REFRESH',
      entiteCible: 'auth',
      idCible: user.id,
      statut: 'success',
    });

    return tokens;
  }

  async logout(
    userId: string,
    email: string,
    refreshTokenClear: string | undefined,
    ip: string | null,
    userAgent: string | null,
  ): Promise<void> {
    if (refreshTokenClear) {
      const tokenHash = this.hashRefreshToken(refreshTokenClear);
      await this.refreshRepo.update(
        { fkUser: userId, tokenHash, dateRevocation: IsNull() },
        { dateRevocation: new Date(), motifRevocation: 'logout' },
      );
    } else {
      await this.revokeAllActiveTokens(userId, 'logout');
    }

    await this.auditService.log({
      utilisateur: email,
      ipSource: ip,
      userAgent,
      typeAction: 'LOGOUT',
      entiteCible: 'auth',
      idCible: userId,
      statut: 'success',
      commentaire: refreshTokenClear ? 'Logout ciblé.' : 'Logout global.',
    });
  }

  async getCurrentUser(userId: string): Promise<CurrentUserView> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !user.estActif) {
      throw new UnauthorizedException('Utilisateur invalide');
    }

    const userRoles = await this.userRoleRepo.find({
      where: { fkUser: userId, estActif: true },
      relations: { role: { rolePermissions: { permission: true } } },
    });

    const roles: CurrentUserRoleView[] = userRoles.map((ur) => ({
      code: ur.role.codeRole,
      libelle: ur.role.libelle,
      perimetreType: ur.perimetreType,
      perimetreId: ur.perimetreId,
    }));

    const permissions = [
      ...new Set(
        userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.codePermission),
        ),
      ),
    ].sort();

    return {
      id: user.id,
      email: user.email,
      nom: user.nom,
      prenom: user.prenom,
      roles,
      permissions,
    };
  }

  private async issueTokens(
    user: User,
    ip: string | null,
    userAgent: string | null,
    flags: PasswordFlags = { mdpExpire: false, doitChangerMdp: false },
  ): Promise<IssuedTokens> {
    const jti = randomUUID();
    const payload: Record<string, unknown> = {
      sub: user.id,
      email: user.email,
      jti,
    };
    // Lot 6.4.A — flags optionnels, omis si false pour limiter la
    // taille du JWT et garder compat descendante.
    if (flags.mdpExpire) payload.mdpExpire = true;
    if (flags.doitChangerMdp) payload.dcm = true;
    const accessToken = await this.jwtService.signAsync(payload);

    const refreshTokenClear = randomUUID();
    const tokenHash = this.hashRefreshToken(refreshTokenClear);

    const refreshEntity = this.refreshRepo.create({
      fkUser: user.id,
      tokenHash,
      dateExpiration: new Date(Date.now() + this.refreshExpiresInMs),
      ipEmission: ip,
      userAgent: userAgent ? userAgent.substring(0, 500) : null,
    });
    await this.refreshRepo.save(refreshEntity);

    return {
      accessToken,
      refreshToken: refreshTokenClear,
      expiresIn: this.accessExpiresInSeconds,
    };
  }

  private async revokeAllActiveTokens(
    userId: string,
    motif: MotifRevocation,
  ): Promise<void> {
    await this.refreshRepo.update(
      { fkUser: userId, dateRevocation: IsNull() },
      { dateRevocation: new Date(), motifRevocation: motif },
    );
  }

  /**
   * Wrapper public pour le Lot Administration — utilisé par
   * UsersAdminService.forcerDeconnexion.
   */
  async revokerTousTokensActifs(
    userId: string,
    motif: MotifRevocation = 'forced',
  ): Promise<void> {
    return this.revokeAllActiveTokens(userId, motif);
  }
}
