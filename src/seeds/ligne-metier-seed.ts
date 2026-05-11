/**
 * Seed pédagogique de `dim_ligne_metier`.
 *
 * Sous-ensemble représentatif (12 lignes : 4 racines + 8 sous-axes)
 * structuré pour les démos et tests. La banque cliente peut adapter
 * en production via les routes CRUD `/api/v1/referentiels/lignes-metier`.
 *
 * Référence : `docs/modele-donnees.md` §3.5
 */
import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';

export interface LigneMetierSeedRow {
  codeLigneMetier: string;
  libelle: string;
  niveau: number;
  /** Code business du parent ; null pour les racines. */
  parentCode: string | null;
}

function row(
  codeLigneMetier: string,
  libelle: string,
  niveau: number,
  parentCode: string | null,
): LigneMetierSeedRow {
  return { codeLigneMetier, libelle, niveau, parentCode };
}

/**
 * Hiérarchie ordonnée — parents avant enfants.
 */
export const LIGNES_METIER_INITIALES: readonly LigneMetierSeedRow[] = [
  // ─── Niveau 1 : 4 racines (axes d'activité bancaire)
  row('RETAIL', 'Banque de détail', 1, null),
  row('CORPORATE', "Banque d'entreprise", 1, null),
  row('TRESORERIE', 'Trésorerie et marchés', 1, null),
  row('SUPPORT', 'Fonctions support', 1, null),

  // ─── Niveau 2 : sous-axes
  // Retail
  row('RETAIL_PARTICULIERS', 'Particuliers', 2, 'RETAIL'),
  row('RETAIL_PRO', 'Professionnels', 2, 'RETAIL'),
  // Corporate
  row('CORPORATE_PME', 'PME', 2, 'CORPORATE'),
  row('CORPORATE_GRANDE_ENTREPRISE', 'Grandes entreprises', 2, 'CORPORATE'),
  // Trésorerie
  row('TRESORERIE_INTERBANCAIRE', 'Marché interbancaire', 2, 'TRESORERIE'),
  row('TRESORERIE_OBLIGATAIRE', 'Marché obligataire', 2, 'TRESORERIE'),
  // Support
  row('SUPPORT_IT', "Système d'information", 2, 'SUPPORT'),
  row('SUPPORT_RH', 'Ressources humaines', 2, 'SUPPORT'),
];

export async function seedLignesMetier(
  ds: DataSource = AppDataSource,
): Promise<void> {
  const ownsConnection = !ds.isInitialized;
  if (ownsConnection) {
    await ds.initialize();
  }
  try {
    const force = process.argv.slice(2).includes('--force');
    if (force) {
      console.log('[seed:lignes-metier] --force : purge de dim_ligne_metier');
      await ds.query(
        `UPDATE dim_ligne_metier SET fk_ligne_metier_parent = NULL`,
      );
      await ds.query(`DELETE FROM dim_ligne_metier`);
    }

    const today = new Date().toISOString().slice(0, 10);
    const idByCode = new Map<string, string>();

    for (const l of LIGNES_METIER_INITIALES) {
      const existing = (await ds.query(
        `SELECT id FROM dim_ligne_metier WHERE code_ligne_metier = $1 AND version_courante = true`,
        [l.codeLigneMetier],
      )) as Array<{ id: string }>;
      if (existing.length > 0) {
        idByCode.set(l.codeLigneMetier, String(existing[0]!.id));
        continue;
      }

      let parentId: string | null = null;
      if (l.parentCode) {
        const cached = idByCode.get(l.parentCode);
        if (!cached) {
          throw new Error(
            `[seed:lignes-metier] Parent ${l.parentCode} introuvable pour ${l.codeLigneMetier} — vérifier l'ordre.`,
          );
        }
        parentId = cached;
      }

      await ds.query(
        `INSERT INTO dim_ligne_metier
          ("code_ligne_metier","libelle","fk_ligne_metier_parent","niveau",
           "date_debut_validite","date_fin_validite",
           "version_courante","est_actif","utilisateur_creation")
         VALUES ($1,$2,$3,$4,$5,NULL,true,true,'system')`,
        [l.codeLigneMetier, l.libelle, parentId, l.niveau, today],
      );
      const inserted = (await ds.query(
        `SELECT id FROM dim_ligne_metier WHERE code_ligne_metier = $1 AND version_courante = true`,
        [l.codeLigneMetier],
      )) as Array<{ id: string }>;
      idByCode.set(l.codeLigneMetier, String(inserted[0]!.id));
    }

    const stats = await ds.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE version_courante = true)::int AS courants,
         COUNT(*) FILTER (WHERE fk_ligne_metier_parent IS NULL AND version_courante = true)::int AS racines
       FROM dim_ligne_metier`,
    );
    const r0 = stats[0] as { total: number; courants: number; racines: number };
    console.log(
      `[seed:lignes-metier] total=${r0.total} courants=${r0.courants} racines=${r0.racines} (attendu : ${LIGNES_METIER_INITIALES.length} / ${LIGNES_METIER_INITIALES.length} / 4)`,
    );
  } finally {
    if (ownsConnection) {
      await ds.destroy();
    }
  }
}

if (require.main === module) {
  seedLignesMetier()
    .then(() => {
      console.log('[seed:lignes-metier] Done.');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[seed:lignes-metier] Failed:', err);
      process.exit(1);
    });
}
