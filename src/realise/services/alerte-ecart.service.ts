/**
 * AlerteEcartService (Lot 8.5.E) — orchestre l'envoi d'alertes
 * mensuelles écarts budget vs réalisé.
 *
 * Pipeline :
 *  1. Résolution dynamique de la version (statut publie/gele,
 *     statut_publication ACTIVE, exercice fiscal du mois ciblé) et du
 *     scenario associé (via dim_version.fk_scenario_source ou fallback
 *     scenario type='central' sur l'exercice).
 *  2. Résolution du user « système » : admin@miznas.local. PerimetreService
 *     retourne null pour cet user (ADMIN) → AnalyseEcartsService voit
 *     l'intégralité du périmètre.
 *  3. Appel AnalyseEcartsService.getBudgetVsRealise() sur le seul mois
 *     M-1, sans restriction CR ni ligne_metier.
 *  4. Filtrage : ne garder que niveauAlerte IN ('ATTENTION','CRITIQUE').
 *     NORMAL et MANQUANT sont volontairement exclus (cf. décisions
 *     métier Lot 8.5.E).
 *  5. Résolution des destinataires : tous les users avec
 *     REALISE.VALIDER (NotificationsService.usersAvecPermission()
 *     délégué par NotificationsService.resoudreDestinataires('ALERTE_…')).
 *  6. Envoi : 1 appel notif.envoyer() par destinataire. Le payload
 *     contient les écarts pré-formatés (montants FCFA, pourcentages)
 *     pour que le template Handlebars n'ait aucune logique de format.
 *  7. Trace audit : 1 ligne audit_log par exécution
 *     (typeAction=ALERTE_ECART_REALISE_ENVOYEE, payload récap).
 *     1 ligne email_log par destinataire (créée par NotificationsService).
 *
 * Cas d'erreur :
 *  - admin@miznas.local introuvable → log ERROR + audit failure + return.
 *  - Aucune version publiée/gelée sur l'exercice → log WARN + audit
 *    « skipped » + return (pas de mail).
 *  - Aucun scenario résolu → idem.
 *  - 0 écart filtré → log INFO + audit « skipped (0 écart) » + return.
 *  - Exception non rattrapée pendant notif.envoyer() pour 1 destinataire
 *    → on continue les autres, on collecte les erreurs, audit final
 *    statut='failure' si au moins 1 échec, 'success' sinon.
 *
 * Pas de modification d'AnalyseEcartsService (cf. brief 8.5.E
 * § "Hors scope"). On accepte sa signature actuelle (versionId +
 * scenarioId + user) et on les résout en amont.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { AnalyseEcartsService } from '../../tableau-de-bord/services/analyse-ecarts.service';
import type { LigneEcartDto } from '../../tableau-de-bord/dto/tableau-bord.dto';

const ADMIN_EMAIL = 'admin@miznas.local';

const MOIS_LABELS_FR = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

export interface NotificationResult {
  /** YYYY-MM, mois M-1 analysé. */
  moisAnalyse: string;
  /** true si le cron a fait quelque chose (mail envoyé OU trace audit). */
  execute: boolean;
  /** Cause du skip si execute=false (`'no_version'`, `'no_scenario'`, …). */
  skipReason?: string;
  nbDestinataires: number;
  nbAttention: number;
  nbCritique: number;
  /** nb d'envois qui ont jeté (notif.envoyer) — utile pour debug. */
  nbErreursEnvoi: number;
}

interface VersionScenarioResolus {
  versionId: string;
  codeVersion: string;
  scenarioId: string;
  codeScenario: string;
}

interface EcartPayload {
  codeCompte: string;
  libelleCompte: string;
  codeCr: string;
  montantBudgetFormatte: string;
  montantRealiseFormatte: string;
  ecartPctFormatte: string;
}

@Injectable()
export class AlerteEcartService {
  private readonly logger = new Logger(AlerteEcartService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly analyseService: AnalyseEcartsService,
    private readonly notifService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Point d'entrée appelé par AlerteEcartCronService. Idempotent dans
   * le sens où ré-exécuter sur le même mois envoie un nouveau lot
   * d'emails (pas de garde anti-doublon DB — l'idempotence est portée
   * par le cron qui n'est planifié qu'une fois par mois).
   */
  async notifierEcarts(mois: string): Promise<NotificationResult> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mois)) {
      throw new Error(`Mois invalide '${mois}' (attendu YYYY-MM).`);
    }
    const start = Date.now();
    const moisLabel = this.formatMoisLabel(mois);

    // ─── 1. Résolution user admin ─────────────────────────────────
    const adminRows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM "user" WHERE email = $1 AND est_actif = true LIMIT 1`,
      [ADMIN_EMAIL],
    );
    if (adminRows.length === 0) {
      this.logger.error(
        `[AlerteEcart] User système '${ADMIN_EMAIL}' introuvable — alerte mensuelle abortée.`,
      );
      await this.auditService.log({
        utilisateur: 'system (cron 8.5.E)',
        typeAction: 'ALERTE_ECART_REALISE_ENVOYEE',
        entiteCible: 'fait_realise',
        idCible: mois,
        statut: 'failure',
        commentaire: `Admin '${ADMIN_EMAIL}' introuvable.`,
        payloadApres: { mois, raison: 'admin_introuvable' },
        dureeMs: Date.now() - start,
      });
      return {
        moisAnalyse: mois,
        execute: false,
        skipReason: 'admin_introuvable',
        nbDestinataires: 0,
        nbAttention: 0,
        nbCritique: 0,
        nbErreursEnvoi: 0,
      };
    }
    const adminId = String(adminRows[0].id);

    // ─── 2. Résolution version + scenario ─────────────────────────
    const annee = Number(mois.slice(0, 4));
    const vs = await this.resoudreVersionScenario(annee);
    if (!vs) {
      this.logger.warn(
        `[AlerteEcart] Aucune version/scenario publié(e) sur exercice ${String(annee)} — alerte ${mois} skip.`,
      );
      await this.auditService.log({
        utilisateur: 'system (cron 8.5.E)',
        typeAction: 'ALERTE_ECART_REALISE_ENVOYEE',
        entiteCible: 'fait_realise',
        idCible: mois,
        statut: 'success',
        commentaire: `Skip : aucune version publiée/gelée sur exercice ${String(annee)}.`,
        payloadApres: { mois, raison: 'no_version_scenario', annee },
        dureeMs: Date.now() - start,
      });
      return {
        moisAnalyse: mois,
        execute: false,
        skipReason: 'no_version_scenario',
        nbDestinataires: 0,
        nbAttention: 0,
        nbCritique: 0,
        nbErreursEnvoi: 0,
      };
    }

    // ─── 3. Appel AnalyseEcartsService (admin = pas de filtre CR) ─
    const reponse = await this.analyseService.getBudgetVsRealise(
      {
        versionId: vs.versionId,
        scenarioId: vs.scenarioId,
        moisDebut: mois,
        moisFin: mois,
      },
      { userId: adminId, email: ADMIN_EMAIL },
    );

    // ─── 4. Filtrage ATTENTION + CRITIQUE ─────────────────────────
    const attentions = reponse.lignes.filter(
      (l) => l.niveauAlerte === 'ATTENTION',
    );
    const critiques = reponse.lignes.filter(
      (l) => l.niveauAlerte === 'CRITIQUE',
    );
    const nbAttention = attentions.length;
    const nbCritique = critiques.length;

    if (nbAttention === 0 && nbCritique === 0) {
      this.logger.log(
        `[AlerteEcart] ${mois} : 0 écart ATTENTION/CRITIQUE — aucun mail envoyé.`,
      );
      await this.auditService.log({
        utilisateur: 'system (cron 8.5.E)',
        typeAction: 'ALERTE_ECART_REALISE_ENVOYEE',
        entiteCible: 'fait_realise',
        idCible: mois,
        statut: 'success',
        commentaire: `Skip : 0 écart ATTENTION/CRITIQUE sur ${mois}.`,
        payloadApres: {
          mois,
          raison: 'no_ecart',
          codeVersion: vs.codeVersion,
          codeScenario: vs.codeScenario,
          totalLignesAnalysees: reponse.lignes.length,
        },
        dureeMs: Date.now() - start,
      });
      return {
        moisAnalyse: mois,
        execute: false,
        skipReason: 'no_ecart',
        nbDestinataires: 0,
        nbAttention: 0,
        nbCritique: 0,
        nbErreursEnvoi: 0,
      };
    }

    // ─── 5. Résolution destinataires REALISE.VALIDER ──────────────
    const destinataires = await this.notifService.resoudreDestinataires(
      'ALERTE_ECART_REALISE',
      {},
    );
    if (destinataires.length === 0) {
      this.logger.warn(
        `[AlerteEcart] ${mois} : ${String(nbAttention + nbCritique)} écart(s) détecté(s) ` +
          `mais 0 destinataire avec REALISE.VALIDER. Aucun mail envoyé.`,
      );
      await this.auditService.log({
        utilisateur: 'system (cron 8.5.E)',
        typeAction: 'ALERTE_ECART_REALISE_ENVOYEE',
        entiteCible: 'fait_realise',
        idCible: mois,
        statut: 'success',
        commentaire: `Skip : aucun destinataire REALISE.VALIDER (${String(nbAttention + nbCritique)} écart(s) ignoré(s)).`,
        payloadApres: {
          mois,
          raison: 'no_destinataire',
          nbAttention,
          nbCritique,
        },
        dureeMs: Date.now() - start,
      });
      return {
        moisAnalyse: mois,
        execute: false,
        skipReason: 'no_destinataire',
        nbDestinataires: 0,
        nbAttention,
        nbCritique,
        nbErreursEnvoi: 0,
      };
    }

    // ─── 6. Pré-formatage payload (templates n'ont pas de helpers) ─
    const payload = {
      mois,
      moisLabel,
      codeVersion: vs.codeVersion,
      codeScenario: vs.codeScenario,
      nbAttention,
      nbCritique,
      nbEcarts: nbAttention + nbCritique,
      attentions: attentions.map((l) => this.toEcartPayload(l)),
      critiques: critiques.map((l) => this.toEcartPayload(l)),
    };

    // ─── 7. Envoi : 1 publish queue par destinataire ──────────────
    let nbErreursEnvoi = 0;
    const destinataireIds: string[] = [];
    for (const dest of destinataires) {
      destinataireIds.push(String(dest.id));
      try {
        await this.notifService.envoyer('ALERTE_ECART_REALISE', dest, payload);
      } catch (err) {
        nbErreursEnvoi++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[AlerteEcart] Échec envoi à ${dest.email} : ${msg}`);
      }
    }

    // ─── 8. Audit récapitulatif ───────────────────────────────────
    const auditStatut = nbErreursEnvoi === 0 ? 'success' : 'failure';
    await this.auditService.log({
      utilisateur: 'system (cron 8.5.E)',
      typeAction: 'ALERTE_ECART_REALISE_ENVOYEE',
      entiteCible: 'fait_realise',
      idCible: mois,
      statut: auditStatut,
      commentaire:
        `Alerte ${mois} : ${String(nbCritique)} CRITIQUE + ${String(nbAttention)} ATTENTION ` +
        `envoyée(s) à ${String(destinataires.length)} destinataire(s)` +
        (nbErreursEnvoi > 0
          ? `, ${String(nbErreursEnvoi)} échec(s) d'envoi.`
          : '.'),
      payloadApres: {
        mois,
        codeVersion: vs.codeVersion,
        codeScenario: vs.codeScenario,
        nbDestinataires: destinataires.length,
        nbAttention,
        nbCritique,
        nbErreursEnvoi,
        destinataireIds,
      },
      dureeMs: Date.now() - start,
    });

    this.logger.log(
      `[AlerteEcart] ${mois} : ${String(nbCritique)} CRITIQUE + ${String(nbAttention)} ATTENTION ` +
        `→ ${String(destinataires.length)} destinataire(s) (${String(nbErreursEnvoi)} échec).`,
    );

    return {
      moisAnalyse: mois,
      execute: true,
      nbDestinataires: destinataires.length,
      nbAttention,
      nbCritique,
      nbErreursEnvoi,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private async resoudreVersionScenario(
    annee: number,
  ): Promise<VersionScenarioResolus | null> {
    // Version la plus récente sur l'exercice donné, statut « publie »
    // ou « gele », publication ACTIVE (exclut les versions remplacées).
    const versionRows = await this.dataSource.query<
      Array<{
        id: string;
        code_version: string;
        fk_scenario_source: string | null;
      }>
    >(
      `SELECT id, code_version, fk_scenario_source
       FROM dim_version
       WHERE exercice_fiscal = $1
         AND statut IN ('publie','gele')
         AND statut_publication = 'ACTIVE'
       ORDER BY date_gel DESC NULLS LAST, id DESC
       LIMIT 1`,
      [annee],
    );
    if (versionRows.length === 0) return null;
    const versionRow = versionRows[0];
    const versionId = String(versionRow.id);
    const codeVersion = versionRow.code_version;

    // Tentative 1 : scenario explicitement référencé par la version.
    if (versionRow.fk_scenario_source !== null) {
      const sRows = await this.dataSource.query<
        Array<{ id: string; code_scenario: string }>
      >(`SELECT id, code_scenario FROM dim_scenario WHERE id = $1 LIMIT 1`, [
        versionRow.fk_scenario_source,
      ]);
      if (sRows.length > 0) {
        const s = sRows[0];
        return {
          versionId,
          codeVersion,
          scenarioId: String(s.id),
          codeScenario: s.code_scenario,
        };
      }
    }

    // Tentative 2 : scenario type='central' actif sur l'exercice.
    const centralRows = await this.dataSource.query<
      Array<{ id: string; code_scenario: string }>
    >(
      `SELECT id, code_scenario FROM dim_scenario
       WHERE exercice_fiscal = $1
         AND type_scenario = 'central'
         AND statut = 'actif'
       ORDER BY id ASC LIMIT 1`,
      [annee],
    );
    if (centralRows.length === 0) return null;
    const c = centralRows[0];
    return {
      versionId,
      codeVersion,
      scenarioId: String(c.id),
      codeScenario: c.code_scenario,
    };
  }

  private toEcartPayload(l: LigneEcartDto): EcartPayload {
    return {
      codeCompte: l.codeCompte,
      libelleCompte: l.libelleCompte,
      codeCr: l.codeCr,
      montantBudgetFormatte: this.formatFcfa(l.montantBudget),
      montantRealiseFormatte:
        l.montantRealise === null ? '—' : this.formatFcfa(l.montantRealise),
      ecartPctFormatte:
        l.ecartPct === null
          ? '—'
          : `${l.ecartPct > 0 ? '+' : ''}${l.ecartPct.toFixed(1)} %`,
    };
  }

  private formatFcfa(montant: number): string {
    return `${new Intl.NumberFormat('fr-FR', {
      maximumFractionDigits: 0,
    }).format(montant)} F CFA`;
  }

  private formatMoisLabel(mois: string): string {
    const moisNum = Number(mois.slice(5, 7));
    const annee = mois.slice(0, 4);
    const label = MOIS_LABELS_FR[moisNum - 1] ?? `Mois ${String(moisNum)}`;
    return `${label} ${annee}`;
  }
}
