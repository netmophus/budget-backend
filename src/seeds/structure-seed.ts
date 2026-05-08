/**
 * Seed `dim_structure` — banque pilote fictive UEMOA (cf. brief 2.3A §7).
 *
 * Hiérarchie 5 niveaux :
 *  1. SOC_BANK_UEMOA            (entité juridique, multi-pays)
 *  2. BR_CIV / BR_SEN / BR_BFA  (branches par pays)
 *  3. DIR_CIV_RETAIL / DIR_CIV_CORPORATE (directions sous CIV)
 *  4. DEPT_CIV_PARTICULIERS     (département sous DIR_CIV_RETAIL)
 *  5. AG_ABJ_PLATEAU / AG_ABJ_COCODY (agences sous le département)
 *
 * Idempotent : insère uniquement les codes qui n'ont pas déjà une
 * version courante. Mode `--force` : purge `dim_structure` avant
 * régénération (utile en dev/test).
 *
 * Ordre d'insertion strict : parents avant enfants (FK
 * fk_structure_parent → dim_structure(id) ON DELETE RESTRICT).
 */
import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import {
  CodePaysUemoa,
  TypeStructure,
} from '../referentiels/structure/entities/dim-structure.entity';

export interface StructureSeedRow {
  codeStructure: string;
  libelle: string;
  libelleCourt: string | null;
  typeStructure: TypeStructure;
  niveauHierarchique: number;
  /** Code business du parent ; null pour les racines. */
  parentCode: string | null;
  codePays: CodePaysUemoa | null;
}

/**
 * Hiérarchie initiale, ordonnée parents avant enfants. Cet ordre est
 * exploité par le seed pour résoudre les FK au fil de l'insertion.
 */
export const STRUCTURES_INITIALES: readonly StructureSeedRow[] = [
  {
    codeStructure: 'SOC_BANK_UEMOA',
    libelle: 'Banque Pilote UEMOA',
    libelleCourt: 'BPU',
    typeStructure: 'entite_juridique',
    niveauHierarchique: 1,
    parentCode: null,
    codePays: null,
  },
  {
    codeStructure: 'BR_CIV',
    libelle: "Branche Côte d'Ivoire",
    libelleCourt: 'BR CIV',
    typeStructure: 'branche',
    niveauHierarchique: 2,
    parentCode: 'SOC_BANK_UEMOA',
    codePays: 'CIV',
  },
  {
    codeStructure: 'BR_SEN',
    libelle: 'Branche Sénégal',
    libelleCourt: 'BR SEN',
    typeStructure: 'branche',
    niveauHierarchique: 2,
    parentCode: 'SOC_BANK_UEMOA',
    codePays: 'SEN',
  },
  {
    codeStructure: 'BR_BFA',
    libelle: 'Branche Burkina Faso',
    libelleCourt: 'BR BFA',
    typeStructure: 'branche',
    niveauHierarchique: 2,
    parentCode: 'SOC_BANK_UEMOA',
    codePays: 'BFA',
  },
  {
    codeStructure: 'DIR_CIV_RETAIL',
    libelle: "Direction Retail Côte d'Ivoire",
    libelleCourt: 'DIR Retail CIV',
    typeStructure: 'direction',
    niveauHierarchique: 3,
    parentCode: 'BR_CIV',
    codePays: 'CIV',
  },
  {
    codeStructure: 'DIR_CIV_CORPORATE',
    libelle: "Direction Corporate Côte d'Ivoire",
    libelleCourt: 'DIR Corp. CIV',
    typeStructure: 'direction',
    niveauHierarchique: 3,
    parentCode: 'BR_CIV',
    codePays: 'CIV',
  },
  {
    codeStructure: 'DEPT_CIV_PARTICULIERS',
    libelle: 'Département Particuliers CIV',
    libelleCourt: 'Dept. Part.',
    typeStructure: 'departement',
    niveauHierarchique: 4,
    parentCode: 'DIR_CIV_RETAIL',
    codePays: 'CIV',
  },
  {
    codeStructure: 'AG_ABJ_PLATEAU',
    libelle: 'Agence Abidjan Plateau',
    libelleCourt: 'Ag. Plateau',
    typeStructure: 'agence',
    niveauHierarchique: 5,
    parentCode: 'DEPT_CIV_PARTICULIERS',
    codePays: 'CIV',
  },
  {
    codeStructure: 'AG_ABJ_COCODY',
    libelle: 'Agence Abidjan Cocody',
    libelleCourt: 'Ag. Cocody',
    typeStructure: 'agence',
    niveauHierarchique: 5,
    parentCode: 'DEPT_CIV_PARTICULIERS',
    codePays: 'CIV',
  },
];

export async function seedStructures(ds: DataSource = AppDataSource): Promise<void> {
  const ownsConnection = !ds.isInitialized;
  if (ownsConnection) {
    await ds.initialize();
  }
  try {
    const force = process.argv.slice(2).includes('--force');
    if (force) {
      console.log(
        '[seed:structures] --force : purge de dim_structure avant régénération',
      );
      await ds.query(`DELETE FROM dim_structure`);
    }

    const today = new Date().toISOString().slice(0, 10);
    /** Cache code → id pour résoudre les FK au fil de l'insertion. */
    const idByCode = new Map<string, string>();

    for (const s of STRUCTURES_INITIALES) {
      // Idempotence : sauter si une version courante existe déjà.
      const existing = (await ds.query(
        `SELECT id FROM dim_structure WHERE code_structure = $1 AND version_courante = true`,
        [s.codeStructure],
      )) as Array<{ id: string }>;
      if (existing.length > 0) {
        idByCode.set(s.codeStructure, String(existing[0]!.id));
        continue;
      }

      // Résoudre la FK parent depuis le cache (ordre strict garanti
      // par STRUCTURES_INITIALES).
      let parentId: string | null = null;
      if (s.parentCode) {
        const cached = idByCode.get(s.parentCode);
        if (!cached) {
          throw new Error(
            `[seed:structures] Parent ${s.parentCode} introuvable pour ${s.codeStructure} — vérifier l'ordre de STRUCTURES_INITIALES.`,
          );
        }
        parentId = cached;
      }

      await ds.query(
        `INSERT INTO dim_structure
           ("code_structure","libelle","libelle_court","type_structure",
            "niveau_hierarchique","fk_structure_parent","code_pays",
            "date_debut_validite","date_fin_validite","version_courante",
            "est_actif","utilisateur_creation")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,true,true,'system')`,
        [
          s.codeStructure,
          s.libelle,
          s.libelleCourt,
          s.typeStructure,
          s.niveauHierarchique,
          parentId,
          s.codePays,
          today,
        ],
      );

      const inserted = (await ds.query(
        `SELECT id FROM dim_structure WHERE code_structure = $1 AND version_courante = true`,
        [s.codeStructure],
      )) as Array<{ id: string }>;
      idByCode.set(s.codeStructure, String(inserted[0]!.id));
    }

    const stats = await ds.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE version_courante = true)::int AS courantes,
         COUNT(*) FILTER (WHERE fk_structure_parent IS NULL)::int AS racines
       FROM dim_structure`,
    );
    const row = stats[0] as { total: number; courantes: number; racines: number };
    console.log(
      `[seed:structures] total=${row.total} courantes=${row.courantes} racines=${row.racines} (attendu : 9 / 9 / 1)`,
    );
  } finally {
    if (ownsConnection) {
      await ds.destroy();
    }
  }
}

if (require.main === module) {
  seedStructures()
    .then(() => {
      console.log('[seed:structures] Done.');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[seed:structures] Failed:', err);
      process.exit(1);
    });
}
