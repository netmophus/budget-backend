/**
 * Seed pédagogique de `dim_scenario`.
 *
 * 3 scénarios initiaux : central, alternatif haut (optimiste),
 * alternatif bas (pessimiste). Tous en `statut='actif'`.
 */
import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import type { TypeScenario } from '../referentiels/scenario/entities/dim-scenario.entity';

export interface ScenarioSeedRow {
  codeScenario: string;
  libelle: string;
  typeScenario: TypeScenario;
  commentaire: string | null;
}

export const SCENARIOS_INITIAUX: readonly ScenarioSeedRow[] = [
  {
    codeScenario: 'CENTRAL',
    libelle: 'Scénario central',
    typeScenario: 'central',
    commentaire: 'Hypothèses macro de référence (taux directeur BCEAO, croissance UEMOA)',
  },
  {
    codeScenario: 'ALTERNATIF_HAUT',
    libelle: 'Scénario optimiste',
    typeScenario: 'optimiste',
    commentaire: 'Croissance accélérée, baisse des taux',
  },
  {
    codeScenario: 'ALTERNATIF_BAS',
    libelle: 'Scénario pessimiste',
    typeScenario: 'pessimiste',
    commentaire: 'Ralentissement, choc inflation',
  },
];

export async function seedScenarios(ds: DataSource = AppDataSource): Promise<void> {
  const ownsConnection = !ds.isInitialized;
  if (ownsConnection) {
    await ds.initialize();
  }
  try {
    const force = process.argv.slice(2).includes('--force');
    if (force) {
      console.log('[seed:scenarios] --force : purge de dim_scenario');
      await ds.query(`DELETE FROM dim_scenario`);
    }

    for (const s of SCENARIOS_INITIAUX) {
      const existing = (await ds.query(
        `SELECT id FROM dim_scenario WHERE code_scenario = $1`,
        [s.codeScenario],
      )) as Array<{ id: string }>;
      if (existing.length > 0) continue;

      await ds.query(
        `INSERT INTO dim_scenario
          ("code_scenario","libelle","type_scenario","statut","commentaire","utilisateur_creation")
         VALUES ($1,$2,$3,'actif',$4,'system')`,
        [s.codeScenario, s.libelle, s.typeScenario, s.commentaire],
      );
    }

    const stats = await ds.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE statut='actif')::int AS actifs
       FROM dim_scenario`,
    );
    const r0 = stats[0] as { total: number; actifs: number };
    console.log(
      `[seed:scenarios] total=${r0.total} actifs=${r0.actifs} (attendu : ${SCENARIOS_INITIAUX.length} / ${SCENARIOS_INITIAUX.length})`,
    );
  } finally {
    if (ownsConnection) {
      await ds.destroy();
    }
  }
}

if (require.main === module) {
  seedScenarios()
    .then(() => {
      console.log('[seed:scenarios] Done.');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[seed:scenarios] Failed:', err);
      process.exit(1);
    });
}
