/**
 * AnalyseEcartsService (Lot 5.2.A) — agrégation SQL budget vs
 * réalisé.
 *
 * Stratégie performance :
 *  - 1 seul LEFT JOIN entre fait_budget (côté gauche, source de
 *    vérité) et fait_realise (côté droit, statut=VALIDE only).
 *    Les lignes budget sans réalisé apparaissent en MANQUANT.
 *  - Jointure dim_compte pour récupérer la classe (calcul
 *    nature/sens en SQL plutôt qu'en mémoire Node).
 *  - Jointure dim_centre_responsabilite, dim_ligne_metier,
 *    dim_temps pour les libellés (évite N+1 côté service).
 *  - Filtrage périmètre via CR autorisés calculés par
 *    PerimetreService (cohérent avec le reste du projet).
 *
 * Cible perf : < 2s pour 6444 lignes budget × 6 mois × 18 CR.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { PerimetreService } from '../../budget/services/perimetre.service';
import {
  EcartsResponseDto,
  FiltresEcartsDto,
  KpiEcartsDto,
  LigneEcartDto,
  type NatureCompte,
  type NiveauAlerte,
  type SensEcart,
  TotalEcartDto,
  TotauxEcartsDto,
} from '../dto/tableau-bord.dto';

const SEUIL_ATTENTION_DEFAUT = 5;
const SEUIL_CRITIQUE_DEFAUT = 10;

interface AuthCaller {
  userId: string;
  email: string;
}

interface LigneBrute {
  code_cr: string;
  libelle_cr: string;
  code_compte: string;
  libelle_compte: string;
  classe_compte: string;
  code_ligne_metier: string;
  /**
   * Important : en prod, le pilote `pg` renvoie un `Date` JS pour
   * une colonne `date`. `String(date).slice(0,7)` produit alors
   * `"Wed Mar"` au lieu de `"2027-03"`. On lit donc directement
   * `t.mois` (smallint) et `t.annee` ci-dessous, et on n'utilise
   * `date_temps` que pour le tri SQL (ORDER BY t.date).
   */
  mois_num: number;
  annee: number;
  montant_budget: string | null; // null si réalisé sans budget (FULL JOIN)
  montant_realise: string | null;
}

/** Construit un agrégat budget/réalisé avec écart + taux d'exécution. */
function totalEcart(budget: number, realise: number): TotalEcartDto {
  return {
    budget,
    realise,
    ecart: realise - budget,
    tauxExecution: budget !== 0 ? (realise / budget) * 100 : null,
  };
}

const TOTAUX_VIDES: TotauxEcartsDto = {
  produits: { budget: 0, realise: 0, ecart: 0, tauxExecution: null },
  charges: { budget: 0, realise: 0, ecart: 0, tauxExecution: null },
  solde: { budget: 0, realise: 0, ecart: 0, tauxExecution: null },
  pnb: { budget: 0, realise: 0, ecart: 0, tauxExecution: null },
  coefExploitationBudget: null,
  coefExploitationRealise: null,
};

const MOIS_LIBELLES_FR = [
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

function classeToNature(classe: string): NatureCompte {
  if (classe === '6') return 'CHARGE';
  if (classe === '7') return 'PRODUIT';
  return 'BILAN';
}

function sensEcartFor(
  nature: NatureCompte,
  ecart: number | null,
): SensEcart | null {
  if (ecart === null) return null;
  if (ecart === 0) return 'NEUTRE';
  if (nature === 'CHARGE') return ecart > 0 ? 'DEFAVORABLE' : 'FAVORABLE';
  if (nature === 'PRODUIT') return ecart > 0 ? 'FAVORABLE' : 'DEFAVORABLE';
  return 'NEUTRE'; // BILAN
}

function niveauAlerteFor(
  ecartPct: number | null,
  realiseManquant: boolean,
  seuilAttention: number,
  seuilCritique: number,
): NiveauAlerte {
  if (realiseManquant) return 'MANQUANT';
  if (ecartPct === null) return 'NORMAL'; // budget=0 ET realise=0
  const abs = Math.abs(ecartPct);
  if (abs >= seuilCritique) return 'CRITIQUE';
  if (abs >= seuilAttention) return 'ATTENTION';
  return 'NORMAL';
}

@Injectable()
export class AnalyseEcartsService {
  private readonly logger = new Logger(AnalyseEcartsService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly perimetreService: PerimetreService,
  ) {}

  async getBudgetVsRealise(
    filtres: FiltresEcartsDto,
    user: AuthCaller,
  ): Promise<EcartsResponseDto> {
    const start = Date.now();

    const seuilAttention =
      filtres.seuilEcartPctAttention ?? SEUIL_ATTENTION_DEFAUT;
    const seuilCritique =
      filtres.seuilEcartPctCritique ?? SEUIL_CRITIQUE_DEFAUT;

    // 1. Périmètre user (null = pas de filtre = ADMIN/AUDITEUR-équivalent)
    const crAutorises = await this.perimetreService.getCrAutorisesPourUser(
      user.userId,
    );

    // 2. Calcul de l'intersection final (filtres.crIds × périmètre user)
    let crIdsFinal: string[] | null;
    if (crAutorises === null) {
      // Pas de restriction du user → on prend ce que le filtre demande
      crIdsFinal =
        filtres.crIds && filtres.crIds.length > 0 ? filtres.crIds : null;
    } else {
      // Restriction périmètre obligatoire
      if (filtres.crIds && filtres.crIds.length > 0) {
        crIdsFinal = filtres.crIds.filter((id) => crAutorises.includes(id));
      } else {
        crIdsFinal = crAutorises;
      }
      if (crIdsFinal.length === 0) {
        // Aucun CR accessible → réponse vide
        return {
          filtres: this.normaliserFiltres(
            filtres,
            seuilAttention,
            seuilCritique,
          ),
          kpi: {
            nbEcartsTotal: 0,
            nbEcartsCritique: 0,
            nbEcartsAttention: 0,
            nbLignesManquantes: 0,
            nbSansBudget: 0,
            ecartTotalAbs: 0,
            ecartTotalDefavorable: 0,
            ecartTotalFavorable: 0,
          },
          totaux: TOTAUX_VIDES,
          lignes: [],
        };
      }
    }

    // 3. Construction du SQL — équivalent FULL JOIN émulé.
    //    pg-mem (tests) ne supporte pas FULL OUTER JOIN → on combine
    //    deux requêtes : (1) lignes pilotées par le budget (réalisé
    //    éventuel, MANQUANT sinon) et (2) lignes réalisé SANS budget
    //    (anti-join). Les deux côtés sont AGRÉGÉS au grain
    //    (CR × compte × ligne_metier × mois) pour éviter le double
    //    comptage du réalisé sur le grain produit/segment du budget.
    const params: unknown[] = [
      filtres.versionId,
      filtres.scenarioId,
      `${filtres.moisDebut}-01`,
      `${filtres.moisFin}-01`,
    ];
    let crBudget = '';
    let crRealise = '';
    if (crIdsFinal !== null) {
      const placeholders = crIdsFinal
        .map((_, i) => `$${params.length + i + 1}`)
        .join(',');
      // fait_budget = `fk_centre` ; fait_realise = `fk_centre_responsabilite`.
      crBudget = `AND fb.fk_centre IN (${placeholders})`;
      crRealise = `AND fr.fk_centre_responsabilite IN (${placeholders})`;
      params.push(...crIdsFinal);
    }
    let lmBudget = '';
    let lmRealise = '';
    if (filtres.ligneMetierIds && filtres.ligneMetierIds.length > 0) {
      const placeholders = filtres.ligneMetierIds
        .map((_, i) => `$${params.length + i + 1}`)
        .join(',');
      lmBudget = `AND fb.fk_ligne_metier IN (${placeholders})`;
      lmRealise = `AND fr.fk_ligne_metier IN (${placeholders})`;
      params.push(...filtres.ligneMetierIds);
    }

    const budgetAgg = `
      SELECT fb.fk_centre AS cr_id, fb.fk_compte AS compte_id,
             fb.fk_ligne_metier AS lm_id, fb.fk_temps AS temps_id,
             SUM(fb.montant_fcfa) AS montant_budget
      FROM fait_budget fb
      INNER JOIN dim_temps tb ON tb.id = fb.fk_temps
        AND tb.date >= $3::date AND tb.date <= $4::date AND tb.jour = 1
      WHERE fb.fk_version = $1 AND fb.fk_scenario = $2 ${crBudget} ${lmBudget}
      GROUP BY fb.fk_centre, fb.fk_compte, fb.fk_ligne_metier, fb.fk_temps
    `;
    const realiseAgg = `
      SELECT fr.fk_centre_responsabilite AS cr_id, fr.fk_compte AS compte_id,
             fr.fk_ligne_metier AS lm_id, fr.fk_temps AS temps_id,
             SUM(fr.montant) AS montant_realise
      FROM fait_realise fr
      INNER JOIN dim_temps tr ON tr.id = fr.fk_temps
        AND tr.date >= $3::date AND tr.date <= $4::date AND tr.jour = 1
      WHERE fr.statut = 'VALIDE' ${crRealise} ${lmRealise}
      GROUP BY fr.fk_centre_responsabilite, fr.fk_compte, fr.fk_ligne_metier, fr.fk_temps
    `;
    const colonnes = `
      cr.code_cr, cr.libelle AS libelle_cr,
      c.code_compte, c.libelle AS libelle_compte, c.classe AS classe_compte,
      lm.code_ligne_metier, t.mois AS mois_num, t.annee
    `;

    const sqlBudget = `
      SELECT ${colonnes}, b.montant_budget, r.montant_realise
      FROM (${budgetAgg}) b
      LEFT JOIN (${realiseAgg}) r
        ON r.cr_id = b.cr_id AND r.compte_id = b.compte_id
       AND r.lm_id = b.lm_id AND r.temps_id = b.temps_id
      INNER JOIN dim_compte c ON c.id = b.compte_id
      INNER JOIN dim_centre_responsabilite cr ON cr.id = b.cr_id
      INNER JOIN dim_ligne_metier lm ON lm.id = b.lm_id
      INNER JOIN dim_temps t ON t.id = b.temps_id
    `;
    // Anti-join via LEFT JOIN + IS NULL (pg-mem ne supporte pas le
    // NOT EXISTS corrélé sur une sous-requête dérivée).
    const sqlSansBudget = `
      SELECT ${colonnes}, NULL AS montant_budget, r.montant_realise
      FROM (${realiseAgg}) r
      LEFT JOIN (${budgetAgg}) b
        ON b.cr_id = r.cr_id AND b.compte_id = r.compte_id
       AND b.lm_id = r.lm_id AND b.temps_id = r.temps_id
      INNER JOIN dim_compte c ON c.id = r.compte_id
      INNER JOIN dim_centre_responsabilite cr ON cr.id = r.cr_id
      INNER JOIN dim_ligne_metier lm ON lm.id = r.lm_id
      INNER JOIN dim_temps t ON t.id = r.temps_id
      WHERE b.cr_id IS NULL
    `;

    const [rowsBudget, rowsSansBudget] = await Promise.all([
      this.dataSource.query<LigneBrute[]>(sqlBudget, params),
      this.dataSource.query<LigneBrute[]>(sqlSansBudget, params),
    ]);
    const rows = [...rowsBudget, ...rowsSansBudget];

    // 4. Calcul lignes + KPI en mémoire (post-SQL)
    const lignes: LigneEcartDto[] = [];
    const kpi: KpiEcartsDto = {
      nbEcartsTotal: 0,
      nbEcartsCritique: 0,
      nbEcartsAttention: 0,
      nbLignesManquantes: 0,
      nbSansBudget: 0,
      ecartTotalAbs: 0,
      ecartTotalDefavorable: 0,
      ecartTotalFavorable: 0,
    };

    // Accumulateurs « compte de résultat » : classe 7 = produits,
    // classe 6 = charges, sous-classe 67xx = charges d'intérêts (exclues
    // du PNB UEMOA et du dénominateur hors-intérêts du coefficient).
    let produitsBudget = 0;
    let produitsRealise = 0;
    let chargesBudget = 0;
    let chargesRealise = 0;
    let chargesInteretsBudget = 0;
    let chargesInteretsRealise = 0;

    for (const r of rows) {
      const montantBudget =
        r.montant_budget === null ? null : Number(r.montant_budget);
      const montantRealise =
        r.montant_realise === null ? null : Number(r.montant_realise);
      const budgetAbsent = montantBudget === null; // réalisé sans budget
      const realiseManquant = montantRealise === null; // budget sans réalisé

      // Écart = réalisé − budget (budget absent traité comme 0).
      const ecart =
        montantRealise === null ? null : montantRealise - (montantBudget ?? 0);
      const ecartAbs = ecart === null ? null : Math.abs(ecart);
      let ecartPct: number | null = null;
      if (ecart !== null && montantBudget !== null && montantBudget !== 0) {
        ecartPct = (ecart / Math.abs(montantBudget)) * 100;
      }
      let tauxExecution: number | null = null;
      if (
        montantRealise !== null &&
        montantBudget !== null &&
        montantBudget !== 0
      ) {
        tauxExecution = (montantRealise / montantBudget) * 100;
      }

      const nature = classeToNature(r.classe_compte);
      const sens = sensEcartFor(nature, ecart);
      const niveauAlerte: NiveauAlerte = budgetAbsent
        ? 'SANS_BUDGET'
        : niveauAlerteFor(
            ecartPct,
            realiseManquant,
            seuilAttention,
            seuilCritique,
          );

      const moisNum = Number(r.mois_num);
      const moisStr = `${r.annee}-${String(moisNum).padStart(2, '0')}`;
      const moisNomFr = MOIS_LIBELLES_FR[moisNum - 1] ?? `Mois ${moisNum}`;
      const libelleMois = `${moisNomFr} ${r.annee}`;

      lignes.push({
        codeCr: r.code_cr,
        libelleCr: r.libelle_cr,
        codeCompte: r.code_compte,
        libelleCompte: r.libelle_compte,
        classeCompte: r.classe_compte,
        natureCompte: nature,
        codeLigneMetier: r.code_ligne_metier,
        mois: moisStr,
        libelleMois,
        montantBudget,
        montantRealise,
        ecart,
        ecartAbs,
        ecartPct: ecartPct === null ? null : Math.round(ecartPct * 10) / 10,
        tauxExecution:
          tauxExecution === null ? null : Math.round(tauxExecution * 10) / 10,
        niveauAlerte,
        sensEcart: sens,
      });

      // Compte de résultat (budget/réalisé absents traités comme 0).
      const b = montantBudget ?? 0;
      const rl = montantRealise ?? 0;
      if (r.classe_compte === '7') {
        produitsBudget += b;
        produitsRealise += rl;
      } else if (r.classe_compte === '6') {
        chargesBudget += b;
        chargesRealise += rl;
        if (r.code_compte.startsWith('67')) {
          chargesInteretsBudget += b;
          chargesInteretsRealise += rl;
        }
      }

      // KPI
      if (realiseManquant) {
        kpi.nbLignesManquantes++;
        kpi.nbEcartsTotal++;
      } else {
        if (budgetAbsent) kpi.nbSansBudget++;
        if (ecart !== 0) {
          kpi.nbEcartsTotal++;
          kpi.ecartTotalAbs += ecartAbs ?? 0;
          if (sens === 'DEFAVORABLE') {
            kpi.ecartTotalDefavorable += ecartAbs ?? 0;
          } else if (sens === 'FAVORABLE') {
            kpi.ecartTotalFavorable += ecartAbs ?? 0;
          }
        }
      }
      if (niveauAlerte === 'CRITIQUE') kpi.nbEcartsCritique++;
      else if (niveauAlerte === 'ATTENTION') kpi.nbEcartsAttention++;
    }

    // Bloc « compte de résultat » du périmètre filtré.
    const pnbBudget = produitsBudget - chargesInteretsBudget;
    const pnbRealise = produitsRealise - chargesInteretsRealise;
    const chargesHorsInteretsBudget = chargesBudget - chargesInteretsBudget;
    const chargesHorsInteretsRealise = chargesRealise - chargesInteretsRealise;
    const totaux: TotauxEcartsDto = {
      produits: totalEcart(produitsBudget, produitsRealise),
      charges: totalEcart(chargesBudget, chargesRealise),
      solde: totalEcart(
        produitsBudget - chargesBudget,
        produitsRealise - chargesRealise,
      ),
      pnb: totalEcart(pnbBudget, pnbRealise),
      coefExploitationBudget:
        pnbBudget > 0
          ? Math.round((chargesHorsInteretsBudget / pnbBudget) * 1000) / 10
          : null,
      coefExploitationRealise:
        pnbRealise > 0
          ? Math.round((chargesHorsInteretsRealise / pnbRealise) * 1000) / 10
          : null,
    };

    // 5. Tri final : ecart_abs décroissant (les plus gros écarts en haut)
    lignes.sort((a, b) => {
      const aAbs = a.ecartAbs ?? -1;
      const bAbs = b.ecartAbs ?? -1;
      if (bAbs !== aAbs) return bAbs - aAbs;
      // Egal : par CR puis compte puis mois
      if (a.codeCr !== b.codeCr) return a.codeCr.localeCompare(b.codeCr);
      if (a.codeCompte !== b.codeCompte)
        return a.codeCompte.localeCompare(b.codeCompte);
      return a.mois.localeCompare(b.mois);
    });

    const dureeMs = Date.now() - start;
    if (dureeMs > 1500) {
      this.logger.warn(
        `getBudgetVsRealise lent (${dureeMs}ms, ${rows.length} lignes). ` +
          `Envisager un index supplémentaire si récurrent.`,
      );
    }

    return {
      filtres: this.normaliserFiltres(filtres, seuilAttention, seuilCritique),
      kpi,
      totaux,
      lignes,
    };
  }

  private normaliserFiltres(
    filtres: FiltresEcartsDto,
    seuilAttention: number,
    seuilCritique: number,
  ): FiltresEcartsDto {
    return {
      versionId: filtres.versionId,
      scenarioId: filtres.scenarioId,
      crIds: filtres.crIds,
      ligneMetierIds: filtres.ligneMetierIds,
      moisDebut: filtres.moisDebut,
      moisFin: filtres.moisFin,
      seuilEcartPctAttention: seuilAttention,
      seuilEcartPctCritique: seuilCritique,
    };
  }
}
