/**
 * Seed pédagogique de `dim_version`.
 *
 * 3 versions exemple pour exercice 2026 (statut='ouvert' systématique).
 * Le workflow soumettre/valider/geler arrive en Lot 3.3 — on ne peut
 * donc pas seeder de versions déjà gelées au Lot 3.1.
 */
import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import type { TypeVersion } from '../referentiels/version/entities/dim-version.entity';

export interface VersionSeedRow {
  codeVersion: string;
  libelle: string;
  typeVersion: TypeVersion;
  exerciceFiscal: number;
  commentaire: string | null;
}

export const VERSIONS_INITIALES: readonly VersionSeedRow[] = [
  {
    codeVersion: 'BUDGET_INITIAL_2026',
    libelle: 'Budget initial 2026',
    typeVersion: 'budget_initial',
    exerciceFiscal: 2026,
    commentaire: 'Cadrage initial DG — exercice 2026',
  },
  {
    codeVersion: 'RF1_2026',
    libelle: 'Reforecast 1 — 2026',
    typeVersion: 'reforecast_1',
    exerciceFiscal: 2026,
    commentaire: 'Première reprévision Q2 2026',
  },
  {
    codeVersion: 'ATTERRISSAGE_2026',
    libelle: 'Atterrissage 2026',
    typeVersion: 'atterrissage',
    exerciceFiscal: 2026,
    commentaire: "Projection fin d'année 2026",
  },
];

export async function seedVersions(
  ds: DataSource = AppDataSource,
): Promise<void> {
  const ownsConnection = !ds.isInitialized;
  if (ownsConnection) {
    await ds.initialize();
  }
  try {
    const force = process.argv.slice(2).includes('--force');
    if (force) {
      console.log('[seed:versions] --force : purge de dim_version');
      await ds.query(`DELETE FROM dim_version`);
    }

    for (const v of VERSIONS_INITIALES) {
      const existing = (await ds.query(
        `SELECT id FROM dim_version WHERE code_version = $1`,
        [v.codeVersion],
      )) as Array<{ id: string }>;
      if (existing.length > 0) continue;

      await ds.query(
        `INSERT INTO dim_version
          ("code_version","libelle","type_version","exercice_fiscal",
           "statut","commentaire","utilisateur_creation")
         VALUES ($1,$2,$3,$4,'ouvert',$5,'system')`,
        [
          v.codeVersion,
          v.libelle,
          v.typeVersion,
          v.exerciceFiscal,
          v.commentaire,
        ],
      );
    }

    const stats = await ds.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE statut='ouvert')::int AS ouverts
       FROM dim_version`,
    );
    const r0 = stats[0] as { total: number; ouverts: number };
    console.log(
      `[seed:versions] total=${r0.total} ouverts=${r0.ouverts} (attendu : ${VERSIONS_INITIALES.length} / ${VERSIONS_INITIALES.length})`,
    );
  } finally {
    if (ownsConnection) {
      await ds.destroy();
    }
  }
}

if (require.main === module) {
  seedVersions()
    .then(() => {
      console.log('[seed:versions] Done.');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[seed:versions] Failed:', err);
      process.exit(1);
    });
}
