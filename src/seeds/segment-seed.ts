/**
 * Seed pédagogique de `dim_segment`.
 *
 * 6 segments — Option A retenue (strictement plat, cf.
 * `docs/modele-donnees.md` §3.7). Les codes correspondent
 * exactement aux 6 valeurs de l'enum `categorie`.
 */
import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import type { CategorieSegment } from '../referentiels/segment/entities/dim-segment.entity';

export interface SegmentSeedRow {
  codeSegment: string;
  libelle: string;
  categorie: CategorieSegment;
}

export const SEGMENTS_INITIAUX: readonly SegmentSeedRow[] = [
  { codeSegment: 'PARTICULIER', libelle: 'Particuliers', categorie: 'particulier' },
  { codeSegment: 'PROFESSIONNEL', libelle: 'Professionnels (artisans, commerçants)', categorie: 'professionnel' },
  { codeSegment: 'PME', libelle: 'Petites et moyennes entreprises', categorie: 'pme' },
  { codeSegment: 'GRANDE_ENTREPRISE', libelle: 'Grandes entreprises', categorie: 'grande_entreprise' },
  { codeSegment: 'INSTITUTIONNEL', libelle: 'Institutionnels (banques, assurances, OPCVM)', categorie: 'institutionnel' },
  { codeSegment: 'SECTEUR_PUBLIC', libelle: 'Secteur public et collectivités', categorie: 'secteur_public' },
];

export async function seedSegments(ds: DataSource = AppDataSource): Promise<void> {
  const ownsConnection = !ds.isInitialized;
  if (ownsConnection) {
    await ds.initialize();
  }
  try {
    const force = process.argv.slice(2).includes('--force');
    if (force) {
      console.log('[seed:segments] --force : purge de dim_segment');
      await ds.query(`DELETE FROM dim_segment`);
    }

    const today = new Date().toISOString().slice(0, 10);
    for (const s of SEGMENTS_INITIAUX) {
      const existing = (await ds.query(
        `SELECT id FROM dim_segment WHERE code_segment = $1 AND version_courante = true`,
        [s.codeSegment],
      )) as Array<{ id: string }>;
      if (existing.length > 0) continue;

      await ds.query(
        `INSERT INTO dim_segment
          ("code_segment","libelle","categorie",
           "date_debut_validite","date_fin_validite",
           "version_courante","est_actif","utilisateur_creation")
         VALUES ($1,$2,$3,$4,NULL,true,true,'system')`,
        [s.codeSegment, s.libelle, s.categorie, today],
      );
    }

    const stats = await ds.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE version_courante = true)::int AS courants
       FROM dim_segment`,
    );
    const r0 = stats[0] as { total: number; courants: number };
    console.log(
      `[seed:segments] total=${r0.total} courants=${r0.courants} (attendu : ${SEGMENTS_INITIAUX.length} / ${SEGMENTS_INITIAUX.length})`,
    );
  } finally {
    if (ownsConnection) {
      await ds.destroy();
    }
  }
}

if (require.main === module) {
  seedSegments()
    .then(() => {
      console.log('[seed:segments] Done.');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[seed:segments] Failed:', err);
      process.exit(1);
    });
}
