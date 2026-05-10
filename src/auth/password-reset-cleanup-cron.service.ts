/**
 * PasswordResetCleanupCronService (Lot 6.5.A) — purge quotidienne
 * des tokens de reset password expirés depuis plus de 30 jours.
 *
 * Pourquoi un cron : on ne supprime pas immédiatement après l'usage
 * (pour audit/forensics — un token utilisé reste en base avec
 * `utilise=true`). Le cron de nettoyage retire les tokens dont
 * `date_expiration < now() - 30 jours` quel que soit leur statut.
 *
 * Cron `0 3 * * *` (3h du matin chaque jour). Au démarrage de
 * l'application, on déclenche aussi un rattrapage immédiat via
 * OnApplicationBootstrap (au cas où l'app est restée down et a
 * raté plusieurs nuits) — pattern aligné sur DelegationsCronService.
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PasswordResetService } from './password-reset.service';

@Injectable()
export class PasswordResetCleanupCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PasswordResetCleanupCronService.name);

  constructor(private readonly passwordResetService: PasswordResetService) {}

  /** Rattrapage au démarrage. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const r = await this.passwordResetService.nettoyerTokensExpires();
      if (r.supprimes > 0) {
        this.logger.log(
          `[Bootstrap] ${String(r.supprimes)} reset token(s) purgé(s) au démarrage.`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[Bootstrap] Échec nettoyage tokens : ${(err as Error).message}`,
      );
    }
  }

  /** Cron quotidien à 3h du matin. */
  @Cron('0 3 * * *', { name: 'password-reset-cleanup' })
  async nettoyerQuotidien(): Promise<void> {
    try {
      await this.passwordResetService.nettoyerTokensExpires();
    } catch (err) {
      this.logger.error(
        `[Cron] Échec nettoyage tokens : ${(err as Error).message}`,
      );
    }
  }
}
