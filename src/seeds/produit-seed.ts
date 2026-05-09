/**
 * Seed pédagogique de `dim_produit`.
 *
 * Sous-ensemble représentatif (~25 produits sur 3 niveaux) des produits
 * bancaires UEMOA : crédits, dépôts, services, opérations de marché.
 * La banque cliente peut adapter en production via les routes CRUD
 * `/api/v1/referentiels/produits`.
 *
 * Référence : `docs/modele-donnees.md` §3.6
 */
import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import type { TypeProduit } from '../referentiels/produit/entities/dim-produit.entity';

export interface ProduitSeedRow {
  codeProduit: string;
  libelle: string;
  typeProduit: TypeProduit;
  niveau: number;
  parentCode: string | null;
  estPorteurInterets: boolean;
}

function row(
  codeProduit: string,
  libelle: string,
  typeProduit: TypeProduit,
  niveau: number,
  parentCode: string | null,
  estPorteurInterets = false,
): ProduitSeedRow {
  return {
    codeProduit,
    libelle,
    typeProduit,
    niveau,
    parentCode,
    estPorteurInterets,
  };
}

/**
 * Hiérarchie ordonnée — parents avant enfants.
 */
export const PRODUITS_INITIAUX: readonly ProduitSeedRow[] = [
  // ─── Niveau 1 : 4 racines (par type_produit)
  row('CREDIT_GRP', 'Crédits', 'credit', 1, null),
  row('DEPOT_GRP', 'Dépôts', 'depot', 1, null),
  row('SERVICE_GRP', 'Services bancaires', 'service', 1, null),
  row('MARCHE_GRP', 'Opérations de marché', 'marche', 1, null),

  // ─── Niveau 2 : sous-types
  // Sous CREDIT_GRP
  row('CREDIT_TRESORERIE', 'Crédits de trésorerie (CT)', 'credit', 2, 'CREDIT_GRP'),
  row('CREDIT_INVESTISSEMENT', "Crédits d'investissement (MT/LT)", 'credit', 2, 'CREDIT_GRP'),
  row('CREDIT_IMMOBILIER', 'Crédits immobiliers (LT)', 'credit', 2, 'CREDIT_GRP'),
  row('CREDIT_CONSO', 'Crédits à la consommation', 'credit', 2, 'CREDIT_GRP'),
  // Sous DEPOT_GRP
  row('DEPOT_VUE', 'Dépôts à vue', 'depot', 2, 'DEPOT_GRP'),
  row('DEPOT_TERME', 'Dépôts à terme', 'depot', 2, 'DEPOT_GRP'),
  row('DEPOT_EPARGNE', 'Épargne réglementée', 'depot', 2, 'DEPOT_GRP'),
  // Sous SERVICE_GRP
  row('SERV_MOYENS_PAIEMENT', 'Moyens de paiement', 'service', 2, 'SERVICE_GRP'),
  row('SERV_BANQUE_DIGITALE', 'Banque digitale', 'service', 2, 'SERVICE_GRP'),
  row('SERV_GESTION_PATRIMOINE', 'Gestion de patrimoine', 'service', 2, 'SERVICE_GRP'),
  // Sous MARCHE_GRP
  row('MARCHE_FOREX', 'Change (FOREX)', 'marche', 2, 'MARCHE_GRP'),
  row('MARCHE_TITRES', 'Titres', 'marche', 2, 'MARCHE_GRP'),
  row('MARCHE_DERIVES', 'Dérivés', 'marche', 2, 'MARCHE_GRP'),

  // ─── Niveau 3 : produits feuille
  // Crédits trésorerie
  row('CREDIT_DECOUVERT', 'Découverts', 'credit', 3, 'CREDIT_TRESORERIE', true),
  row('CREDIT_ESCOMPTE', 'Escomptes commerciaux', 'credit', 3, 'CREDIT_TRESORERIE', true),
  // Crédits immobiliers
  row('CREDIT_IMMO_RESIDENTIEL', 'Crédit immobilier résidentiel', 'credit', 3, 'CREDIT_IMMOBILIER', true),
  row('CREDIT_IMMO_LOCATIF', 'Crédit immobilier locatif', 'credit', 3, 'CREDIT_IMMOBILIER', true),
  // Dépôts à terme
  row('DAT_3M', 'DAT 3 mois', 'depot', 3, 'DEPOT_TERME', true),
  row('DAT_12M', 'DAT 12 mois', 'depot', 3, 'DEPOT_TERME', true),
  // Épargne
  row('LIVRET_A', "Livret d'épargne A", 'depot', 3, 'DEPOT_EPARGNE', true),
  // Marché FOREX
  row('FOREX_SPOT', 'Change au comptant', 'marche', 3, 'MARCHE_FOREX', false),
  row('FOREX_TERME', 'Change à terme', 'marche', 3, 'MARCHE_FOREX', true),

  // ─── Sentinelle PRODUIT_TRANSVERSE (Lot 2.5C)
  // Produit racine pour les charges sans produit bancaire associé
  // (achats IT, RH, immobilier, frais généraux). Permet de respecter
  // la contrainte NOT NULL de fk_produit dans fait_budget tout en
  // gardant une sémantique honnête.
  //
  // Type 'autre' retenu (ref_type_produit n'a pas de code 'support' ;
  // l'ajouter demanderait d'assouplir le DTO backend qui contient un
  // IsIn strict — décision repoussée à 2.5-bis-F ou Lot 6).
  row(
    'PRODUIT_TRANSVERSE',
    'Produit transverse (charges support)',
    'autre',
    1,
    null,
    false,
  ),
];

export async function seedProduits(ds: DataSource = AppDataSource): Promise<void> {
  const ownsConnection = !ds.isInitialized;
  if (ownsConnection) {
    await ds.initialize();
  }
  try {
    const force = process.argv.slice(2).includes('--force');
    if (force) {
      console.log('[seed:produits] --force : purge de dim_produit');
      await ds.query(
        `UPDATE dim_produit SET fk_produit_parent = NULL`,
      );
      await ds.query(`DELETE FROM dim_produit`);
    }

    const today = new Date().toISOString().slice(0, 10);
    const idByCode = new Map<string, string>();

    for (const p of PRODUITS_INITIAUX) {
      const existing = (await ds.query(
        `SELECT id FROM dim_produit WHERE code_produit = $1 AND version_courante = true`,
        [p.codeProduit],
      )) as Array<{ id: string }>;
      if (existing.length > 0) {
        idByCode.set(p.codeProduit, String(existing[0]!.id));
        continue;
      }

      let parentId: string | null = null;
      if (p.parentCode) {
        const cached = idByCode.get(p.parentCode);
        if (!cached) {
          throw new Error(
            `[seed:produits] Parent ${p.parentCode} introuvable pour ${p.codeProduit}.`,
          );
        }
        parentId = cached;
      }

      await ds.query(
        `INSERT INTO dim_produit
          ("code_produit","libelle","type_produit","fk_produit_parent","niveau",
           "est_porteur_interets","date_debut_validite","date_fin_validite",
           "version_courante","est_actif","utilisateur_creation")
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,true,true,'system')`,
        [
          p.codeProduit,
          p.libelle,
          p.typeProduit,
          parentId,
          p.niveau,
          p.estPorteurInterets,
          today,
        ],
      );
      const inserted = (await ds.query(
        `SELECT id FROM dim_produit WHERE code_produit = $1 AND version_courante = true`,
        [p.codeProduit],
      )) as Array<{ id: string }>;
      idByCode.set(p.codeProduit, String(inserted[0]!.id));
    }

    const stats = await ds.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE version_courante = true)::int AS courants,
         COUNT(*) FILTER (WHERE fk_produit_parent IS NULL AND version_courante = true)::int AS racines,
         COUNT(*) FILTER (WHERE est_porteur_interets = true AND version_courante = true)::int AS porteurs
       FROM dim_produit`,
    );
    const r0 = stats[0] as {
      total: number;
      courants: number;
      racines: number;
      porteurs: number;
    };
    const racinesAttendues = PRODUITS_INITIAUX.filter(
      (p) => p.parentCode === null,
    ).length;
    console.log(
      `[seed:produits] total=${r0.total} courants=${r0.courants} racines=${r0.racines} porteurs_interets=${r0.porteurs} (attendu : ${PRODUITS_INITIAUX.length} / ${PRODUITS_INITIAUX.length} / ${racinesAttendues})`,
    );
  } finally {
    if (ownsConnection) {
      await ds.destroy();
    }
  }
}

if (require.main === module) {
  seedProduits()
    .then(() => {
      console.log('[seed:produits] Done.');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[seed:produits] Failed:', err);
      process.exit(1);
    });
}
