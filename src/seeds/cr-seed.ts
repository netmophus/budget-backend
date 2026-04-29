/**
 * Seed `dim_centre_responsabilite` — 6 CR rattachés à la banque
 * pilote seedée en 2.3A (cf. brief 2.3B §8).
 *
 * Hiérarchie applicative :
 *  - CR_DIR_CIV_RETAIL        (cdp, parent = DIR_CIV_RETAIL)
 *  - CR_DIR_CIV_CORPORATE     (cdp, parent = DIR_CIV_CORPORATE)
 *  - CR_DEPT_CIV_PARTICULIERS (cdp, parent = DEPT_CIV_PARTICULIERS)
 *  - CR_AG_ABJ_PLATEAU        (cdp, parent = AG_ABJ_PLATEAU)
 *  - CR_AG_ABJ_COCODY         (cdp, parent = AG_ABJ_COCODY)
 *  - CR_BR_CIV_FONCTIONS      (cdc, parent = BR_CIV)
 *
 * Idempotent : ne crée pas de nouvelle version si une version
 * courante existe déjà. Mode `--force` purge `dim_centre_responsabilite`.
 *
 * La FK `fk_structure` est résolue dynamiquement par lookup sur
 * `dim_structure WHERE code_structure = ? AND version_courante =
 * true` — robuste à un re-seed après PATCH structure (les ids
 * peuvent avoir changé).
 */
import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import type { TypeCr } from '../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';

export interface CrSeedRow {
  codeCr: string;
  libelle: string;
  libelleCourt: string | null;
  typeCr: TypeCr;
  /** Code business de la structure parente. */
  parentCodeStructure: string;
}

export const CRS_INITIAUX: readonly CrSeedRow[] = [
  {
    codeCr: 'CR_DIR_CIV_RETAIL',
    libelle: 'CR Direction Retail CIV',
    libelleCourt: 'CR Retail CIV',
    typeCr: 'cdp',
    parentCodeStructure: 'DIR_CIV_RETAIL',
  },
  {
    codeCr: 'CR_DIR_CIV_CORPORATE',
    libelle: 'CR Direction Corporate CIV',
    libelleCourt: 'CR Corp. CIV',
    typeCr: 'cdp',
    parentCodeStructure: 'DIR_CIV_CORPORATE',
  },
  {
    codeCr: 'CR_DEPT_CIV_PARTICULIERS',
    libelle: 'CR Département Particuliers CIV',
    libelleCourt: 'CR Dept. Part.',
    typeCr: 'cdp',
    parentCodeStructure: 'DEPT_CIV_PARTICULIERS',
  },
  {
    codeCr: 'CR_AG_ABJ_PLATEAU',
    libelle: 'CR Agence Abidjan Plateau',
    libelleCourt: 'CR Ag. Plateau',
    typeCr: 'cdp',
    parentCodeStructure: 'AG_ABJ_PLATEAU',
  },
  {
    codeCr: 'CR_AG_ABJ_COCODY',
    libelle: 'CR Agence Abidjan Cocody',
    libelleCourt: 'CR Ag. Cocody',
    typeCr: 'cdp',
    parentCodeStructure: 'AG_ABJ_COCODY',
  },
  {
    codeCr: 'CR_BR_CIV_FONCTIONS',
    libelle: 'CR Fonctions Branche CIV',
    libelleCourt: 'CR Fct. CIV',
    typeCr: 'cdc',
    parentCodeStructure: 'BR_CIV',
  },
];

async function seedCrs(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const force = process.argv.slice(2).includes('--force');
    if (force) {
      console.log('[seed:cr] --force : purge de dim_centre_responsabilite');
      await AppDataSource.query(`DELETE FROM dim_centre_responsabilite`);
    }

    const today = new Date().toISOString().slice(0, 10);

    for (const cr of CRS_INITIAUX) {
      // Idempotence : sauter si version courante existe.
      const existing = (await AppDataSource.query(
        `SELECT id FROM dim_centre_responsabilite
         WHERE code_cr = $1 AND version_courante = true`,
        [cr.codeCr],
      )) as Array<{ id: string }>;
      if (existing.length > 0) {
        continue;
      }

      // Résoudre dynamiquement la FK structure parente.
      const parentRows = (await AppDataSource.query(
        `SELECT id FROM dim_structure
         WHERE code_structure = $1 AND version_courante = true`,
        [cr.parentCodeStructure],
      )) as Array<{ id: string }>;
      if (parentRows.length === 0) {
        throw new Error(
          `[seed:cr] Structure parente ${cr.parentCodeStructure} introuvable ou non courante. Lancer seed:structures avant.`,
        );
      }
      const fkStructure = String(parentRows[0]!.id);

      await AppDataSource.query(
        `INSERT INTO dim_centre_responsabilite
           ("code_cr","libelle","libelle_court","type_cr","fk_structure",
            "date_debut_validite","date_fin_validite","version_courante",
            "est_actif","utilisateur_creation")
         VALUES ($1,$2,$3,$4,$5,$6,NULL,true,true,'system')`,
        [
          cr.codeCr,
          cr.libelle,
          cr.libelleCourt,
          cr.typeCr,
          fkStructure,
          today,
        ],
      );
    }

    const stats = await AppDataSource.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE version_courante = true)::int AS courantes
       FROM dim_centre_responsabilite`,
    );
    const row = stats[0] as { total: number; courantes: number };
    console.log(
      `[seed:cr] total=${row.total} courantes=${row.courantes} (attendu : 6 / 6)`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  seedCrs()
    .then(() => {
      console.log('[seed:cr] Done.');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[seed:cr] Failed:', err);
      process.exit(1);
    });
}
