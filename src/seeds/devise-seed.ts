/**
 * Seed du référentiel `dim_devise` — devises BCEAO/UEMOA + commerce
 * frontalier + commerce international (cf. brief 2.2B §7).
 *
 * Devises :
 *  - XOF Franc CFA BCEAO  → pivot, 0 décimales
 *  - EUR Euro             → 2 décimales
 *  - USD Dollar US        → 2 décimales
 *  - GBP Livre sterling   → 2 décimales
 *  - NGN Naira (Nigeria)  → 2 décimales (commerce frontalier)
 *  - GHS Cedi (Ghana)     → 2 décimales (commerce frontalier)
 *  - CNY Yuan             → 2 décimales (commerce international)
 *
 * Idempotent : `ON CONFLICT (code_iso) DO NOTHING`. Mode `--force`
 * disponible (purge `dim_devise` avant régénération).
 */
import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';

export interface DeviseSeedRow {
  codeIso: string;
  libelle: string;
  symbole: string | null;
  nbDecimales: number;
  estDevisePivot: boolean;
}

export const DEVISES_INITIALES: readonly DeviseSeedRow[] = [
  {
    codeIso: 'XOF',
    libelle: 'Franc CFA BCEAO',
    symbole: 'F CFA',
    nbDecimales: 0,
    estDevisePivot: true,
  },
  {
    codeIso: 'EUR',
    libelle: 'Euro',
    symbole: '€',
    nbDecimales: 2,
    estDevisePivot: false,
  },
  {
    codeIso: 'USD',
    libelle: 'Dollar US',
    symbole: '$',
    nbDecimales: 2,
    estDevisePivot: false,
  },
  {
    codeIso: 'GBP',
    libelle: 'Livre sterling',
    symbole: '£',
    nbDecimales: 2,
    estDevisePivot: false,
  },
  {
    codeIso: 'NGN',
    libelle: 'Naira nigérian',
    symbole: '₦',
    nbDecimales: 2,
    estDevisePivot: false,
  },
  {
    codeIso: 'GHS',
    libelle: 'Cedi ghanéen',
    symbole: '₵',
    nbDecimales: 2,
    estDevisePivot: false,
  },
  {
    codeIso: 'CNY',
    libelle: 'Yuan renminbi',
    symbole: '¥',
    nbDecimales: 2,
    estDevisePivot: false,
  },
];

export async function seedDevises(
  ds: DataSource = AppDataSource,
): Promise<void> {
  const ownsConnection = !ds.isInitialized;
  if (ownsConnection) {
    await ds.initialize();
  }
  try {
    const force = process.argv.slice(2).includes('--force');
    if (force) {
      console.log(
        '[seed:devises] --force : purge de dim_devise avant régénération',
      );
      await ds.query(`DELETE FROM dim_devise`);
    }

    for (const d of DEVISES_INITIALES) {
      await ds.query(
        `INSERT INTO dim_devise
          ("code_iso","libelle","symbole","nb_decimales",
           "est_devise_pivot","est_active","utilisateur_creation")
         VALUES ($1, $2, $3, $4, $5, true, 'system')
         ON CONFLICT ("code_iso") DO NOTHING`,
        [d.codeIso, d.libelle, d.symbole, d.nbDecimales, d.estDevisePivot],
      );
    }

    const stats = await ds.query(
      `SELECT
         (SELECT COUNT(*)::int FROM dim_devise) AS total,
         (SELECT COUNT(*)::int FROM dim_devise WHERE est_devise_pivot = true) AS pivots`,
    );
    const row = stats[0] as { total: number; pivots: number };
    console.log(
      `[seed:devises] total=${row.total} pivots=${row.pivots} (attendu : 7 / 1)`,
    );
  } finally {
    if (ownsConnection) {
      await ds.destroy();
    }
  }
}

if (require.main === module) {
  seedDevises()
    .then(() => {
      console.log('[seed:devises] Done.');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[seed:devises] Failed:', err);
      process.exit(1);
    });
}
