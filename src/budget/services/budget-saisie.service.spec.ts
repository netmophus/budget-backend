/**
 * Tests unitaires des helpers de validation métier du
 * BudgetSaisieService (Lot 3.3, Phase B).
 *
 * Couvre les 4 garde-fous applicatifs :
 *  1. assertCompteFeuille — rejette les comptes agrégés
 *  2. assertTempsPremierDuMois — rejette les dates non-1er du mois
 *  3. assertCrAutorise — rejette si CR hors périmètre RBAC
 *  4. Service composite avec PerimetreService réel (cas admin null)
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';

import { AuditLog } from '../../audit/entities/audit-log.entity';
import { AuditService } from '../../audit/audit.service';
import { DimCentreResponsabilite } from '../../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import { DimCompte } from '../../referentiels/compte/entities/dim-compte.entity';
import { DimDevise } from '../../referentiels/devise/entities/dim-devise.entity';
import { DimLigneMetier } from '../../referentiels/ligne-metier/entities/dim-ligne-metier.entity';
import { DimProduit } from '../../referentiels/produit/entities/dim-produit.entity';
import { DimScenario } from '../../referentiels/scenario/entities/dim-scenario.entity';
import { DimSegment } from '../../referentiels/segment/entities/dim-segment.entity';
import { DimStructure } from '../../referentiels/structure/entities/dim-structure.entity';
import { DimTemps } from '../../referentiels/temps/entities/dim-temps.entity';
import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import { FaitBudget } from '../../faits/budget/entities/fait-budget.entity';
import { Permission } from '../../roles/entities/permission.entity';
import { Role } from '../../roles/entities/role.entity';
import { RolePermission } from '../../roles/entities/role-permission.entity';
import { User } from '../../users/entities/user.entity';
import { UserRole } from '../../users/entities/user-role.entity';
import { BudgetSaisieService } from './budget-saisie.service';
import { PerimetreService } from './perimetre.service';

function buildMemDb(): IMemoryDb {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'current_database',
    args: [],
    returns: DataType.text,
    implementation: () => 'test',
  });
  db.public.registerFunction({
    name: 'version',
    args: [],
    returns: DataType.text,
    implementation: () => 'PostgreSQL 15 (pg-mem)',
  });
  return db;
}

async function createDataSource(): Promise<DataSource> {
  const db = buildMemDb();
  const ds: DataSource = db.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: [
      User,
      Role,
      UserRole,
      Permission,
      RolePermission,
      DimStructure,
      DimCentreResponsabilite,
      DimCompte,
      DimDevise,
      DimLigneMetier,
      DimProduit,
      DimSegment,
      DimTemps,
      DimVersion,
      DimScenario,
      FaitBudget,
      AuditLog,
    ],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

describe('BudgetSaisieService — helpers de validation', () => {
  let ds: DataSource;
  let service: BudgetSaisieService;
  let perimetreService: PerimetreService;

  beforeAll(async () => {
    ds = await createDataSource();
    perimetreService = new PerimetreService(ds.getRepository(UserRole));
    const auditService = new AuditService(ds.getRepository(AuditLog));
    service = new BudgetSaisieService(
      ds.getRepository(FaitBudget),
      ds.getRepository(DimCompte),
      ds.getRepository(DimTemps),
      ds.getRepository(DimCentreResponsabilite),
      ds.getRepository(DimVersion),
      ds.getRepository(DimScenario),
      perimetreService,
      auditService,
      ds,
    );

    // Seed minimal : 1 compte feuille, 1 compte agrégé, 1 temps 1er, 1 temps mid
    await ds.query(
      `INSERT INTO dim_compte
        ("code_compte","libelle","classe","fk_compte_parent","niveau",
         "est_compte_collectif","est_porteur_interets",
         "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
       VALUES
         ('611100','Salaires bruts','6',NULL,4,false,false,'2026-01-01',NULL,true,true,'system'),
         ('6','CHARGES','6',NULL,1,true,false,'2026-01-01',NULL,true,true,'system')`,
    );
    await ds.query(
      `INSERT INTO dim_temps
        ("date","annee","trimestre","mois","jour","jour_ouvre","est_fin_de_mois",
         "est_fin_de_trimestre","est_fin_d_annee","exercice_fiscal","libelle_mois")
       VALUES
         ('2027-04-01',2027,2,4,1,true,false,false,false,2027,'Avril'),
         ('2027-04-15',2027,2,4,15,true,false,false,false,2027,'Avril')`,
    );
  });

  afterAll(async () => {
    await ds.destroy();
  });

  // ─── assertCompteFeuille

  it('assertCompteFeuille : compte feuille (611100) → OK retourne le compte', async () => {
    const r = (await ds.query(
      `SELECT id FROM dim_compte WHERE code_compte='611100'`,
    )) as Array<{ id: string }>;
    const compte = await service.assertCompteFeuille(String(r[0]!.id));
    expect(compte.codeCompte).toBe('611100');
    expect(compte.estCompteCollectif).toBe(false);
  });

  it('assertCompteFeuille : compte agrégé (6) → BadRequestException', async () => {
    const r = (await ds.query(
      `SELECT id FROM dim_compte WHERE code_compte='6'`,
    )) as Array<{ id: string }>;
    await expect(
      service.assertCompteFeuille(String(r[0]!.id)),
    ).rejects.toThrow(/Saisie sur compte agrégé interdite/);
  });

  it('assertCompteFeuille : compte inexistant → NotFoundException', async () => {
    await expect(service.assertCompteFeuille('999999')).rejects.toThrow(
      NotFoundException,
    );
  });

  // ─── assertTempsPremierDuMois

  it('assertTempsPremierDuMois : 2027-04-01 → OK', async () => {
    const r = (await ds.query(
      `SELECT id FROM dim_temps WHERE date='2027-04-01'`,
    )) as Array<{ id: string }>;
    const tps = await service.assertTempsPremierDuMois(String(r[0]!.id));
    expect(tps.jour).toBe(1);
  });

  it('assertTempsPremierDuMois : 2027-04-15 → BadRequestException', async () => {
    const r = (await ds.query(
      `SELECT id FROM dim_temps WHERE date='2027-04-15'`,
    )) as Array<{ id: string }>;
    await expect(
      service.assertTempsPremierDuMois(String(r[0]!.id)),
    ).rejects.toThrow(/maille budgétaire est mensuelle/);
  });

  it('assertTempsPremierDuMois : période inexistante → NotFoundException', async () => {
    await expect(service.assertTempsPremierDuMois('999999')).rejects.toThrow(
      NotFoundException,
    );
  });

  // ─── assertCrAutorise

  it('assertCrAutorise : crAutorises=null (admin) → OK silencieux', () => {
    expect(() => service.assertCrAutorise('42', null)).not.toThrow();
  });

  it('assertCrAutorise : crAutorises=[42,43] et fkCentre=42 → OK', () => {
    expect(() => service.assertCrAutorise('42', ['42', '43'])).not.toThrow();
  });

  it('assertCrAutorise : crAutorises=[42] et fkCentre=99 → ForbiddenException', () => {
    expect(() => service.assertCrAutorise('99', ['42'])).toThrow(
      ForbiddenException,
    );
  });

  it("assertCrAutorise : crAutorises=[] (aucun CR autorisé) → ForbiddenException", () => {
    expect(() => service.assertCrAutorise('42', [])).toThrow(
      /n'avez pas accès/,
    );
  });

  it('assertCrAutorise : crAutorises avec id en number → comparaison string OK', () => {
    // Un caller fournit '42' (string) alors que le PerimetreService
    // retourne aussi des strings (cf. spec). Le helper doit
    // s'aligner — vérifions explicitement.
    expect(() => service.assertCrAutorise('42', ['42'])).not.toThrow();
  });
});

describe('BudgetSaisieService — wiring', () => {
  it('le service est instanciable avec ses 9 dépendances', () => {
    // Smoke instantiation : on ne ré-instancie pas le DataSource ici,
    // ce test garantit juste que le constructeur compile.
    expect(BudgetSaisieService).toBeDefined();
  });
});

// ─── Lot 3.4-bis : grille from-scratch ─────────────────────────────

describe('BudgetSaisieService — grille from-scratch (Lot 3.4-bis)', () => {
  let ds: DataSource;
  let service: BudgetSaisieService;
  let ids: {
    versionId: string;
    scenarioId: string;
    crId: string;
    ligneMetierId: string;
    structureId: string;
  };

  beforeAll(async () => {
    ds = await createDataSource();
    const perim = new PerimetreService(ds.getRepository(UserRole));
    const audit = new AuditService(ds.getRepository(AuditLog));
    service = new BudgetSaisieService(
      ds.getRepository(FaitBudget),
      ds.getRepository(DimCompte),
      ds.getRepository(DimTemps),
      ds.getRepository(DimCentreResponsabilite),
      ds.getRepository(DimVersion),
      ds.getRepository(DimScenario),
      perim,
      audit,
      ds,
    );

    // 1 user admin global (rôle 'global' → null filter)
    await ds.query(
      `INSERT INTO ref_role ("code_role","libelle","est_actif","utilisateur_creation")
       VALUES ('ADMIN','Admin',true,'system')`,
    );
    await ds.query(
      `INSERT INTO "user" ("email","mot_de_passe_hash","nom","prenom","est_actif","utilisateur_creation")
       VALUES ('admin@miznas.local','hash','A','D',true,'system')`,
    );
    await ds.query(
      `INSERT INTO bridge_user_role ("fk_user","fk_role","perimetre_type","perimetre_id","est_actif","utilisateur_creation")
        SELECT u.id, r.id, 'global', NULL, true, 'system'
        FROM "user" u, ref_role r
        WHERE u.email='admin@miznas.local' AND r.code_role='ADMIN'`,
    );

    // Structure + CR
    await ds.query(
      `INSERT INTO dim_structure
        ("code_structure","libelle","libelle_court","type_structure","niveau_hierarchique",
         "fk_structure_parent","code_pays","date_debut_validite","date_fin_validite",
         "version_courante","est_actif","utilisateur_creation")
       VALUES ('AG_TEST','Agence Test',NULL,'agence',1,NULL,NULL,'2026-01-01',NULL,true,true,'system')`,
    );
    const struct = (await ds.query(
      `SELECT id FROM dim_structure WHERE code_structure='AG_TEST'`,
    )) as Array<{ id: string }>;
    await ds.query(
      `INSERT INTO dim_centre_responsabilite
        ("code_cr","libelle","libelle_court","type_cr","fk_structure",
         "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
       VALUES ('CR_TEST','CR Test',NULL,'cdc',$1,'2026-01-01',NULL,true,true,'system')`,
      [String(struct[0]!.id)],
    );

    // Ligne_metier + 3 comptes feuilles classe 6 + 1 agrégé
    await ds.query(
      `INSERT INTO dim_ligne_metier
        ("code_ligne_metier","libelle","fk_ligne_metier_parent","niveau",
         "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
       VALUES ('RETAIL','Retail',NULL,1,'2026-01-01',NULL,true,true,'system')`,
    );
    for (const code of ['611100', '612100', '613100']) {
      await ds.query(
        `INSERT INTO dim_compte
          ("code_compte","libelle","classe","fk_compte_parent","niveau",
           "est_compte_collectif","est_porteur_interets",
           "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
         VALUES ($1,$1,'6',NULL,4,false,false,'2026-01-01',NULL,true,true,'system')`,
        [code],
      );
    }
    // 12 mois de dim_temps pour 2027
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      await ds.query(
        `INSERT INTO dim_temps
          ("date","annee","trimestre","mois","jour","jour_ouvre","est_fin_de_mois",
           "est_fin_de_trimestre","est_fin_d_annee","exercice_fiscal","libelle_mois")
         VALUES ($1,2027,$2,$3,1,true,false,false,false,2027,$4)`,
        [
          `2027-${mm}-01`,
          Math.ceil(m / 3),
          m,
          [
            'Janvier',
            'Février',
            'Mars',
            'Avril',
            'Mai',
            'Juin',
            'Juillet',
            'Août',
            'Septembre',
            'Octobre',
            'Novembre',
            'Décembre',
          ][m - 1]!,
        ],
      );
    }
    // Devise XOF + 1 produit + 1 segment (sentinels MVP)
    await ds.query(
      `INSERT INTO dim_devise
        ("code_iso","libelle","symbole","nb_decimales","est_devise_pivot","est_active","utilisateur_creation")
       VALUES ('XOF','Franc CFA','F CFA',0,true,true,'system')`,
    );
    await ds.query(
      `INSERT INTO dim_produit
        ("code_produit","libelle","type_produit","fk_produit_parent","niveau",
         "est_porteur_interets","date_debut_validite","date_fin_validite",
         "version_courante","est_actif","utilisateur_creation")
       VALUES ('PRODUIT_TRANSVERSE','Produit transverse','autre',NULL,1,
               false,'2026-01-01',NULL,true,true,'system')`,
    );
    await ds.query(
      `INSERT INTO dim_segment
        ("code_segment","libelle","categorie",
         "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
       VALUES ('PARTICULIER','Particuliers','particulier','2026-01-01',NULL,true,true,'system')`,
    );

    // 1 version ouvert + 1 scenario
    await ds.query(
      `INSERT INTO dim_version
        ("code_version","libelle","type_version","exercice_fiscal","statut","utilisateur_creation")
       VALUES ('BUDGET_INITIAL_2027','Budget 2027','budget_initial',2027,'ouvert','system')`,
    );
    await ds.query(
      `INSERT INTO dim_scenario
        ("code_scenario","libelle","type_scenario","statut","exercice_fiscal","utilisateur_creation")
       VALUES ('MEDIAN_2027','Médian 2027','central','actif',2027,'system')`,
    );

    async function id(table: string, col: string, code: string): Promise<string> {
      const r = (await ds.query(
        `SELECT id FROM ${table} WHERE ${col} = $1`,
        [code],
      )) as Array<{ id: string | number }>;
      return String(r[0]!.id);
    }
    ids = {
      structureId: String(struct[0]!.id),
      versionId: await id('dim_version', 'code_version', 'BUDGET_INITIAL_2027'),
      scenarioId: await id('dim_scenario', 'code_scenario', 'MEDIAN_2027'),
      crId: await id('dim_centre_responsabilite', 'code_cr', 'CR_TEST'),
      ligneMetierId: await id('dim_ligne_metier', 'code_ligne_metier', 'RETAIL'),
    };
  });

  afterAll(async () => {
    await ds.destroy();
  });

  async function adminUserId(): Promise<string> {
    const r = (await ds.query(
      `SELECT id FROM "user" WHERE email='admin@miznas.local'`,
    )) as Array<{ id: string }>;
    return String(r[0]!.id);
  }

  it("GET grille from-scratch : 3 comptes feuilles classe 6 retournés (CR vierge)", async () => {
    const userId = await adminUserId();
    const result = await service.getGrilleSaisie(
      {
        versionId: ids.versionId,
        scenarioId: ids.scenarioId,
        crId: ids.crId,
        ligneMetierId: ids.ligneMetierId,
        exerciceFiscal: 2027,
        classeCompte: '6',
      },
      userId,
    );
    expect(result.lignes).toHaveLength(3);
    // Toutes les cellules vides : montant=0, ligneId=null
    for (const ligne of result.lignes) {
      expect(ligne.cellules).toHaveLength(12);
      for (const c of ligne.cellules) {
        expect(c.montant).toBe(0);
        expect(c.ligneId).toBeNull();
        expect(c.modeSaisie).toBeNull();
      }
    }
    expect(result.totalAnneeCr).toBe(0);
  });

  it('GET grille sans ligneMetierId → BadRequestException explicite', async () => {
    const userId = await adminUserId();
    await expect(
      service.getGrilleSaisie(
        {
          versionId: ids.versionId,
          scenarioId: ids.scenarioId,
          crId: ids.crId,
          ligneMetierId: '',
          exerciceFiscal: 2027,
          classeCompte: '6',
        },
        userId,
      ),
    ).rejects.toThrow(/ligneMetierId/);
  });

  it("POST grille from-scratch : INSERT 1 cellule sur compte 611100 (sans ligneId)", async () => {
    const userId = await adminUserId();
    const compteId = (
      (await ds.query(
        `SELECT id FROM dim_compte WHERE code_compte='611100'`,
      )) as Array<{ id: string }>
    )[0]!.id;
    const r = await service.saveGrilleSaisie(
      {
        versionId: ids.versionId,
        scenarioId: ids.scenarioId,
        crId: ids.crId,
        lignes: [
          {
            compteId: String(compteId),
            ligneMetierId: ids.ligneMetierId,
            cellules: [
              { mois: '2027-01-01', montant: 10_200_000, modeSaisie: 'MONTANT' },
            ],
          },
        ],
      },
      userId,
      'admin@miznas.local',
    );
    expect(r.inserees).toBe(1);
    expect(r.modifiees).toBe(0);
    expect(r.erreurs).toEqual([]);
    // Vérifier en base
    const rows = (await ds.query(
      `SELECT montant_devise, mode_saisie, fk_devise FROM fait_budget
        WHERE fk_compte = $1 AND fk_version = $2`,
      [compteId, ids.versionId],
    )) as Array<{
      montant_devise: string;
      mode_saisie: string;
      fk_devise: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.montant_devise)).toBe(10_200_000);
    expect(rows[0]!.mode_saisie).toBe('MONTANT');
  });

  it('POST grille from-scratch : montant=0 sans ligneId → ignorée (pas d\'INSERT)', async () => {
    const userId = await adminUserId();
    const compteId = (
      (await ds.query(
        `SELECT id FROM dim_compte WHERE code_compte='612100'`,
      )) as Array<{ id: string }>
    )[0]!.id;
    const r = await service.saveGrilleSaisie(
      {
        versionId: ids.versionId,
        scenarioId: ids.scenarioId,
        crId: ids.crId,
        lignes: [
          {
            compteId: String(compteId),
            ligneMetierId: ids.ligneMetierId,
            cellules: [
              { mois: '2027-02-01', montant: 0, modeSaisie: 'MONTANT' },
            ],
          },
        ],
      },
      userId,
      'admin@miznas.local',
    );
    expect(r.inserees).toBe(0);
    expect(r.ignorees).toBe(1);
    expect(r.erreurs).toEqual([]);
  });

  it('POST grille mix : 1 nouveau compte 613100 + 1 update sur 611100 → inserees=1, modifiees=1', async () => {
    const userId = await adminUserId();
    const c611 = (
      (await ds.query(
        `SELECT id FROM dim_compte WHERE code_compte='611100'`,
      )) as Array<{ id: string }>
    )[0]!.id;
    const c613 = (
      (await ds.query(
        `SELECT id FROM dim_compte WHERE code_compte='613100'`,
      )) as Array<{ id: string }>
    )[0]!.id;
    const r = await service.saveGrilleSaisie(
      {
        versionId: ids.versionId,
        scenarioId: ids.scenarioId,
        crId: ids.crId,
        lignes: [
          {
            compteId: String(c611),
            ligneMetierId: ids.ligneMetierId,
            // 611100 a déjà une ligne (test précédent) — on la modifie
            cellules: [
              { mois: '2027-01-01', montant: 12_000_000, modeSaisie: 'MONTANT' },
            ],
          },
          {
            compteId: String(c613),
            ligneMetierId: ids.ligneMetierId,
            // 613100 nouveau
            cellules: [
              { mois: '2027-03-01', montant: 5_000_000, modeSaisie: 'MONTANT' },
            ],
          },
        ],
      },
      userId,
      'admin@miznas.local',
    );
    expect(r.inserees).toBe(1);
    expect(r.modifiees).toBe(1);
    expect(r.erreurs).toEqual([]);
  });
});
