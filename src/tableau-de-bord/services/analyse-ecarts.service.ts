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
} from '../dto/tableau-bord.dto';

const SEUIL_ATTENTION_DEFAUT = 5;
const SEUIL_CRITIQUE_DEFAUT = 10;

interface AuthCaller {
  userId: string;
  email: string;
}

interface LigneBrute {
  fk_centre_responsabilite: string;
  code_cr: string;
  libelle_cr: string;
  fk_compte: string;
  code_compte: string;
  libelle_compte: string;
  classe_compte: string;
  fk_ligne_metier: string;
  code_ligne_metier: string;
  fk_temps: string;
  /**
   * Important : en prod, le pilote `pg` renvoie un `Date` JS pour
   * une colonne `date`. `String(date).slice(0,7)` produit alors
   * `"Wed Mar"` au lieu de `"2027-03"`. On lit donc directement
   * `t.mois` (smallint) et `t.annee` ci-dessous, et on n'utilise
   * `date_temps` que pour le tri SQL (ORDER BY t.date).
   */
  mois_num: number;
  annee: number;
  montant_budget: string; // numeric → string PG
  montant_realise: string | null;
}

const MOIS_LIBELLES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
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
      crIdsFinal = filtres.crIds && filtres.crIds.length > 0
        ? filtres.crIds
        : null;
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
          filtres: this.normaliserFiltres(filtres, seuilAttention, seuilCritique),
          kpi: {
            nbEcartsTotal: 0,
            nbEcartsCritique: 0,
            nbEcartsAttention: 0,
            nbLignesManquantes: 0,
            ecartTotalAbs: 0,
            ecartTotalDefavorable: 0,
            ecartTotalFavorable: 0,
          },
          lignes: [],
        };
      }
    }

    // 3. Construction du SQL — LEFT JOIN central
    const params: unknown[] = [
      filtres.versionId,
      filtres.scenarioId,
      `${filtres.moisDebut}-01`,
      `${filtres.moisFin}-01`,
    ];
    let crFilter = '';
    if (crIdsFinal !== null) {
      const placeholders = crIdsFinal
        .map((_, i) => `$${params.length + i + 1}`)
        .join(',');
      // Note : la colonne dans fait_budget s'appelle `fk_centre`
      // (différent de fait_realise qui a `fk_centre_responsabilite`).
      crFilter = `AND fb.fk_centre IN (${placeholders})`;
      params.push(...crIdsFinal);
    }
    let lmFilter = '';
    if (filtres.ligneMetierIds && filtres.ligneMetierIds.length > 0) {
      const placeholders = filtres.ligneMetierIds
        .map((_, i) => `$${params.length + i + 1}`)
        .join(',');
      lmFilter = `AND fb.fk_ligne_metier IN (${placeholders})`;
      params.push(...filtres.ligneMetierIds);
    }

    const sql = `
      SELECT
        fb.fk_centre AS fk_centre_responsabilite,
        cr.code_cr,
        cr.libelle AS libelle_cr,
        fb.fk_compte,
        c.code_compte,
        c.libelle AS libelle_compte,
        c.classe AS classe_compte,
        fb.fk_ligne_metier,
        lm.code_ligne_metier,
        fb.fk_temps,
        t.mois AS mois_num,
        t.annee,
        fb.montant_fcfa AS montant_budget,
        fr.montant AS montant_realise
      FROM fait_budget fb
      INNER JOIN dim_compte c ON c.id = fb.fk_compte
      INNER JOIN dim_centre_responsabilite cr ON cr.id = fb.fk_centre
      INNER JOIN dim_ligne_metier lm ON lm.id = fb.fk_ligne_metier
      INNER JOIN dim_temps t ON t.id = fb.fk_temps
      LEFT JOIN fait_realise fr ON
        fr.fk_centre_responsabilite = fb.fk_centre
        AND fr.fk_compte = fb.fk_compte
        AND fr.fk_ligne_metier = fb.fk_ligne_metier
        AND fr.fk_temps = fb.fk_temps
        AND fr.fk_devise = fb.fk_devise
        AND fr.statut = 'VALIDE'
      WHERE fb.fk_version = $1
        AND fb.fk_scenario = $2
        AND t.date >= $3::date
        AND t.date <= $4::date
        AND t.jour = 1
        ${crFilter}
        ${lmFilter}
      ORDER BY cr.code_cr ASC, c.code_compte ASC, t.date ASC
    `;

    const rows = await this.dataSource.query<LigneBrute[]>(sql, params);

    // 4. Calcul lignes + KPI en mémoire (post-SQL)
    const lignes: LigneEcartDto[] = [];
    const kpi: KpiEcartsDto = {
      nbEcartsTotal: 0,
      nbEcartsCritique: 0,
      nbEcartsAttention: 0,
      nbLignesManquantes: 0,
      ecartTotalAbs: 0,
      ecartTotalDefavorable: 0,
      ecartTotalFavorable: 0,
    };

    for (const r of rows) {
      const montantBudget = Number(r.montant_budget);
      const montantRealise =
        r.montant_realise === null ? null : Number(r.montant_realise);
      const ecart =
        montantRealise === null ? null : montantRealise - montantBudget;
      const ecartAbs = ecart === null ? null : Math.abs(ecart);
      let ecartPct: number | null = null;
      if (ecart !== null && montantBudget !== 0) {
        ecartPct = (ecart / Math.abs(montantBudget)) * 100;
      }
      const niveauAlerte = niveauAlerteFor(
        ecartPct,
        montantRealise === null,
        seuilAttention,
        seuilCritique,
      );
      const nature = classeToNature(r.classe_compte);
      const sens = sensEcartFor(nature, ecart);

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
        niveauAlerte,
        sensEcart: sens,
      });

      // KPI
      if (montantRealise === null) {
        kpi.nbLignesManquantes++;
        kpi.nbEcartsTotal++;
      } else if (ecart !== 0) {
        kpi.nbEcartsTotal++;
        kpi.ecartTotalAbs += ecartAbs ?? 0;
        if (sens === 'DEFAVORABLE') {
          kpi.ecartTotalDefavorable += ecartAbs ?? 0;
        } else if (sens === 'FAVORABLE') {
          kpi.ecartTotalFavorable += ecartAbs ?? 0;
        }
      }
      if (niveauAlerte === 'CRITIQUE') kpi.nbEcartsCritique++;
      else if (niveauAlerte === 'ATTENTION') kpi.nbEcartsAttention++;
    }

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
