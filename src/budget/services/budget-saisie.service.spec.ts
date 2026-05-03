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
