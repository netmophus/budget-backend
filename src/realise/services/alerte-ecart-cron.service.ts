/**
 * AlerteEcartCronService (Lot 8.5.E) — cron mensuel le 5 à 06:00
 * (heure serveur) qui appelle `AlerteEcartService.notifierEcarts()`
 * pour le mois précédent (M-1).
 *
 * Pattern aligné sur DelegationsRappelCronService (Lot 6.5.B),
 * PasswordResetCleanupCronService (Lot 6.5.A) et DelegationsCronService
 * (Lot 4.2) :
 *  - @Injectable() implements OnApplicationBootstrap
 *  - 1 méthode @Cron qui délègue à un service métier
 *  - try/catch global, jamais re-throw (pas de crash process)
 *
 * Différence vs les autres crons : **pas de rattrapage au démarrage**.
 * Sinon en dev, chaque restart du serveur déclencherait l'envoi
 * d'alertes — comportement indésirable et non idempotent au mois.
 * Le rattrapage est explicitement désactivé dans
 * onApplicationBootstrap() (log INFO seulement). En cas de loupé
 * (cron qui n'a pas tourné à cause d'un downtime à 06:00 le 5), un
 * appel manuel via REPL Node ou un endpoint admin futur (Lot 8.5.E
 * v2) sera nécessaire.
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { AlerteEcartService } from './alerte-ecart.service';

@Injectable()
export class AlerteEcartCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AlerteEcartCronService.name);

  constructor(private readonly alerteService: AlerteEcartService) {}

  /**
   * Pas de rattrapage : log uniquement l'enregistrement du cron.
   * Le `next run` n'est pas accessible directement via @nestjs/schedule
   * sans SchedulerRegistry — log statique pour ne pas couper le boot.
   */
  onApplicationBootstrap(): void {
    this.logger.log(
      "CRON 'alerte-ecart-realise-mensuelle' enregistré (planifié : 5 du mois à 06:00, heure serveur). " +
        'Pas de rattrapage au démarrage.',
    );
  }

  /** Cron mensuel : le 5 de chaque mois à 06:00. */
  @Cron('0 6 5 * *', { name: 'alerte-ecart-realise-mensuelle' })
  async alerteMensuelle(): Promise<void> {
    const mois = this.calculerMoisPrecedent(new Date());
    try {
      const r = await this.alerteService.notifierEcarts(mois);
      if (r.execute) {
        this.logger.log(
          `[Cron] Alerte ${mois} envoyée : ${String(r.nbCritique)} CRITIQUE + ${String(r.nbAttention)} ATTENTION ` +
            `→ ${String(r.nbDestinataires)} destinataire(s) (${String(r.nbErreursEnvoi)} échec).`,
        );
      } else {
        this.logger.log(
          `[Cron] Alerte ${mois} non envoyée (raison: ${r.skipReason ?? 'inconnue'}).`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Cron] Échec alerte ${mois} : ${message}`);
    }
  }

  /**
   * Mois précédent à la date donnée, format YYYY-MM. Factorisé pour
   * permettre les tests (injection d'une date arbitraire).
   *
   * Exemple : 2026-06-05 → '2026-05'. 2026-01-05 → '2025-12'.
   */
  calculerMoisPrecedent(maintenant: Date): string {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - 1, 1);
    const annee = d.getFullYear();
    const moisNum = d.getMonth() + 1;
    return `${String(annee)}-${String(moisNum).padStart(2, '0')}`;
  }
}
