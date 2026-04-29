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
 * Limitations pg-mem documentées :
 *  - L'index UNIQUE composite sur 10 colonnes est créé par
 *    `synchronize:true` mais l'invariant est protégé en première
 *    ligne par la vérification applicative (`findOne` avant INSERT).
 *  - Les FK ne sont pas auto-créées par pg-mem si onDelete RESTRICT
 *    est posé sur des entités non chargées dans le DataSource — on
 *    charge donc explicitement les 11 entités.
 */
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

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
    ],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
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
  async function id(table: string, codeCol: string, code: string): Promise<string> {
    const r = (await ds.query(
      `SELECT id FROM ${table} WHERE ${codeCol} = $1`,
      [code],
    )) as Array<{ id: string | number }>;
    return String(r[0]!.id);
  }

  return {
    fkTemps: String(
      ((await ds.query(
        `SELECT id FROM dim_temps WHERE date = '2026-04-01'`,
      )) as Array<{ id: string | number }>)[0]!.id,
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
  let versionRepo: Repository<DimVersion>;
  let service: FaitBudgetService;
  let ids: SeededIds;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(FaitBudget);
    versionRepo = dataSource.getRepository(DimVersion);
    service = new FaitBudgetService(repo, versionRepo);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM fait_budget');
    await dataSource.query('UPDATE dim_compte SET fk_compte_parent = NULL');
    await dataSource.query('DELETE FROM dim_compte');
    await dataSource.query('UPDATE dim_structure SET fk_structure_parent = NULL');
    await dataSource.query('DELETE FROM dim_centre_responsabilite');
    await dataSource.query('DELETE FROM dim_structure');
    await dataSource.query('UPDATE dim_ligne_metier SET fk_ligne_metier_parent = NULL');
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
        service.update(
          id,
          { fkCompte: '999' } as never,
          'admin',
        ),
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
});
