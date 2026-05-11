/**
 * IndicateursService (Lot 3.6) — calcul des 3 indicateurs métier
 * UEMOA (PNB / MNI / Coefficient d'exploitation) consolidés sur le
 * périmètre RBAC de l'utilisateur.
 *
 * Décisions Q15-Q17 figées :
 *  - Q15 : lecture depuis `mv_indicateurs_budget` (vue matérialisée)
 *    rafraîchie à la demande via `refreshIndicateurs`.
 *  - Q16 : drill-down par CR (méthode `getIndicateursParCr`).
 *  - Q17 : comparaison scénarios côte à côte
 *    (`getIndicateursComparaison`).
 *
 * Filtrage périmètre Q5 : appliqué systématiquement via
 * `PerimetreService.getCrAutorisesPourUser` — un user qui ne couvre
 * que `BR_CIV` ne voit que les indicateurs des fait_budget rattachés
 * à ce CR (même au niveau des totaux globaux).
 */
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import {
  IndicateursComparaisonDto,
  IndicateursComparaisonFiltersDto,
  IndicateursFiltersDto,
  IndicateursGlobauxDto,
  IndicateursParCrDto,
  RefreshIndicateursResponseDto,
} from '../dto/indicateurs.dto';
import { PerimetreService } from './perimetre.service';

/**
 * Forme brute d'une ligne `mv_indicateurs_budget`. Tous les
 * agrégats numeric sont retournés en `string` par node-postgres
 * (libpq). Le service convertit en `number` côté JS — perte de
 * précision acceptable au-delà de 2^53 (≈ 9 × 10^15) ; au-delà,
 * on est largement hors-sujet pour des montants budgétaires UEMOA.
 */
interface MvRow {
  fk_version: string;
  fk_scenario: string;
  fk_centre: string;
  code_cr: string;
  libelle_cr: string;
  exercice: number;
  total_classe_6: string;
  total_classe_7: string;
  total_67_charges_interets: string;
  total_76_produits_interets: string;
  pnb: string;
  mni: string;
  charges_hors_interets: string;
  nb_lignes: string;
  derniere_modif: Date | null;
}

interface AgregeSums {
  pnb: number;
  mni: number;
  chargesHorsInterets: number;
  totalProduits: number;
  totalCharges: number;
  derniereMaj: Date | null;
}

@Injectable()
export class IndicateursService {
  private readonly logger = new Logger(IndicateursService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly perimetreService: PerimetreService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Lecture ─────────────────────────────────────────────────────

  async getIndicateursGlobaux(
    filters: IndicateursFiltersDto,
    user: { userId: string },
  ): Promise<IndicateursGlobauxDto> {
    const rows = await this.queryRows(filters, user.userId);
    const sums = this.aggregate(rows);
    const nbCrInclus = new Set(rows.map((r) => r.fk_centre)).size;
    return {
      ...sums,
      coefExploitation: this.coef(sums.chargesHorsInterets, sums.pnb),
      derniereMaj: sums.derniereMaj?.toISOString() ?? null,
      nbCrInclus,
    };
  }

  async getIndicateursParCr(
    filters: IndicateursFiltersDto,
    user: { userId: string },
  ): Promise<IndicateursParCrDto[]> {
    const rows = await this.queryRows(filters, user.userId);
    // 1 ligne par CR — la vue est déjà groupée par
    // (version, scenario, centre, exercice), donc une seule
    // entrée par CR pour le triplet (version, scenario, exercice).
    return rows.map<IndicateursParCrDto>((r) => {
      const pnb = Number(r.pnb);
      const charges = Number(r.charges_hors_interets);
      return {
        crId: String(r.fk_centre),
        codeCr: r.code_cr,
        libelleCr: r.libelle_cr,
        pnb,
        mni: Number(r.mni),
        coefExploitation: this.coef(charges, pnb),
        chargesHorsInterets: charges,
        totalProduits: Number(r.total_classe_7),
      };
    });
  }

  /**
   * Comparaison côte à côte des scénarios disponibles pour la version.
   * Récupère TOUS les scénarios pour lesquels la vue matérialisée a
   * des lignes (1 si seul MEDIAN saisi, 3 si MED+OPT+PES…) puis
   * calcule les agrégats globaux (sur les CR autorisés) pour chacun.
   */
  async getIndicateursComparaison(
    filters: IndicateursComparaisonFiltersDto,
    user: { userId: string },
  ): Promise<IndicateursComparaisonDto> {
    const crIds = await this.perimetreService.getCrAutorisesPourUser(
      user.userId,
    );
    if (crIds !== null && crIds.length === 0) {
      // Aucun CR autorisé → réponse vide.
      const v = await this.fetchVersionMeta(filters.versionId);
      return {
        version: v,
        exerciceFiscal: filters.exerciceFiscal,
        scenarios: [],
        derniereMaj: null,
      };
    }

    const params: unknown[] = [filters.versionId, filters.exerciceFiscal];
    let crClause = '';
    if (crIds !== null) {
      const placeholders = crIds.map((_, i) => `$${i + 3}`).join(',');
      crClause = `AND mv.fk_centre IN (${placeholders})`;
      params.push(...crIds);
    }
    const rows = await this.dataSource.query<
      Array<
        MvRow & {
          scenario_id: string;
          scenario_code: string;
          scenario_libelle: string;
          scenario_type: string;
        }
      >
    >(
      `SELECT mv.*,
              s.id            AS scenario_id,
              s.code_scenario AS scenario_code,
              s.libelle       AS scenario_libelle,
              s.type_scenario AS scenario_type
         FROM mv_indicateurs_budget mv
         JOIN dim_scenario s ON s.id = mv.fk_scenario
        WHERE mv.fk_version = $1
          AND mv.exercice  = $2
          ${crClause}`,
      params,
    );

    // Regroupe par scenario_id et agrège.
    const byScenario = new Map<
      string,
      {
        scenarioId: string;
        codeScenario: string;
        libelle: string;
        typeScenario: string;
        rows: MvRow[];
      }
    >();
    for (const r of rows) {
      const sid = String(r.scenario_id);
      let bucket = byScenario.get(sid);
      if (!bucket) {
        bucket = {
          scenarioId: sid,
          codeScenario: r.scenario_code,
          libelle: r.scenario_libelle,
          typeScenario: r.scenario_type,
          rows: [],
        };
        byScenario.set(sid, bucket);
      }
      bucket.rows.push(r);
    }

    const version = await this.fetchVersionMeta(filters.versionId);
    let derniereMaj: Date | null = null;
    const scenarios = Array.from(byScenario.values()).map((b) => {
      const sums = this.aggregate(b.rows);
      if (
        sums.derniereMaj &&
        (!derniereMaj || sums.derniereMaj > derniereMaj)
      ) {
        derniereMaj = sums.derniereMaj;
      }
      return {
        scenarioId: b.scenarioId,
        codeScenario: b.codeScenario,
        libelle: b.libelle,
        typeScenario: b.typeScenario,
        pnb: sums.pnb,
        mni: sums.mni,
        coefExploitation: this.coef(sums.chargesHorsInterets, sums.pnb),
        chargesHorsInterets: sums.chargesHorsInterets,
        totalProduits: sums.totalProduits,
        totalCharges: sums.totalCharges,
      };
    });

    return {
      version,
      exerciceFiscal: filters.exerciceFiscal,
      scenarios,
      derniereMaj: (derniereMaj as Date | null)?.toISOString() ?? null,
    };
  }

  // ─── Refresh ─────────────────────────────────────────────────────

  async refreshIndicateurs(user: {
    email: string;
  }): Promise<RefreshIndicateursResponseDto> {
    const t0 = Date.now();
    // CONCURRENTLY : ne bloque pas les SELECT pendant le refresh.
    // Requiert l'index UNIQUE posé par la migration.
    try {
      await this.dataSource.query(
        `REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_indicateurs_budget"`,
      );
    } catch (err) {
      // Premier refresh post-création : la vue est vide, CONCURRENTLY
      // refuse → fallback en mode bloquant (1 fois).
      this.logger.warn(
        `REFRESH CONCURRENTLY a échoué (probablement premier refresh). Fallback bloquant. ${(err as Error).message}`,
      );
      await this.dataSource.query(
        `REFRESH MATERIALIZED VIEW "mv_indicateurs_budget"`,
      );
    }
    const dureeMs = Date.now() - t0;
    const rows = await this.dataSource.query<Array<{ n: string }>>(
      `SELECT COUNT(*)::text AS n FROM mv_indicateurs_budget`,
    );
    const nbLignes = Number(rows[0]?.n ?? 0);

    await this.auditService.log({
      utilisateur: user.email,
      typeAction: 'RECALCUL_INDICATEURS',
      entiteCible: 'mv_indicateurs_budget',
      idCible: null,
      statut: 'success',
      dureeMs,
      payloadApres: { dureeMs, nbLignes },
      commentaire: `Refresh mv_indicateurs_budget — ${nbLignes} ligne(s) en ${dureeMs} ms.`,
    });

    return { dureeMs, nbLignes };
  }

  // ─── Helpers privés ──────────────────────────────────────────────

  /** Récupère les lignes de la vue pour le triplet (version, scénario, exercice). */
  private async queryRows(
    filters: IndicateursFiltersDto,
    userId: string,
  ): Promise<MvRow[]> {
    const crIds = await this.perimetreService.getCrAutorisesPourUser(userId);
    if (crIds !== null && crIds.length === 0) return [];

    const params: unknown[] = [
      filters.versionId,
      filters.scenarioId,
      filters.exerciceFiscal,
    ];
    let crClause = '';
    if (crIds !== null) {
      const placeholders = crIds.map((_, i) => `$${i + 4}`).join(',');
      crClause = `AND mv.fk_centre IN (${placeholders})`;
      params.push(...crIds);
    }
    return this.dataSource.query<MvRow[]>(
      `SELECT mv.*
         FROM mv_indicateurs_budget mv
        WHERE mv.fk_version  = $1
          AND mv.fk_scenario = $2
          AND mv.exercice    = $3
          ${crClause}`,
      params,
    );
  }

  private aggregate(rows: MvRow[]): AgregeSums {
    let pnb = 0;
    let mni = 0;
    let chargesHorsInterets = 0;
    let totalProduits = 0;
    let totalCharges = 0;
    let derniereMaj: Date | null = null;
    for (const r of rows) {
      pnb += Number(r.pnb);
      mni += Number(r.mni);
      chargesHorsInterets += Number(r.charges_hors_interets);
      totalProduits += Number(r.total_classe_7);
      totalCharges += Number(r.total_classe_6);
      if (r.derniere_modif) {
        const d =
          r.derniere_modif instanceof Date
            ? r.derniere_modif
            : new Date(r.derniere_modif);
        if (!derniereMaj || d > derniereMaj) derniereMaj = d;
      }
    }
    return {
      pnb,
      mni,
      chargesHorsInterets,
      totalProduits,
      totalCharges,
      derniereMaj,
    };
  }

  private coef(chargesHorsInterets: number, pnb: number): number | null {
    return pnb > 0 ? (chargesHorsInterets / pnb) * 100 : null;
  }

  private async fetchVersionMeta(versionId: string): Promise<{
    id: string;
    codeVersion: string;
    libelle: string;
  }> {
    const rows = await this.dataSource.query<
      Array<{ id: string; code_version: string; libelle: string }>
    >(`SELECT id, code_version, libelle FROM dim_version WHERE id = $1`, [
      versionId,
    ]);
    const r = rows[0];
    if (!r) {
      // Version inconnue : on retourne un placeholder plutôt que de
      // lever — la comparaison reste exploitable pour debug, et le
      // controller filtre déjà l'autorisation côté permissions.
      return { id: versionId, codeVersion: '?', libelle: '?' };
    }
    return {
      id: String(r.id),
      codeVersion: r.code_version,
      libelle: r.libelle,
    };
  }
}
