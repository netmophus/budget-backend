/**
 * DelegationsRappelCronService (Lot 6.5.B) — cron quotidien à 06:00
 * (heure d'Abidjan, toutes les agences sont éveillées) qui appelle
 * `DelegationsRappelService.notifierJ3()`.
 *
 * Au démarrage de l'application, on déclenche aussi un rattrapage
 * immédiat via OnApplicationBootstrap — pattern aligné sur
 * DelegationsCronService (expiration auto) et
 * PasswordResetCleanupCronService (Lot 6.5.A). L'idempotence est
 * garantie par `delegations.derniere_notification_j3 IS NULL` côté
 * service, donc le bootstrap ne re-notifiera pas si le cron de la
 * nuit précédente est déjà passé.
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { DelegationsRappelService } from './delegations-rappel.service';

@Injectable()
export class DelegationsRappelCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DelegationsRappelCronService.name);

  constructor(private readonly rappelService: DelegationsRappelService) {}

  /** Rattrapage au démarrage. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const r = await this.rappelService.notifierJ3();
      if (r.notifiees > 0) {
        this.logger.log(
          `[Bootstrap] ${String(r.notifiees)} rappel(s) J-3 envoyé(s) au démarrage.`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[Bootstrap] Échec rappel J-3 : ${(err as Error).message}`,
      );
    }
  }

  /** Cron quotidien à 6h du matin (heure serveur). */
  @Cron('0 6 * * *', { name: 'delegations-rappel-j3' })
  async rappelQuotidien(): Promise<void> {
    try {
      await this.rappelService.notifierJ3();
    } catch (err) {
      this.logger.error(
        `[Cron] Échec rappel J-3 : ${(err as Error).message}`,
      );
    }
  }
}
