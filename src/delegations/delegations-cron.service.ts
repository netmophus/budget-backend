/**
 * DelegationsCronService (Lot 4.2.A) — orchestre l'expiration
 * automatique quotidienne des délégations.
 *
 * Cron `0 2 * * *` (2h du matin chaque jour). Au démarrage de
 * l'application, on déclenche aussi un rattrapage immédiat via
 * OnApplicationBootstrap (au cas où l'app est restée down et a
 * raté plusieurs nuits).
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { DelegationsService } from './delegations.service';

@Injectable()
export class DelegationsCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DelegationsCronService.name);

  constructor(private readonly delegationsService: DelegationsService) {}

  /** Rattrapage au démarrage. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const r = await this.delegationsService.expirerAutomatiquement();
      if (r.nbExpirees > 0) {
        this.logger.log(
          `[Bootstrap] ${r.nbExpirees} délégation(s) expirée(s) au démarrage.`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[Bootstrap] Échec expiration auto au boot : ${(err as Error).message}`,
      );
    }
  }

  /** Cron quotidien à 2h du matin. */
  @Cron('0 2 * * *', { name: 'delegations-expiration' })
  async expirerQuotidien(): Promise<void> {
    try {
      const r = await this.delegationsService.expirerAutomatiquement();
      if (r.nbExpirees > 0) {
        this.logger.log(
          `[Cron] ${r.nbExpirees} délégation(s) expirée(s).`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[Cron] Échec expiration auto : ${(err as Error).message}`,
      );
    }
  }
}
