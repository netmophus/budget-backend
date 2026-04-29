/**
 * Seed pédagogique de `ref_taux_change`.
 *
 * **Taux indicatifs uniquement** — la banque cliente importera ses
 * propres taux BCEAO en production. Les valeurs ci-dessous sont
 * destinées aux tests / démos et n'ont pas vocation à servir de
 * référence métier.
 *
 * Pour chacune des 6 devises non-pivot (EUR, USD, GBP, NGN, GHS,
 * CNY) on insère :
 *   - 1 taux `fixe_budgetaire` au 2026-01-01
 *   - 1 taux `cloture` au 2026-03-31 (T1 2026)
 *   - 1 taux `cloture` au 2026-06-30 (S1 2026)
 *
 * Soit 6 × 3 = 18 taux. XOF (pivot) n'a pas de taux propre (il est
 * la référence : 1 XOF = 1 XOF).
 *
 * Prérequis : `dim_devise` et `dim_temps` doivent contenir les codes
 * et dates ciblés (cf. `seed:devises` et `seed:temps`).
 */
import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import type { TypeTaux } from '../referentiels/taux-change/entities/ref-taux-change.entity';

interface TauxSeedRow {
  codeDevise: string;
  date: string;
  tauxVersPivot: string;
  typeTaux: TypeTaux;
  source: string;
}

const DEVISES: ReadonlyArray<{ code: string; tauxFixe: string }> = [
  { code: 'EUR', tauxFixe: '655.95700000' }, // parité fixe BCEAO
  { code: 'USD', tauxFixe: '600.00000000' }, // indicatif 2026
  { code: 'GBP', tauxFixe: '750.00000000' }, // indicatif 2026
  { code: 'NGN', tauxFixe: '0.40000000' }, // Naira nigérian
  { code: 'GHS', tauxFixe: '50.00000000' }, // Cedi ghanéen
  { code: 'CNY', tauxFixe: '85.00000000' }, // Yuan
];

/**
 * Légère variation entre cloture T1 et S1 pour rester réaliste
 * (sauf EUR qui reste à parité fixe).
 */
function tauxCloture(deviseFixe: string, code: string, _date: string): string {
  if (code === 'EUR') return deviseFixe;
  // ±1% versus le fixe budgétaire
  const fixe = parseFloat(deviseFixe);
  const variation = code === 'USD' ? 1.005 : 0.995;
  return (fixe * variation).toFixed(8);
}

export const TAUX_INITIAUX: ReadonlyArray<TauxSeedRow> = DEVISES.flatMap(
  (d) => [
    {
      codeDevise: d.code,
      date: '2026-01-01',
      tauxVersPivot: d.tauxFixe,
      typeTaux: 'fixe_budgetaire' as const,
      source: 'BCEAO',
    },
    {
      codeDevise: d.code,
      date: '2026-03-31',
      tauxVersPivot: tauxCloture(d.tauxFixe, d.code, '2026-03-31'),
      typeTaux: 'cloture' as const,
      source: 'BCEAO',
    },
    {
      codeDevise: d.code,
      date: '2026-06-30',
      tauxVersPivot: tauxCloture(d.tauxFixe, d.code, '2026-06-30'),
      typeTaux: 'cloture' as const,
      source: 'BCEAO',
    },
  ],
);

async function seedTaux(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const force = process.argv.slice(2).includes('--force');
    if (force) {
      console.log('[seed:taux-change] --force : purge de ref_taux_change');
      await AppDataSource.query(`DELETE FROM ref_taux_change`);
    }

    let inserted = 0;
    let skipped = 0;
    for (const t of TAUX_INITIAUX) {
      const devise = (await AppDataSource.query(
        `SELECT id FROM dim_devise WHERE code_iso = $1`,
        [t.codeDevise],
      )) as Array<{ id: string }>;
      if (devise.length === 0) {
        throw new Error(
          `[seed:taux-change] Devise ${t.codeDevise} introuvable. Lancer 'npm run seed:devises' avant.`,
        );
      }
      const temps = (await AppDataSource.query(
        `SELECT id FROM dim_temps WHERE date = $1`,
        [t.date],
      )) as Array<{ id: string }>;
      if (temps.length === 0) {
        throw new Error(
          `[seed:taux-change] Date ${t.date} introuvable dans dim_temps. Lancer 'npm run seed:temps' avant.`,
        );
      }
      const existing = (await AppDataSource.query(
        `SELECT id FROM ref_taux_change
         WHERE fk_devise = $1 AND fk_temps = $2 AND type_taux = $3`,
        [String(devise[0]!.id), String(temps[0]!.id), t.typeTaux],
      )) as Array<{ id: string }>;
      if (existing.length > 0) {
        skipped++;
        continue;
      }

      await AppDataSource.query(
        `INSERT INTO ref_taux_change
          ("fk_devise","fk_temps","taux_vers_pivot","source","type_taux","utilisateur_creation")
         VALUES ($1,$2,$3,$4,$5,'system')`,
        [
          String(devise[0]!.id),
          String(temps[0]!.id),
          t.tauxVersPivot,
          t.source,
          t.typeTaux,
        ],
      );
      inserted++;
    }

    const stats = await AppDataSource.query(
      `SELECT COUNT(*)::int AS total FROM ref_taux_change`,
    );
    const r0 = stats[0] as { total: number };
    console.log(
      `[seed:taux-change] inserted=${inserted} skipped=${skipped} total=${r0.total} (attendu : ${TAUX_INITIAUX.length})`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  seedTaux()
    .then(() => {
      console.log('[seed:taux-change] Done.');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[seed:taux-change] Failed:', err);
      process.exit(1);
    });
}
