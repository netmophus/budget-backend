/**
 * Tests unitaires FaitBudgetService via pg-mem.
 *
 * Couvre la portée 3.2A :
 *  - findAll : pagination + filtres FK directs + codes business
 *  - findById avec relations
 *  - findByGrain : retourne ligne / null
 *  - create : succès + 409 doublon grain + 404 FK invalide via 23503
 *  - update : succès sur mesures + 422 si FK dans payload + 409 si
 *    version != ouvert
 *  - remove : succès + 409 si version != ouvert
 *
 * Couvre la portée 3.2B (createFromBusinessKeys) :
 *  - cas nominal (10 codes valides + date)
 *  - rejet date métier inexistante / pas un 1er du mois (e2e)
 *  - dimension SCD2 sans version valide à la date → 422
 *  - multi-versions Option B : ancienne version résolue selon la date
 *  - devise XOF → taux=1.0 auto
 *  - devise non-pivot sans taux applicable → 422
 *  - tauxChangeApplique fourni → pas d'appel findTauxApplicable
 *  - montantFcfa fourni avec écart > tolérance → 422
 *  - version statut!=ouvert → 409, scénario archivé → 409
 *  - cohérence devise XOF / taux≠1 → 422
 *
 * Limitations pg-mem documentées :
 *  - L'index UNIQUE composite sur 10 colonnes est créé par
 *    `synchronize:true` mais l'invariant est protégé en première
 *    ligne par la vérification applicative (`findOne` avant INSERT).
 *  - Les FK ne sont pas auto-créées par pg-mem si onDelete RESTRICT
 *    est posé sur des entités non chargées dans le DataSource — on
 *    charge donc explicitement les 12 entités (avec ref_taux_change).
 */
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { CentreResponsabiliteService } from '../../referentiels/centre-responsabilite/centre-responsabilite.service';
import { DimCentreResponsabilite } from '../../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import { CompteService } from '../../referentiels/compte/compte.service';
import { DimCompte } from '../../referentiels/compte/entities/dim-compte.entity';
import { DeviseService } from '../../referentiels/devise/devise.service';
import { DimDevise } from '../../referentiels/devise/entities/dim-devise.entity';
import { DimLigneMetier } from '../../referentiels/ligne-metier/entities/dim-ligne-metier.entity';
import { LigneMetierService } from '../../referentiels/ligne-metier/ligne-metier.service';
import { DimProduit } from '../../referentiels/produit/entities/dim-produit.entity';
import { ProduitService } from '../../referentiels/produit/produit.service';
import { DimScenario } from '../../referentiels/scenario/entities/dim-scenario.entity';
import { ScenarioService } from '../../referentiels/scenario/scenario.service';
import { DimSegment } from '../../referentiels/segment/entities/dim-segment.entity';
import { SegmentService } from '../../referentiels/segment/segment.service';
import { DimStructure } from '../../referentiels/structure/entities/dim-structure.entity';
import { StructureService } from '../../referentiels/structure/structure.service';
import { RefTauxChange } from '../../referentiels/taux-change/entities/ref-taux-change.entity';
import { TauxChangeService } from '../../referentiels/taux-change/taux-change.service';
import { DimTemps } from '../../referentiels/temps/entities/dim-temps.entity';
import { TempsService } from '../../referentiels/temps/temps.service';
import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import { VersionService } from '../../referentiels/version/version.service';
import { FaitBudget } from './entities/fait-budget.entity';
import { FaitBudgetService } from './fait-budget.service';

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
      FaitBudget,
      DimTemps,
      DimCompte,
      DimStructure,
      DimCentreResponsabilite,
      DimLigneMetier,
      DimProduit,
      DimSegment,
      DimDevise,
      DimVersion,
      DimScenario,
      RefTauxChange,
    ],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

/**
 * Construit un FaitBudgetService instancié avec ses 11 dépendances
 * réelles + DataSource. Les `crService` / `structureService`
 * cross-références ne sont pas appelés depuis `createFromBusinessKeys`
 * (qui ne touche que `findValidAt` / `findCurrent` du socle Scd2),
 * donc undefined-cast est sûr ici.
 */
function buildService(ds: DataSource): FaitBudgetService {
  // Lot 8.7.A — TempsService prend désormais AuditService. Non sollicité
  // ici (createFromBusinessKeys n'appelle que findValidAt/findCurrent),
  // donc stub jest sans implémentation.
  const tempsService = new TempsService(ds.getRepository(DimTemps), {
    log: jest.fn(),
  } as unknown as AuditService);
  const structureService = new StructureService(
    ds.getRepository(DimStructure),
    ds,
  );
  // Lot 7.1 — CentreResponsabiliteService a 2 dépendances supplémentaires
  // (PermissionsService + UserPerimetreService) pour le filtrage par
  // périmètre dans findAllPaginated. Les tests fait_budget n'appellent
  // que findValidAt / findCurrent du socle Scd2 (jamais findAllPaginated),
  // donc on passe des mocks Jest sans implémentation : ils ne seront
  // jamais invoqués.
  const permissionsServiceStub = {
    hasPermission: jest.fn().mockResolvedValue(false),
  } as unknown as import('../../auth/permissions.service').PermissionsService;
  const userPerimetreServiceStub = {
    resoudreCrAccessibles: jest.fn().mockResolvedValue([]),
  } as unknown as import('../../users/services/user-perimetre.service').UserPerimetreService;
  const centreService = new CentreResponsabiliteService(
    ds.getRepository(DimCentreResponsabilite),
    ds,
    structureService,
    permissionsServiceStub,
    userPerimetreServiceStub,
  );
  const compteService = new CompteService(ds.getRepository(DimCompte), ds);
  const ligneMetierService = new LigneMetierService(
    ds.getRepository(DimLigneMetier),
    ds,
  );
  const produitService = new ProduitService(ds.getRepository(DimProduit), ds);
  const segmentService = new SegmentService(ds.getRepository(DimSegment), ds);
  const deviseService = new DeviseService(ds.getRepository(DimDevise));
  // Lot 3.2 : VersionService consomme DataSource + AuditService pour
  // le hook Q9. Les tests fait_budget n'utilisent ce service que pour
  // findAll/findOne/findByCode → on instancie avec un AuditService stub
  // (le hook Q9 n'est exercé que dans version.service.spec.ts).
  const auditServiceStub = {
    log: async () => undefined,
  } as unknown as import('../../audit/audit.service').AuditService;
  const versionService = new VersionService(
    ds.getRepository(DimVersion),
    ds,
    auditServiceStub,
  );
  const scenarioService = new ScenarioService(ds.getRepository(DimScenario));
  const tauxChangeService = new TauxChangeService(
    ds.getRepository(RefTauxChange),
    ds.getRepository(DimDevise),
    ds.getRepository(DimTemps),
  );
  return new FaitBudgetService(
    ds.getRepository(FaitBudget),
    ds.getRepository(DimVersion),
    tempsService,
    structureService,
    centreService,
    compteService,
    ligneMetierService,
    produitService,
    segmentService,
    deviseService,
    versionService,
    scenarioService,
    tauxChangeService,
  );
}

interface SeededIds {
  fkTemps: string;
  fkCompte: string;
  fkStructure: string;
  fkCentre: string;
  fkLigneMetier: string;
  fkProduit: string;
  fkSegment: string;
  fkDevise: string;
  fkVersion: string;
  fkScenario: string;
}

async function seedDimensions(
  ds: DataSource,
  versionStatut: 'ouvert' | 'soumis' | 'valide' | 'gele' = 'ouvert',
): Promise<SeededIds> {
  // dim_temps : 1 ligne 2026-04-01
  await ds.query(
    `INSERT INTO dim_temps
      ("date","annee","trimestre","mois","jour","jour_ouvre","est_fin_de_mois",
       "est_fin_de_trimestre","est_fin_d_annee","exercice_fiscal","libelle_mois")
     VALUES ('2026-04-01',2026,2,4,1,true,false,false,false,2026,'Avril')`,
  );
  // dim_compte
  await ds.query(
    `INSERT INTO dim_compte
      ("code_compte","libelle","classe","fk_compte_parent","niveau",
       "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ('611100','Salaires bruts',6,NULL,4,'2026-01-01',NULL,true,true,'system')`,
  );
  // dim_structure
  await ds.query(
    `INSERT INTO dim_structure
      ("code_structure","libelle","libelle_court","type_structure","niveau_hierarchique",
       "fk_structure_parent","code_pays","date_debut_validite","date_fin_validite",
       "version_courante","est_actif","utilisateur_creation")
     VALUES ('AG_TEST','Agence Test',NULL,'agence',1,NULL,NULL,'2026-01-01',NULL,true,true,'system')`,
  );
  // dim_centre_responsabilite : a besoin d'une fk_structure
  const struct = (await ds.query(
    `SELECT id FROM dim_structure WHERE code_structure='AG_TEST'`,
  )) as Array<{ id: string | number }>;
  await ds.query(
    `INSERT INTO dim_centre_responsabilite
      ("code_cr","libelle","libelle_court","type_cr","fk_structure",
       "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ('CR_TEST','CR Test',NULL,'cdc',$1,'2026-01-01',NULL,true,true,'system')`,
    [String(struct[0]!.id)],
  );
  // dim_ligne_metier
  await ds.query(
    `INSERT INTO dim_ligne_metier
      ("code_ligne_metier","libelle","fk_ligne_metier_parent","niveau",
       "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ('RETAIL','Retail',NULL,1,'2026-01-01',NULL,true,true,'system')`,
  );
  // dim_produit
  await ds.query(
    `INSERT INTO dim_produit
      ("code_produit","libelle","type_produit","fk_produit_parent","niveau",
       "est_porteur_interets","date_debut_validite","date_fin_validite",
       "version_courante","est_actif","utilisateur_creation")
     VALUES ('DEPOT_VUE','Dépôts à vue','depot',NULL,1,false,'2026-01-01',NULL,true,true,'system')`,
  );
  // dim_segment
  await ds.query(
    `INSERT INTO dim_segment
      ("code_segment","libelle","categorie",
       "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
     VALUES ('PARTICULIER','Particuliers','particulier','2026-01-01',NULL,true,true,'system')`,
  );
  // dim_devise (XOF pivot)
  await ds.query(
    `INSERT INTO dim_devise
      ("code_iso","libelle","symbole","nb_decimales","est_devise_pivot","est_active","utilisateur_creation")
     VALUES ('XOF','Franc CFA','F CFA',0,true,true,'system')`,
  );
  // dim_version
  await ds.query(
    `INSERT INTO dim_version
      ("code_version","libelle","type_version","exercice_fiscal","statut","utilisateur_creation")
     VALUES ('BUDGET_INITIAL_2026','Budget 2026','budget_initial',2026,$1,'system')`,
    [versionStatut],
  );
  // dim_scenario
  await ds.query(
    `INSERT INTO dim_scenario
      ("code_scenario","libelle","type_scenario","statut","utilisateur_creation")
     VALUES ('CENTRAL','Central','central','actif','system')`,
  );

  // Récupérer tous les ids.
  async function id(
    table: string,
    codeCol: string,
    code: string,
  ): Promise<string> {
    const r = (await ds.query(`SELECT id FROM ${table} WHERE ${codeCol} = $1`, [
      code,
    ])) as Array<{ id: string | number }>;
    return String(r[0]!.id);
  }

  return {
    fkTemps: String(
      (
        (await ds.query(
          `SELECT id FROM dim_temps WHERE date = '2026-04-01'`,
        )) as Array<{ id: string | number }>
      )[0]!.id,
    ),
    fkCompte: await id('dim_compte', 'code_compte', '611100'),
    fkStructure: await id('dim_structure', 'code_structure', 'AG_TEST'),
    fkCentre: await id('dim_centre_responsabilite', 'code_cr', 'CR_TEST'),
    fkLigneMetier: await id('dim_ligne_metier', 'code_ligne_metier', 'RETAIL'),
    fkProduit: await id('dim_produit', 'code_produit', 'DEPOT_VUE'),
    fkSegment: await id('dim_segment', 'code_segment', 'PARTICULIER'),
    fkDevise: await id('dim_devise', 'code_iso', 'XOF'),
    fkVersion: await id('dim_version', 'code_version', 'BUDGET_INITIAL_2026'),
    fkScenario: await id('dim_scenario', 'code_scenario', 'CENTRAL'),
  };
}

describe('FaitBudgetService', () => {
  let dataSource: DataSource;
  let repo: Repository<FaitBudget>;
  let service: FaitBudgetService;
  let ids: SeededIds;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(FaitBudget);
    service = buildService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM fait_budget');
    await dataSource.query('DELETE FROM ref_taux_change');
    await dataSource.query('UPDATE dim_compte SET fk_compte_parent = NULL');
    await dataSource.query('DELETE FROM dim_compte');
    await dataSource.query(
      'UPDATE dim_structure SET fk_structure_parent = NULL',
    );
    await dataSource.query('DELETE FROM dim_centre_responsabilite');
    await dataSource.query('DELETE FROM dim_structure');
    await dataSource.query(
      'UPDATE dim_ligne_metier SET fk_ligne_metier_parent = NULL',
    );
    await dataSource.query('DELETE FROM dim_ligne_metier');
    await dataSource.query('UPDATE dim_produit SET fk_produit_parent = NULL');
    await dataSource.query('DELETE FROM dim_produit');
    await dataSource.query('DELETE FROM dim_segment');
    await dataSource.query('DELETE FROM dim_devise');
    await dataSource.query('DELETE FROM dim_version');
    await dataSource.query('DELETE FROM dim_scenario');
    await dataSource.query('DELETE FROM dim_temps');
    ids = await seedDimensions(dataSource);
  });

  // ─── create

  describe('create', () => {
    it('crée un fait avec les 10 FK + 3 mesures', async () => {
      const created = await service.create(
        {
          ...ids,
          montantDevise: 1000000,
          montantFcfa: 1000000,
          tauxChangeApplique: 1,
        },
        'admin@miznas.local',
      );
      expect(created.id).toBeDefined();
      expect(created.fkTemps).toBe(ids.fkTemps);
      expect(created.montantFcfa).toBe(1000000);
      expect(created.utilisateurCreation).toBe('admin@miznas.local');
    });

    it('refuse un grain doublon → 409', async () => {
      const dto = {
        ...ids,
        montantDevise: 1000000,
        montantFcfa: 1000000,
        tauxChangeApplique: 1,
      };
      await service.create(dto, 'admin');
      await expect(service.create(dto, 'admin')).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuse si la version cible est figée (statut != ouvert) → 409', async () => {
      // Forcer le statut soumis sur la version.
      await dataSource.query(
        `UPDATE dim_version SET statut='soumis' WHERE code_version='BUDGET_INITIAL_2026'`,
      );
      await expect(
        service.create(
          {
            ...ids,
            montantDevise: 1000000,
            montantFcfa: 1000000,
            tauxChangeApplique: 1,
          },
          'admin',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('refuse si fkVersion pointe vers une version inexistante → 404', async () => {
      await expect(
        service.create(
          {
            ...ids,
            fkVersion: '999999',
            montantDevise: 1,
            montantFcfa: 1,
            tauxChangeApplique: 1,
          },
          'admin',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findAll

  describe('findAll', () => {
    beforeEach(async () => {
      await service.create(
        {
          ...ids,
          montantDevise: 1000000,
          montantFcfa: 1000000,
          tauxChangeApplique: 1,
        },
        'admin',
      );
    });

    it('retourne 1 ligne (cas nominal)', async () => {
      const res = await service.findAll({ page: 1, limit: 50 });
      expect(res.total).toBe(1);
      expect(res.items[0]!.compte?.code).toBe('611100');
      expect(res.items[0]!.version?.code).toBe('BUDGET_INITIAL_2026');
    });

    it('filtre fkVersion', async () => {
      const res = await service.findAll({
        page: 1,
        limit: 50,
        fkVersion: ids.fkVersion,
      });
      expect(res.total).toBe(1);
    });

    it('filtre par codeVersion (résolu via JOIN)', async () => {
      const res = await service.findAll({
        page: 1,
        limit: 50,
        codeVersion: 'BUDGET_INITIAL_2026',
      });
      expect(res.total).toBe(1);
    });

    it('filtre annee + mois', async () => {
      const res = await service.findAll({
        page: 1,
        limit: 50,
        annee: 2026,
        mois: 4,
      });
      expect(res.total).toBe(1);
    });

    it('filtre annee + mois ne matchant pas → 0', async () => {
      const res = await service.findAll({
        page: 1,
        limit: 50,
        annee: 2026,
        mois: 12,
      });
      expect(res.total).toBe(0);
    });
  });

  // ─── findByGrain

  describe('findByGrain', () => {
    beforeEach(async () => {
      await service.create(
        {
          ...ids,
          montantDevise: 1000000,
          montantFcfa: 1000000,
          tauxChangeApplique: 1,
        },
        'admin',
      );
    });

    it('retourne la ligne quand le grain match', async () => {
      const r = await service.findByGrain(ids);
      expect(r).not.toBeNull();
      expect(r!.montantFcfa).toBe(1000000);
    });

    it('retourne null quand aucun grain ne match', async () => {
      const r = await service.findByGrain({
        ...ids,
        fkScenario: '999999',
      });
      expect(r).toBeNull();
    });
  });

  // ─── update

  describe('update', () => {
    let id: string;

    beforeEach(async () => {
      const f = await service.create(
        {
          ...ids,
          montantDevise: 1000000,
          montantFcfa: 1000000,
          tauxChangeApplique: 1,
        },
        'admin',
      );
      id = f.id;
    });

    it('met à jour les 3 mesures', async () => {
      const updated = await service.update(
        id,
        { montantDevise: 1500000, montantFcfa: 1500000 },
        'admin@miznas.local',
      );
      expect(updated.montantDevise).toBe(1500000);
      expect(updated.utilisateurModification).toBe('admin@miznas.local');
    });

    it('refuse si une FK est dans le payload → 422', async () => {
      await expect(
        service.update(id, { fkCompte: '999' } as never, 'admin'),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('refuse si version != ouvert → 409', async () => {
      await dataSource.query(
        `UPDATE dim_version SET statut='valide' WHERE code_version='BUDGET_INITIAL_2026'`,
      );
      await expect(
        service.update(id, { montantDevise: 999 }, 'admin'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException si id inconnu', async () => {
      await expect(
        service.update('999999', { montantDevise: 1 }, 'admin'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── remove

  describe('remove', () => {
    let id: string;

    beforeEach(async () => {
      const f = await service.create(
        {
          ...ids,
          montantDevise: 1000000,
          montantFcfa: 1000000,
          tauxChangeApplique: 1,
        },
        'admin',
      );
      id = f.id;
    });

    it('supprime quand version=ouvert', async () => {
      expect(await service.remove(id)).toBe(true);
      expect(await repo.count()).toBe(0);
    });

    it('refuse si version != ouvert → 409', async () => {
      await dataSource.query(
        `UPDATE dim_version SET statut='gele' WHERE code_version='BUDGET_INITIAL_2026'`,
      );
      await expect(service.remove(id)).rejects.toThrow(ConflictException);
    });

    it('retourne false si id inconnu', async () => {
      expect(await service.remove('999999')).toBe(false);
    });
  });

  // ─── 3.2B : createFromBusinessKeys

  describe('createFromBusinessKeys', () => {
    /**
     * Helper pour seeder un taux de change EUR au 2026-03-31.
     */
    async function seedTauxEur(
      taux = '655.95700000',
      typeTaux = 'fixe_budgetaire',
    ): Promise<void> {
      // dim_devise EUR si pas déjà
      await dataSource.query(
        `INSERT INTO dim_devise
          ("code_iso","libelle","symbole","nb_decimales","est_devise_pivot","est_active","utilisateur_creation")
         VALUES ('EUR','Euro','€',2,false,true,'system')`,
      );
      // dim_temps 2026-03-31 si pas déjà
      await dataSource.query(
        `INSERT INTO dim_temps
          ("date","annee","trimestre","mois","jour","jour_ouvre","est_fin_de_mois",
           "est_fin_de_trimestre","est_fin_d_annee","exercice_fiscal","libelle_mois")
         VALUES ('2026-03-31',2026,1,3,31,true,true,true,false,2026,'Mars')`,
      );
      const eur = (await dataSource.query(
        `SELECT id FROM dim_devise WHERE code_iso='EUR'`,
      )) as Array<{ id: string | number }>;
      const tps = (await dataSource.query(
        `SELECT id FROM dim_temps WHERE date='2026-03-31'`,
      )) as Array<{ id: string | number }>;
      await dataSource.query(
        `INSERT INTO ref_taux_change
          ("fk_devise","fk_temps","taux_vers_pivot","source","type_taux","utilisateur_creation")
         VALUES ($1,$2,$3,'BCEAO',$4,'system')`,
        [String(eur[0]!.id), String(tps[0]!.id), taux, typeTaux],
      );
    }

    function buildDto(
      overrides: Partial<{
        dateMetier: string;
        codeStructure: string;
        codeCentre: string;
        codeCompte: string;
        codeLigneMetier: string;
        codeProduit: string;
        codeSegment: string;
        codeDevise: string;
        codeVersion: string;
        codeScenario: string;
        montantDevise: number;
        tauxChangeApplique?: number;
        montantFcfa?: number;
        typeTaux?: 'cloture' | 'moyen_mensuel' | 'fixe_budgetaire';
      }> = {},
    ) {
      return {
        dateMetier: '2026-04-01',
        codeStructure: 'AG_TEST',
        codeCentre: 'CR_TEST',
        codeCompte: '611100',
        codeLigneMetier: 'RETAIL',
        codeProduit: 'DEPOT_VUE',
        codeSegment: 'PARTICULIER',
        codeDevise: 'XOF',
        codeVersion: 'BUDGET_INITIAL_2026',
        codeScenario: 'CENTRAL',
        montantDevise: 1000000,
        ...overrides,
      };
    }

    it('cas nominal : 10 codes valides + date → fait créé avec FK résolues', async () => {
      const r = await service.createFromBusinessKeys(buildDto(), 'admin');
      expect(r.id).toBeDefined();
      expect(r.compte?.code).toBe('611100');
      expect(r.fkCompte).toBe(ids.fkCompte);
      expect(r.fkStructure).toBe(ids.fkStructure);
      expect(r.tauxChangeApplique).toBe(1);
      expect(r.montantFcfa).toBe(1000000);
      expect(r.resolutionDetails.tauxChangeSource).toBe('auto-pivot-xof');
      expect(r.resolutionDetails.montantFcfaSource).toBe('calcule-automatique');
      expect(r.resolutionDetails.dimensionsResolues).toHaveLength(6);
      expect(
        r.resolutionDetails.dimensionsResolues.find((d) => d.axe === 'compte'),
      ).toMatchObject({
        codeBusiness: '611100',
        fkResolu: ids.fkCompte,
      });
    });

    it('date métier inexistante dans dim_temps → 404', async () => {
      await expect(
        service.createFromBusinessKeys(
          buildDto({ dateMetier: '2099-01-01' }),
          'admin',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('SCD2 sans version valide à la date → 422 avec message indiquant LAQUELLE', async () => {
      // Insérer une 2e date dans dim_temps : 2025-04-01 (avant l'unique
      // version SCD2 du compte qui débute 2026-01-01)
      await dataSource.query(
        `INSERT INTO dim_temps
          ("date","annee","trimestre","mois","jour","jour_ouvre","est_fin_de_mois",
           "est_fin_de_trimestre","est_fin_d_annee","exercice_fiscal","libelle_mois")
         VALUES ('2025-04-01',2025,2,4,1,true,false,false,false,2025,'Avril')`,
      );
      await expect(
        service.createFromBusinessKeys(
          buildDto({ dateMetier: '2025-04-01' }),
          'admin',
        ),
      ).rejects.toMatchObject({
        message: expect.stringMatching(
          /dim_(structure|centre_responsabilite|compte|ligne_metier|produit|segment).*'.+'.*valide au 2025-04-01/,
        ),
      });
    });

    it('multi-versions : ancienne version résolue à la date métier (Option B)', async () => {
      // Ajouter une 2e version SCD2 du compte 611100 : V1 valide
      // 2026-01-01 → 2026-04-01, V2 valide 2026-04-01 → ouverte.
      // (V1 a déjà été créée par seedDimensions avec début 2026-01-01.)
      await dataSource.query(
        `UPDATE dim_compte SET date_fin_validite='2026-04-01', version_courante=false
         WHERE code_compte='611100'`,
      );
      await dataSource.query(
        `INSERT INTO dim_compte
          ("code_compte","libelle","classe","fk_compte_parent","niveau",
           "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
         VALUES ('611100','Salaires révisés',6,NULL,4,'2026-04-01',NULL,true,true,'system')`,
      );
      // Insérer la date 2026-02-01 pour pouvoir y placer un fait
      await dataSource.query(
        `INSERT INTO dim_temps
          ("date","annee","trimestre","mois","jour","jour_ouvre","est_fin_de_mois",
           "est_fin_de_trimestre","est_fin_d_annee","exercice_fiscal","libelle_mois")
         VALUES ('2026-02-01',2026,1,2,1,true,false,false,false,2026,'Février')`,
      );
      const v1 = (await dataSource.query(
        `SELECT id FROM dim_compte WHERE code_compte='611100' AND date_debut_validite='2026-01-01'`,
      )) as Array<{ id: string | number }>;
      const v2 = (await dataSource.query(
        `SELECT id FROM dim_compte WHERE code_compte='611100' AND date_debut_validite='2026-04-01'`,
      )) as Array<{ id: string | number }>;
      expect(String(v1[0]!.id)).not.toBe(String(v2[0]!.id));

      // Saisie au 2026-02-01 → V1
      const r1 = await service.createFromBusinessKeys(
        buildDto({ dateMetier: '2026-02-01' }),
        'admin',
      );
      expect(r1.fkCompte).toBe(String(v1[0]!.id));
      // Saisie au 2026-04-01 → V2 (sur le grain par défaut, donc on
      // doit varier un autre axe pour éviter le doublon — ici on
      // change le scénario en créant un 2e scénario).
      await dataSource.query(
        `INSERT INTO dim_scenario
          ("code_scenario","libelle","type_scenario","statut","utilisateur_creation")
         VALUES ('HAUT','Haut','haut','actif','system')`,
      );
      const r2 = await service.createFromBusinessKeys(
        buildDto({ dateMetier: '2026-04-01', codeScenario: 'HAUT' }),
        'admin',
      );
      expect(r2.fkCompte).toBe(String(v2[0]!.id));
      expect(r1.fkCompte).not.toBe(r2.fkCompte);
    });

    it('devise EUR + version BUDGET_INITIAL → typeTaux fixe_budgetaire et résolution OK', async () => {
      await seedTauxEur('655.95700000', 'fixe_budgetaire');
      const r = await service.createFromBusinessKeys(
        buildDto({ codeDevise: 'EUR', montantDevise: 1000 }),
        'admin',
      );
      expect(r.tauxChangeApplique).toBe(655.957);
      expect(r.montantFcfa).toBe(655957);
      expect(r.resolutionDetails.tauxChangeSource).toBe('auto-fixe-budgetaire');
      expect(r.resolutionDetails.dateApplicableTaux).toBe('2026-03-31');
      expect(r.resolutionDetails.montantFcfaSource).toBe('calcule-automatique');
    });

    it('devise EUR sans taux applicable → 422', async () => {
      // Pas de seedTauxEur — l'EUR existe mais aucun taux.
      await dataSource.query(
        `INSERT INTO dim_devise
          ("code_iso","libelle","symbole","nb_decimales","est_devise_pivot","est_active","utilisateur_creation")
         VALUES ('EUR','Euro','€',2,false,true,'system')`,
      );
      await expect(
        service.createFromBusinessKeys(
          buildDto({ codeDevise: 'EUR', montantDevise: 1000 }),
          'admin',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('tauxChangeApplique fourni → tauxChangeSource=fourni-utilisateur', async () => {
      await dataSource.query(
        `INSERT INTO dim_devise
          ("code_iso","libelle","symbole","nb_decimales","est_devise_pivot","est_active","utilisateur_creation")
         VALUES ('EUR','Euro','€',2,false,true,'system')`,
      );
      const r = await service.createFromBusinessKeys(
        buildDto({
          codeDevise: 'EUR',
          montantDevise: 1000,
          tauxChangeApplique: 700,
        }),
        'admin',
      );
      expect(r.tauxChangeApplique).toBe(700);
      expect(r.montantFcfa).toBe(700000);
      expect(r.resolutionDetails.tauxChangeSource).toBe('fourni-utilisateur');
      expect(r.resolutionDetails.dateApplicableTaux).toBeNull();
    });

    it('montantFcfa fourni avec écart > tolérance → 422', async () => {
      // tolérance = max(0.01, |calcule|*0.0001) → pour 1_000_000 = 100.
      // On envoie un écart de 200 → KO.
      await expect(
        service.createFromBusinessKeys(
          buildDto({
            codeDevise: 'XOF',
            montantDevise: 1000000,
            montantFcfa: 1000200,
          }),
          'admin',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('montantFcfa fourni avec écart ≤ tolérance → OK et source=fourni-utilisateur', async () => {
      const r = await service.createFromBusinessKeys(
        buildDto({
          montantDevise: 1000000,
          montantFcfa: 1000000.005, // dans la tolérance 0.01
        }),
        'admin',
      );
      expect(r.resolutionDetails.montantFcfaSource).toBe('fourni-utilisateur');
    });

    it('version statut=soumis → 409', async () => {
      await dataSource.query(
        `UPDATE dim_version SET statut='soumis' WHERE code_version='BUDGET_INITIAL_2026'`,
      );
      await expect(
        service.createFromBusinessKeys(buildDto(), 'admin'),
      ).rejects.toMatchObject({
        message: expect.stringContaining("statut 'soumis'"),
      });
    });

    it('scénario archivé → 409', async () => {
      await dataSource.query(
        `UPDATE dim_scenario SET statut='archive' WHERE code_scenario='CENTRAL'`,
      );
      await expect(
        service.createFromBusinessKeys(buildDto(), 'admin'),
      ).rejects.toThrow(ConflictException);
    });

    it('grain dupliqué (même 10-uplet de codes) → 409', async () => {
      await service.createFromBusinessKeys(buildDto(), 'admin');
      await expect(
        service.createFromBusinessKeys(buildDto(), 'admin'),
      ).rejects.toThrow(ConflictException);
    });

    it('cohérence devise XOF + tauxChangeApplique=2.5 → 422', async () => {
      await expect(
        service.createFromBusinessKeys(
          buildDto({ codeDevise: 'XOF', tauxChangeApplique: 2.5 }),
          'admin',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  // ─── Lot 3.1 : mode de saisie MONTANT vs ENCOURS_TIE
  // Le compte 611100 seedé dans seedDimensions n'est pas porteur
  // d'intérêts. On en ajoute un 2ᵉ (761100) qui l'est, pour les
  // tests ENCOURS_TIE.

  describe('mode ENCOURS_TIE', () => {
    let fkComptePorteur: string;

    beforeEach(async () => {
      await dataSource.query(
        `INSERT INTO dim_compte
          ("code_compte","libelle","classe","fk_compte_parent","niveau",
           "est_porteur_interets","date_debut_validite","date_fin_validite",
           "version_courante","est_actif","utilisateur_creation")
         VALUES ('761100','Intérêts perçus PCT',7,NULL,4,
                 true,'2026-01-01',NULL,true,true,'system')`,
      );
      const r = (await dataSource.query(
        `SELECT id FROM dim_compte WHERE code_compte='761100'`,
      )) as Array<{ id: string | number }>;
      fkComptePorteur = String(r[0]!.id);
    });

    it('mode MONTANT par défaut : encoursMoyen + tie = null, montant tel que fourni', async () => {
      const created = await service.create(
        {
          ...ids,
          montantDevise: 1500000,
          montantFcfa: 1500000,
          tauxChangeApplique: 1,
        },
        'admin',
      );
      expect(created.modeSaisie).toBe('MONTANT');
      expect(created.encoursMoyen).toBeNull();
      expect(created.tie).toBeNull();
      expect(created.montantDevise).toBe(1500000);
    });

    it('mode MONTANT explicite avec encoursMoyen fourni → BadRequestException', async () => {
      await expect(
        service.create(
          {
            ...ids,
            montantDevise: 1500000,
            montantFcfa: 1500000,
            tauxChangeApplique: 1,
            modeSaisie: 'MONTANT',
            encoursMoyen: 12345,
          },
          'admin',
        ),
      ).rejects.toThrow(/Mode 'MONTANT' incompatible avec encoursMoyen/);
    });

    it("mode ENCOURS_TIE sur compte NON porteur d'intérêts → BadRequestException", async () => {
      await expect(
        service.create(
          {
            ...ids,
            montantDevise: 0, // ignoré
            montantFcfa: 0,
            tauxChangeApplique: 1,
            modeSaisie: 'ENCOURS_TIE',
            encoursMoyen: 896000000,
            tie: 0.085,
          },
          'admin',
        ),
      ).rejects.toThrow(/n'est pas porteur d'intérêts/);
    });

    it('mode ENCOURS_TIE sur compte porteur : montant recalculé = encours × tie / 12', async () => {
      const created = await service.create(
        {
          ...ids,
          fkCompte: fkComptePorteur,
          montantDevise: 0, // valeur ignorée
          montantFcfa: 0,
          tauxChangeApplique: 1,
          modeSaisie: 'ENCOURS_TIE',
          encoursMoyen: 896000000,
          tie: 0.085,
          commentaire: 'Hypothèse encours retail PCT',
        },
        'admin',
      );
      // 896 000 000 × 0.085 / 12 = 6 346 666.6666… → arrondi 4 décimales = 6 346 666.6667
      expect(created.modeSaisie).toBe('ENCOURS_TIE');
      expect(created.encoursMoyen).toBe(896000000);
      expect(created.tie).toBe(0.085);
      expect(created.montantDevise).toBeCloseTo(6346666.6667, 4);
      expect(created.commentaire).toBe('Hypothèse encours retail PCT');
    });

    it('mode ENCOURS_TIE sans tie → BadRequestException explicite', async () => {
      await expect(
        service.create(
          {
            ...ids,
            fkCompte: fkComptePorteur,
            montantDevise: 0,
            montantFcfa: 0,
            tauxChangeApplique: 1,
            modeSaisie: 'ENCOURS_TIE',
            encoursMoyen: 896000000,
          },
          'admin',
        ),
      ).rejects.toThrow(/requiert tie/);
    });

    it('update : bascule MONTANT → ENCOURS_TIE recalcule montantDevise', async () => {
      const created = await service.create(
        {
          ...ids,
          fkCompte: fkComptePorteur,
          montantDevise: 1000,
          montantFcfa: 1000,
          tauxChangeApplique: 1,
        },
        'admin',
      );

      const updated = await service.update(
        created.id,
        {
          modeSaisie: 'ENCOURS_TIE',
          encoursMoyen: 12000,
          tie: 0.1,
        },
        'admin',
      );
      // 12 000 × 0.10 / 12 = 100 exactement
      expect(updated.modeSaisie).toBe('ENCOURS_TIE');
      expect(updated.encoursMoyen).toBe(12000);
      expect(updated.tie).toBe(0.1);
      expect(updated.montantDevise).toBeCloseTo(100, 4);
    });

    it('update : bascule ENCOURS_TIE → MONTANT remet encoursMoyen + tie à null', async () => {
      const created = await service.create(
        {
          ...ids,
          fkCompte: fkComptePorteur,
          montantDevise: 0,
          montantFcfa: 0,
          tauxChangeApplique: 1,
          modeSaisie: 'ENCOURS_TIE',
          encoursMoyen: 12000,
          tie: 0.1,
        },
        'admin',
      );
      expect(created.modeSaisie).toBe('ENCOURS_TIE');

      const updated = await service.update(
        created.id,
        {
          modeSaisie: 'MONTANT',
          montantDevise: 200,
        },
        'admin',
      );
      expect(updated.modeSaisie).toBe('MONTANT');
      expect(updated.encoursMoyen).toBeNull();
      expect(updated.tie).toBeNull();
      expect(updated.montantDevise).toBe(200);
    });
  });
});
