/**
 * Seed pédagogique du PCB UMOA RÉVISÉ.
 *
 * Sous-ensemble représentatif (~95 comptes des classes 1, 2, 4, 5, 6, 7)
 * construit pour les tests et démos. Les libellés, numérotations et
 * hiérarchies sont conformes au PCB révisé **dans l'esprit**, MAIS
 * NE FONT PAS FOI : pour la production, la banque cliente doit
 * importer son fichier officiel BCEAO via la route
 * `POST /api/v1/referentiels/comptes/import` (Lot 2.4A.2).
 *
 * Référence : `docs/modele-donnees.md` §3.4
 */
import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import type { SensCompte } from '../referentiels/compte/entities/dim-compte.entity';

export interface CompteSeedRow {
  codeCompte: string;
  libelle: string;
  classe: number;
  niveau: number;
  /** Code business du parent ; null pour les racines de classe. */
  parentCode: string | null;
  sousClasse: string | null;
  sens: SensCompte | null;
  codePosteBudgetaire: string | null;
  estCompteCollectif: boolean;
  estPorteurInterets: boolean;
}

/** Helper concis pour limiter le bruit visuel dans la liste. */
function row(
  codeCompte: string,
  libelle: string,
  classe: number,
  niveau: number,
  parentCode: string | null,
  opts: Partial<Omit<CompteSeedRow, 'codeCompte' | 'libelle' | 'classe' | 'niveau' | 'parentCode'>> = {},
): CompteSeedRow {
  return {
    codeCompte,
    libelle,
    classe,
    niveau,
    parentCode,
    sousClasse: opts.sousClasse ?? null,
    sens: opts.sens ?? null,
    codePosteBudgetaire: opts.codePosteBudgetaire ?? null,
    estCompteCollectif: opts.estCompteCollectif ?? false,
    estPorteurInterets: opts.estPorteurInterets ?? false,
  };
}

/**
 * Hiérarchie ordonnée — parents avant enfants.
 */
export const COMPTES_INITIAUX: readonly CompteSeedRow[] = [
  // ─── Niveau 1 : 6 racines de classe ───────────────────────────────
  row('1', 'OPÉRATIONS DE TRÉSORERIE ET INTERBANCAIRES', 1, 1, null, { estCompteCollectif: true }),
  row('2', 'OPÉRATIONS AVEC LA CLIENTÈLE', 2, 1, null, { estCompteCollectif: true }),
  row('4', 'VALEURS IMMOBILISÉES', 4, 1, null, { estCompteCollectif: true }),
  row('5', 'PROVISIONS, FONDS PROPRES ET ASSIMILÉS', 5, 1, null, { estCompteCollectif: true }),
  row('6', 'CHARGES', 6, 1, null, { sens: 'D', estCompteCollectif: true }),
  row('7', 'PRODUITS', 7, 1, null, { sens: 'C', estCompteCollectif: true }),

  // ─── Niveau 2 : sous-classes ──────────────────────────────────────
  // Classe 1 — Trésorerie
  row('10', 'Caisse et BCEAO', 1, 2, '1', { estCompteCollectif: true }),
  row('11', 'Banques et établissements financiers', 1, 2, '1', { estCompteCollectif: true }),
  row('14', 'Emprunts et titres émis', 1, 2, '1', { estCompteCollectif: true }),
  // Classe 2 — Clientèle
  row('20', 'Crédits à la clientèle', 2, 2, '2', { estCompteCollectif: true }),
  row('25', 'Dépôts de la clientèle', 2, 2, '2', { estCompteCollectif: true }),
  // Classe 4 — Immobilisations
  row('41', 'Immobilisations corporelles', 4, 2, '4', { estCompteCollectif: true }),
  row('44', 'Immobilisations incorporelles', 4, 2, '4', { estCompteCollectif: true }),
  // Classe 5 — Provisions / FP
  row('51', 'Provisions et pertes de valeur', 5, 2, '5', { estCompteCollectif: true }),
  row('55', 'Capitaux propres', 5, 2, '5', { estCompteCollectif: true }),
  // Classe 6 — Charges
  row('60', "Charges d'exploitation bancaire", 6, 2, '6', { sens: 'D', estCompteCollectif: true }),
  row('61', 'Charges de personnel', 6, 2, '6', { sens: 'D', estCompteCollectif: true }),
  row('62', 'Impôts et taxes', 6, 2, '6', { sens: 'D', estCompteCollectif: true }),
  row('63', 'Autres charges externes', 6, 2, '6', { sens: 'D', estCompteCollectif: true }),
  row('67', 'Charges financières', 6, 2, '6', { sens: 'D', estCompteCollectif: true }),
  row('68', 'Dotations aux amortissements et provisions', 6, 2, '6', { sens: 'D', estCompteCollectif: true }),
  // Classe 7 — Produits
  row('70', "Produits d'exploitation bancaire", 7, 2, '7', { sens: 'C', estCompteCollectif: true }),
  row('71', 'Produits accessoires', 7, 2, '7', { sens: 'C', estCompteCollectif: true }),
  row('76', 'Intérêts perçus', 7, 2, '7', { sens: 'C', estCompteCollectif: true }),
  row('77', 'Autres produits divers', 7, 2, '7', { sens: 'C', estCompteCollectif: true }),

  // ─── Niveau 3 : comptes 3 chiffres ────────────────────────────────
  // Classe 1
  row('101', 'Caisses', 1, 3, '10', { estCompteCollectif: true }),
  row('102', 'BCEAO', 1, 3, '10', { estCompteCollectif: true }),
  row('111', 'Banques correspondantes', 1, 3, '11', { estCompteCollectif: true }),
  // Classe 2
  row('201', 'Crédits CT à la clientèle', 2, 3, '20', { estCompteCollectif: true }),
  row('202', 'Crédits MT à la clientèle', 2, 3, '20', { estCompteCollectif: true }),
  row('203', 'Crédits LT à la clientèle', 2, 3, '20', { estCompteCollectif: true }),
  row('251', 'Dépôts à vue', 2, 3, '25', { estCompteCollectif: true }),
  row('252', 'Dépôts à terme', 2, 3, '25', { estCompteCollectif: true }),
  // Classe 6
  row('601', 'Achats consommables', 6, 3, '60', { sens: 'D', estCompteCollectif: true }),
  row('602', 'Services extérieurs', 6, 3, '60', { sens: 'D', estCompteCollectif: true }),
  row('603', 'Autres charges générales', 6, 3, '60', { sens: 'D', estCompteCollectif: true }),
  row('611', 'Rémunérations du personnel', 6, 3, '61', { sens: 'D', estCompteCollectif: true }),
  row('612', 'Charges sociales', 6, 3, '61', { sens: 'D', estCompteCollectif: true }),
  row('613', "Impôts et taxes sur salaires", 6, 3, '61', { sens: 'D', estCompteCollectif: true }),
  row('621', 'Taxes patentes', 6, 3, '62', { sens: 'D', estCompteCollectif: true }),
  row('622', 'Autres impôts et taxes', 6, 3, '62', { sens: 'D', estCompteCollectif: true }),
  row('631', 'Loyers', 6, 3, '63', { sens: 'D', estCompteCollectif: true }),
  row('632', 'Entretien et réparations', 6, 3, '63', { sens: 'D', estCompteCollectif: true }),
  row('633', 'Publicité et communication', 6, 3, '63', { sens: 'D', estCompteCollectif: true }),
  row('634', 'Frais postaux et télécoms', 6, 3, '63', { sens: 'D', estCompteCollectif: true }),
  row('635', 'Assurances', 6, 3, '63', { sens: 'D', estCompteCollectif: true }),
  row('671', "Intérêts sur emprunts", 6, 3, '67', { sens: 'D', estCompteCollectif: true }),
  row('672', 'Autres charges financières', 6, 3, '67', { sens: 'D', estCompteCollectif: true }),
  row('681', 'DAP immobilisations', 6, 3, '68', { sens: 'D', estCompteCollectif: true }),
  row('682', 'DAP créances douteuses', 6, 3, '68', { sens: 'D', estCompteCollectif: true }),
  // Classe 7
  row('701', 'Commissions sur dépôts', 7, 3, '70', { sens: 'C', estCompteCollectif: true }),
  row('702', 'Commissions sur opérations clientèle', 7, 3, '70', { sens: 'C', estCompteCollectif: true }),
  row('703', 'Commissions de change', 7, 3, '70', { sens: 'C', estCompteCollectif: true }),
  row('711', 'Produits de location', 7, 3, '71', { sens: 'C', estCompteCollectif: true }),
  row('712', 'Récupérations de charges', 7, 3, '71', { sens: 'C', estCompteCollectif: true }),
  row('761', 'Intérêts sur prêts CT', 7, 3, '76', { sens: 'C', estCompteCollectif: true, estPorteurInterets: true }),
  row('762', 'Intérêts sur prêts MT/LT', 7, 3, '76', { sens: 'C', estCompteCollectif: true, estPorteurInterets: true }),
  row('763', 'Intérêts opérations interbancaires', 7, 3, '76', { sens: 'C', estCompteCollectif: true, estPorteurInterets: true }),
  row('771', 'Gains de change', 7, 3, '77', { sens: 'C', estCompteCollectif: true }),
  row('772', 'Autres produits divers', 7, 3, '77', { sens: 'C', estCompteCollectif: true }),

  // ─── Niveau 4 : comptes 6 chiffres détaillés (~30) ────────────────
  // Achats / services généraux
  row('601100', 'Fournitures de bureau', 6, 4, '601', { sens: 'D', codePosteBudgetaire: 'ACHATS_DIVERS' }),
  row('601200', 'Petites fournitures techniques', 6, 4, '601', { sens: 'D', codePosteBudgetaire: 'ACHATS_DIVERS' }),
  row('602100', 'Eau et électricité', 6, 4, '602', { sens: 'D', codePosteBudgetaire: 'SERVICES_EXTERIEURS' }),
  row('602200', 'Téléphone et internet', 6, 4, '602', { sens: 'D', codePosteBudgetaire: 'SERVICES_EXTERIEURS' }),
  row('603100', 'Autres charges générales diverses', 6, 4, '603', { sens: 'D', codePosteBudgetaire: 'AUTRES_CHARGES' }),
  // Personnel
  row('611100', 'Salaires bruts', 6, 4, '611', { sens: 'D', codePosteBudgetaire: 'MASSE_SALARIALE' }),
  row('611200', 'Primes et bonus', 6, 4, '611', { sens: 'D', codePosteBudgetaire: 'MASSE_SALARIALE' }),
  row('611300', 'Avantages en nature', 6, 4, '611', { sens: 'D', codePosteBudgetaire: 'MASSE_SALARIALE' }),
  row('612100', 'Cotisations sécurité sociale', 6, 4, '612', { sens: 'D', codePosteBudgetaire: 'CHARGES_SOCIALES' }),
  row('612200', 'Cotisations retraite', 6, 4, '612', { sens: 'D', codePosteBudgetaire: 'CHARGES_SOCIALES' }),
  row('613100', 'Taxes sur salaires', 6, 4, '613', { sens: 'D', codePosteBudgetaire: 'CHARGES_SOCIALES' }),
  // Impôts
  row('621100', 'Patente', 6, 4, '621', { sens: 'D', codePosteBudgetaire: 'IMPOTS_TAXES' }),
  row('622100', 'Autres impôts locaux', 6, 4, '622', { sens: 'D', codePosteBudgetaire: 'IMPOTS_TAXES' }),
  // Charges externes
  row('631100', 'Loyers immobiliers agences', 6, 4, '631', { sens: 'D', codePosteBudgetaire: 'LOYERS' }),
  row('632100', 'Entretien locaux', 6, 4, '632', { sens: 'D', codePosteBudgetaire: 'ENTRETIEN' }),
  row('633100', 'Publicité presse et radio', 6, 4, '633', { sens: 'D', codePosteBudgetaire: 'COMMUNICATION' }),
  row('634100', 'Affranchissements', 6, 4, '634', { sens: 'D', codePosteBudgetaire: 'POSTE_TELECOM' }),
  row('635100', "Assurance multirisque", 6, 4, '635', { sens: 'D', codePosteBudgetaire: 'ASSURANCES' }),
  // Charges financières / dotations
  row('671100', 'Intérêts sur dépôts à terme clientèle', 6, 4, '671', { sens: 'D', codePosteBudgetaire: 'CHARGES_INTERETS', estPorteurInterets: true }),
  row('672100', 'Frais bancaires divers', 6, 4, '672', { sens: 'D', codePosteBudgetaire: 'AUTRES_CHARGES_FIN' }),
  row('681100', 'DAP bâtiments', 6, 4, '681', { sens: 'D', codePosteBudgetaire: 'DAP' }),
  row('682100', 'DAP créances clientèle', 6, 4, '682', { sens: 'D', codePosteBudgetaire: 'DAP' }),
  // Produits de commission
  row('701100', 'Commissions de tenue de compte', 7, 4, '701', { sens: 'C', codePosteBudgetaire: 'COMMISSIONS_DEPOTS' }),
  row('702100', 'Commissions de virements', 7, 4, '702', { sens: 'C', codePosteBudgetaire: 'COMMISSIONS_OPS' }),
  row('703100', 'Marge sur change manuel', 7, 4, '703', { sens: 'C', codePosteBudgetaire: 'COMMISSIONS_CHANGE' }),
  // Produits accessoires
  row('711100', 'Loyers immobiliers perçus', 7, 4, '711', { sens: 'C', codePosteBudgetaire: 'PRODUITS_ACCESSOIRES' }),
  row('712100', 'Refacturations diverses', 7, 4, '712', { sens: 'C', codePosteBudgetaire: 'PRODUITS_ACCESSOIRES' }),
  // Intérêts perçus (porteurs)
  row('761100', 'Intérêts sur prêts particuliers CT', 7, 4, '761', { sens: 'C', codePosteBudgetaire: 'PNB_INTERETS_RETAIL', estPorteurInterets: true }),
  row('761200', 'Intérêts sur prêts entreprises CT', 7, 4, '761', { sens: 'C', codePosteBudgetaire: 'PNB_INTERETS_CORPORATE', estPorteurInterets: true }),
  row('762100', 'Intérêts sur prêts immobiliers', 7, 4, '762', { sens: 'C', codePosteBudgetaire: 'PNB_INTERETS_RETAIL', estPorteurInterets: true }),
  row('762200', 'Intérêts sur prêts MT entreprises', 7, 4, '762', { sens: 'C', codePosteBudgetaire: 'PNB_INTERETS_CORPORATE', estPorteurInterets: true }),
  row('763100', "Intérêts opérations interbancaires créancières", 7, 4, '763', { sens: 'C', codePosteBudgetaire: 'PNB_TRESORERIE', estPorteurInterets: true }),
  // Autres produits
  row('771100', 'Gains de change opérations clientèle', 7, 4, '771', { sens: 'C', codePosteBudgetaire: 'GAINS_CHANGE' }),
  row('772100', 'Autres produits divers exceptionnels', 7, 4, '772', { sens: 'C', codePosteBudgetaire: 'AUTRES_PRODUITS' }),
  // Crédits / dépôts détaillés
  row('201100', 'Découverts particuliers', 2, 4, '201', { sens: 'D', codePosteBudgetaire: 'ENCOURS_RETAIL' }),
  row('202100', 'Crédits MT immobilier particuliers', 2, 4, '202', { sens: 'D', codePosteBudgetaire: 'ENCOURS_RETAIL' }),
  row('203100', 'Crédits LT immobilier entreprises', 2, 4, '203', { sens: 'D', codePosteBudgetaire: 'ENCOURS_CORPORATE' }),
  row('251100', 'Dépôts à vue particuliers', 2, 4, '251', { sens: 'C', codePosteBudgetaire: 'ENCOURS_DEPOTS_RETAIL' }),
  row('251200', 'Dépôts à vue entreprises', 2, 4, '251', { sens: 'C', codePosteBudgetaire: 'ENCOURS_DEPOTS_CORPORATE' }),
  row('252100', 'DAT particuliers', 2, 4, '252', { sens: 'C', codePosteBudgetaire: 'ENCOURS_DEPOTS_RETAIL' }),
  row('252200', 'DAT entreprises', 2, 4, '252', { sens: 'C', codePosteBudgetaire: 'ENCOURS_DEPOTS_CORPORATE' }),
  // Caisses
  row('101100', 'Caisse principale', 1, 4, '101', { sens: 'D' }),
  row('101200', 'Caisse devises', 1, 4, '101', { sens: 'D' }),
  row('102100', 'Compte ordinaire BCEAO', 1, 4, '102', { sens: 'D' }),
];

async function seedComptes(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const force = process.argv.slice(2).includes('--force');
    if (force) {
      console.log('[seed:comptes] --force : purge de dim_compte');
      // Casser la FK auto-référente avant DELETE.
      await AppDataSource.query(`UPDATE dim_compte SET fk_compte_parent = NULL`);
      await AppDataSource.query(`DELETE FROM dim_compte`);
    }

    const today = new Date().toISOString().slice(0, 10);
    /** Cache code → id pour résoudre les FK au fil de l'insertion. */
    const idByCode = new Map<string, string>();

    for (const c of COMPTES_INITIAUX) {
      // Idempotence : sauter si version courante existe.
      const existing = (await AppDataSource.query(
        `SELECT id FROM dim_compte WHERE code_compte = $1 AND version_courante = true`,
        [c.codeCompte],
      )) as Array<{ id: string }>;
      if (existing.length > 0) {
        idByCode.set(c.codeCompte, String(existing[0]!.id));
        continue;
      }

      let parentId: string | null = null;
      if (c.parentCode) {
        const cached = idByCode.get(c.parentCode);
        if (!cached) {
          throw new Error(
            `[seed:comptes] Parent ${c.parentCode} introuvable pour ${c.codeCompte} — vérifier l'ordre de COMPTES_INITIAUX.`,
          );
        }
        parentId = cached;
      }

      await AppDataSource.query(
        `INSERT INTO dim_compte
          ("code_compte","libelle","classe","sous_classe","fk_compte_parent",
           "niveau","sens","code_poste_budgetaire","est_compte_collectif",
           "est_porteur_interets","date_debut_validite","date_fin_validite",
           "version_courante","est_actif","utilisateur_creation")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,true,true,'system')`,
        [
          c.codeCompte,
          c.libelle,
          c.classe,
          c.sousClasse,
          parentId,
          c.niveau,
          c.sens,
          c.codePosteBudgetaire,
          c.estCompteCollectif,
          c.estPorteurInterets,
          today,
        ],
      );
      const inserted = (await AppDataSource.query(
        `SELECT id FROM dim_compte WHERE code_compte = $1 AND version_courante = true`,
        [c.codeCompte],
      )) as Array<{ id: string }>;
      idByCode.set(c.codeCompte, String(inserted[0]!.id));
    }

    const stats = await AppDataSource.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE version_courante = true)::int AS courants,
         COUNT(*) FILTER (WHERE fk_compte_parent IS NULL AND version_courante = true)::int AS racines
       FROM dim_compte`,
    );
    const row0 = stats[0] as { total: number; courants: number; racines: number };
    console.log(
      `[seed:comptes] total=${row0.total} courants=${row0.courants} racines=${row0.racines} (attendu : ${COMPTES_INITIAUX.length} / ${COMPTES_INITIAUX.length} / 6)`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  seedComptes()
    .then(() => {
      console.log('[seed:comptes] Done.');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[seed:comptes] Failed:', err);
      process.exit(1);
    });
}
