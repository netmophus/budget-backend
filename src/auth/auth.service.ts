import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.entity';
import {
  MotifRevocation,
  RefreshToken,
} from './entities/refresh-token.entity';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

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
    this.accessExpiresInSeconds = Math.floor(parseDurationMs(accessDuration) / 1000);
    this.refreshExpiresInMs = parseDurationMs(refreshDuration);
    this.bcryptRounds = Number.parseInt(
      config.get<string>('BCRYPT_ROUNDS') ?? '12',
      10,
    );
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
  ): Promise<{ tokens: IssuedTokens; user: User }> {
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
    const tokens = await this.issueTokens(user, ip, userAgent);

    await this.auditService.log({
      utilisateur: user.email,
      ipSource: ip,
      userAgent,
      typeAction: 'LOGIN',
      entiteCible: 'auth',
      idCible: user.id,
      statut: 'success',
    });

    return { tokens, user };
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
  ): Promise<IssuedTokens> {
    const jti = randomUUID();
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      jti,
    });

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
