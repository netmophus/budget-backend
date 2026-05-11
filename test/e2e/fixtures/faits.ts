/**
 * Fixtures e2e pour faits (fait_budget, fait_realise) et statut
 * version. Utilisés en pré-requis pour E2E.4 (workflow version) et
 * E2E.5 (reforecast).
 *
 * Convention : "in-process pour pré-requis" (cf. feedback memory).
 * L'objet du test (POST /reforecast/lancer, POST /:id/soumettre,
 * etc.) reste exécuté via SuperTest HTTP réel.
 */
import type { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

export interface InsertFaitBudgetParams {
  fkVersion: string;
  fkScenario: string;
  fkCentreResponsabilite: string;
  fkCompte: string;
  fkLigneMetier: string;
  fkTemps: string;
  fkDevise: string;
  /** Code business du produit (ex: 'CREDIT_GRP'). */
  codeProduit?: string;
  /** Code business du segment (ex: 'PARTICULIER'). */
  codeSegment?: string;
  montant: number;
}

export async function insertFaitBudget(
  app: INestApplication,
  params: InsertFaitBudgetParams,
): Promise<string> {
  const ds = app.get<DataSource>(getDataSourceToken());
  const codeProduit = params.codeProduit ?? 'CREDIT_GRP';
  const codeSegment = params.codeSegment ?? 'PARTICULIER';

  // Résolution des FK indirectes (structure parente du CR + produit + segment).
  const meta = (await ds.query(
    `SELECT
       (SELECT fk_structure FROM dim_centre_responsabilite WHERE id = $1) AS fk_structure,
       (SELECT id FROM dim_produit WHERE code_produit = $2 AND version_courante = true) AS fk_produit,
       (SELECT id FROM dim_segment WHERE code_segment = $3 AND version_courante = true) AS fk_segment`,
    [params.fkCentreResponsabilite, codeProduit, codeSegment],
  )) as Array<{ fk_structure: string; fk_produit: string; fk_segment: string }>;

  if (
    !meta[0] ||
    !meta[0].fk_structure ||
    !meta[0].fk_produit ||
    !meta[0].fk_segment
  ) {
    throw new Error(
      `[e2e fixture insertFaitBudget] FK indirectes introuvables : structure=${meta[0]?.fk_structure}, produit=${meta[0]?.fk_produit}, segment=${meta[0]?.fk_segment}`,
    );
  }

  const inserted = (await ds.query(
    `INSERT INTO fait_budget
       (fk_temps, fk_compte, fk_structure, fk_centre, fk_ligne_metier,
        fk_produit, fk_segment, fk_devise, fk_version, fk_scenario,
        montant_devise, montant_fcfa, taux_change_applique, utilisateur_creation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, 1, 'system (e2e fixture)')
     RETURNING id`,
    [
      params.fkTemps,
      params.fkCompte,
      meta[0].fk_structure,
      params.fkCentreResponsabilite,
      params.fkLigneMetier,
      meta[0].fk_produit,
      meta[0].fk_segment,
      params.fkDevise,
      params.fkVersion,
      params.fkScenario,
      params.montant,
    ],
  )) as Array<{ id: string }>;
  return String(inserted[0]!.id);
}

export interface InsertFaitRealiseParams {
  fkCentreResponsabilite: string;
  fkCompte: string;
  fkLigneMetier: string;
  fkTemps: string;
  fkDevise: string;
  montant: number;
  /** Si fourni : insère statut=VALIDE avec fk_valide_par + valide_le NOW(). */
  fkValidePar?: string;
}

export async function insertFaitRealise(
  app: INestApplication,
  params: InsertFaitRealiseParams,
): Promise<string> {
  const ds = app.get<DataSource>(getDataSourceToken());
  const valide = params.fkValidePar !== undefined;
  const inserted = (await ds.query(
    `INSERT INTO fait_realise
       (fk_centre_responsabilite, fk_compte, fk_ligne_metier, fk_temps,
        fk_devise, montant, source, statut, valide_le, fk_valide_par,
        utilisateur_creation)
     VALUES ($1, $2, $3, $4, $5, $6, 'SAISIE',
             ${valide ? `'VALIDE'` : `'IMPORTE'`},
             ${valide ? `NOW()` : `NULL`},
             ${valide ? `$7` : `NULL`},
             'system (e2e fixture)')
     RETURNING id`,
    valide
      ? [
          params.fkCentreResponsabilite,
          params.fkCompte,
          params.fkLigneMetier,
          params.fkTemps,
          params.fkDevise,
          params.montant,
          params.fkValidePar,
        ]
      : [
          params.fkCentreResponsabilite,
          params.fkCompte,
          params.fkLigneMetier,
          params.fkTemps,
          params.fkDevise,
          params.montant,
        ],
  )) as Array<{ id: string }>;
  return String(inserted[0]!.id);
}

/**
 * Force directement le statut d'une version sans passer par le
 * workflow HTTP (utile pour les pré-requis : on a besoin d'une
 * version `gele` pour POST /reforecast/lancer sans avoir à
 * exécuter le workflow complet).
 */
export async function setVersionStatut(
  app: INestApplication,
  fkVersion: string,
  statut: 'ouvert' | 'soumis' | 'valide' | 'gele',
): Promise<void> {
  const ds = app.get<DataSource>(getDataSourceToken());
  await ds.query(`UPDATE dim_version SET statut = $1 WHERE id = $2`, [
    statut,
    fkVersion,
  ]);
}
