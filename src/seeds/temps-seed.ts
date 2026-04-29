/**
 * Seed du calendrier (`dim_temps`) — 10 ans glissants UEMOA.
 *
 * - Génère un jour par date du 01/01/(annee_courante - 5) au
 *   31/12/(annee_courante + 4).
 * - `jour_ouvre = false` pour : samedi, dimanche, et 4 fériés
 *   régionaux UEMOA fixes (1er janvier, 1er mai, 1er août, 25 décembre).
 * - Fériés mobiles ignorés au Lot 2 (Pâques, Aïd, Tabaski) — TODO V2 :
 *   calendrier dérivé par pays via `ref_calendrier_pays`.
 * - `exercice_fiscal = annee` (UEMOA = exercice civil).
 * - `libelle_mois` en français via map manuelle (PAS Intl pour éviter
 *   la dépendance aux locales du serveur).
 * - Idempotent : `ON CONFLICT (date) DO NOTHING`.
 */
import 'reflect-metadata';
import { AppDataSource } from '../data-source';

const LIBELLES_MOIS_FR: readonly string[] = [
  'Janv.',
  'Févr.',
  'Mars',
  'Avr.',
  'Mai',
  'Juin',
  'Juil.',
  'Août',
  'Sept.',
  'Oct.',
  'Nov.',
  'Déc.',
];

interface FixedHoliday {
  month: number;
  day: number;
}

/** Fériés fixes UEMOA pris en compte au Lot 2. */
export const HOLIDAYS_UMOA: readonly FixedHoliday[] = [
  { month: 1, day: 1 }, // Nouvel An
  { month: 5, day: 1 }, // Fête du Travail
  { month: 8, day: 1 }, // Journée de l'Indépendance UMOA
  { month: 12, day: 25 }, // Noël
];

export interface TempsRowInput {
  date: string;
  annee: number;
  trimestre: number;
  mois: number;
  jour: number;
  semaineIso: number;
  jourOuvre: boolean;
  estFinDeMois: boolean;
  estFinDeTrimestre: boolean;
  estFinDAnnee: boolean;
  exerciceFiscal: number;
  libelleMois: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function libelleMois(annee: number, mois: number): string {
  return `${LIBELLES_MOIS_FR[mois - 1]} ${annee}`;
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function isFerieFixe(date: Date): boolean {
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return HOLIDAYS_UMOA.some((h) => h.month === m && h.day === d);
}

/**
 * Calcul du n° de semaine ISO 8601 sans dépendance externe.
 * (Algorithme classique : décale au jeudi le plus proche, divise par 7.)
 */
export function isoWeek(date: Date): number {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
}

export function trimestre(mois: number): number {
  return Math.ceil(mois / 3);
}

/**
 * Génère toutes les lignes du calendrier entre les deux années (incluses).
 * Pure fonction sans I/O — testée directement par `temps-seed.spec.ts`.
 */
export function generateTempsRows(
  startYear: number,
  endYear: number,
): TempsRowInput[] {
  const rows: TempsRowInput[] = [];

  const start = new Date(Date.UTC(startYear, 0, 1));
  const end = new Date(Date.UTC(endYear, 11, 31));

  for (
    let cur = new Date(start);
    cur.getTime() <= end.getTime();
    cur.setUTCDate(cur.getUTCDate() + 1)
  ) {
    const annee = cur.getUTCFullYear();
    const mois = cur.getUTCMonth() + 1;
    const jour = cur.getUTCDate();
    const dateStr = `${annee}-${pad2(mois)}-${pad2(jour)}`;
    const ouvre = !isWeekend(cur) && !isFerieFixe(cur);

    rows.push({
      date: dateStr,
      annee,
      trimestre: trimestre(mois),
      mois,
      jour,
      semaineIso: isoWeek(cur),
      jourOuvre: ouvre,
      estFinDeMois: false,
      estFinDeTrimestre: false,
      estFinDAnnee: false,
      exerciceFiscal: annee,
      libelleMois: libelleMois(annee, mois),
    });
  }

  // Marquage des fins de période : on parcourt depuis la fin et on
  // marque la première occurrence `jourOuvre=true` rencontrée par
  // mois / trimestre / année — c'est par construction le dernier jour
  // ouvré de la période.
  let lastMonthKey = -1;
  let lastTrimKey = -1;
  let lastYearKey = -1;

  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (!r.jourOuvre) continue;

    const monthKey = r.annee * 100 + r.mois;
    const trimKey = r.annee * 10 + r.trimestre;
    const yearKey = r.annee;

    if (lastMonthKey !== monthKey) {
      r.estFinDeMois = true;
      lastMonthKey = monthKey;
    }
    if (lastTrimKey !== trimKey) {
      r.estFinDeTrimestre = true;
      lastTrimKey = trimKey;
    }
    if (lastYearKey !== yearKey) {
      r.estFinDAnnee = true;
      lastYearKey = yearKey;
    }
  }

  return rows;
}

export function defaultRange(
  now: Date = new Date(),
): { startYear: number; endYear: number } {
  const cur = now.getUTCFullYear();
  return { startYear: cur - 5, endYear: cur + 4 };
}

async function seedTemps(): Promise<void> {
  await AppDataSource.initialize();

  try {
    const { startYear, endYear } = defaultRange();
    const rows = generateTempsRows(startYear, endYear);

    // Insert par lots pour éviter une requête de plusieurs Mo.
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const values: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      for (const r of slice) {
        values.push(
          `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
        );
        params.push(
          r.date,
          r.annee,
          r.trimestre,
          r.mois,
          r.jour,
          r.semaineIso,
          r.jourOuvre,
          r.estFinDeMois,
          r.estFinDeTrimestre,
          r.estFinDAnnee,
          r.exerciceFiscal,
          r.libelleMois,
        );
      }
      const result = await AppDataSource.query(
        `INSERT INTO "dim_temps"
         ("date","annee","trimestre","mois","jour","semaine_iso",
          "jour_ouvre","est_fin_de_mois","est_fin_de_trimestre",
          "est_fin_d_annee","exercice_fiscal","libelle_mois")
         VALUES ${values.join(',')}
         ON CONFLICT ("date") DO NOTHING`,
        params,
      );
      const affected = Array.isArray(result) ? slice.length : (result ?? slice.length);
      inserted += typeof affected === 'number' ? affected : slice.length;
    }

    const stats = await AppDataSource.query(
      `SELECT COUNT(*)::int AS total FROM "dim_temps"`,
    );
    const total = (stats[0] as { total: number }).total;
    console.log(
      `[seed:temps] period=${startYear}-${endYear} generated=${rows.length} table_total=${total}`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  seedTemps()
    .then(() => {
      console.log('[seed:temps] Done.');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[seed:temps] Failed:', err);
      process.exit(1);
    });
}
