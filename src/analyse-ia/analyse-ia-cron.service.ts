/**
 * AnalyseIaCronService (Chantier C1) — purge quotidienne à 03:00 des
 * analyses IA de plus de 24 mois (rétention 2 exercices). Pattern aligné
 * sur AlerteEcartCronService : @Cron qui délègue au service, try/catch
 * global (jamais de re-throw), pas de rattrapage au démarrage.
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { AnalyseIaService } from './analyse-ia.service';

@Injectable()
export class AnalyseIaCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AnalyseIaCronService.name);

  constructor(private readonly service: AnalyseIaService) {}

  onApplicationBootstrap(): void {
    this.logger.log(
      "CRON 'purge-analyses-ia' enregistré (quotidien à 03:00, rétention 24 mois).",
    );
  }

  @Cron('0 3 * * *', { name: 'purge-analyses-ia' })
  async purgeQuotidienne(): Promise<void> {
    try {
      const n = await this.service.purgerAnciennes();
      if (n > 0) {
        this.logger.log(
          `[Cron] Purge analyses IA : ${String(n)} supprimée(s).`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Cron] Échec purge analyses IA : ${msg}`);
    }
  }
}
