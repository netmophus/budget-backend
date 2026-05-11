/**
 * Tests RealiseImportService (Lot 5.1) via pg-mem.
 *
 * Couvre :
 *  - Parsing CSV (cas nominal)
 *  - Validation : code inconnu, mois mal formé
 *  - Upsert : création + mise à jour ligne IMPORTE existante
 *  - Upsert : ligne VALIDE existante → ignorée
 *  - Périmètre : ligne CR hors périmètre → ignorée avec raison
 *  - Rapport : compteurs corrects
 *  - Audit IMPORTER_REALISE généré
 */
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';

import { AuditLog } from '../../audit/entities/audit-log.entity';
import { AuditService } from '../../audit/audit.service';
import { PerimetreService } from '../../budget/services/perimetre.service';
import { DimCentreResponsabilite } from '../../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import { DimCompte } from '../../referentiels/compte/entities/dim-compte.entity';
import { DimDevise } from '../../referentiels/devise/entities/dim-devise.entity';
import { DimLigneMetier } from '../../referentiels/ligne-metier/entities/dim-ligne-metier.entity';
import { DimStructure } from '../../referentiels/structure/entities/dim-structure.entity';
import { DimTemps } from '../../referentiels/temps/entities/dim-temps.entity';
import { Permission } from '../../roles/entities/permission.entity';
import { Role } from '../../roles/entities/role.entity';
import { RolePermission } from '../../roles/entities/role-permission.entity';
import { User } from '../../users/entities/user.entity';
import { UserPerimetre } from '../../users/entities/user-perimetre.entity';
import { UserRole } from '../../users/entities/user-role.entity';
import { FaitRealise } from '../entities/fait-realise.entity';
import { RealiseImportService } from './realise-import.service';

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
    implementation: () => 'PG 15',
  });
  return db;
}

async function createDataSource(): Promise<DataSource> {
  const db = buildMemDb();
  const ds = db.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: [
      FaitRealise,
      AuditLog,
      User,
      UserRole,
      UserPerimetre,
      Role,
      Permission,
      RolePermission,
      DimCentreResponsabilite,
      DimCompte,
      DimLigneMetier,
      DimDevise,
      DimTemps,
      DimStructure,
    ],
    synchronize: true,
  }) as DataSource;
  await ds.initialize();
  return ds;
}

interface SeedRefs {
  adminId: string;
  saisisseurId: string;
  cr1Code: string;
  cr1Id: string;
  compteCode: string;
  ligneMetierCode: string;
  deviseCode: string;
}

async function seed(ds: DataSource): Promise<SeedRefs> {
  await ds.query(
    `INSERT INTO "user" (email, mot_de_passe_hash, nom, prenom, est_actif)
     VALUES ('admin@m.io','h','A','D',true), ('sai@m.io','h','S','I',true)`,
  );
  const users = (await ds.query(`SELECT id, email FROM "user"`)) as Array<{
    id: string;
    email: string;
  }>;
  const adminId = String(users.find((u) => u.email === 'admin@m.io')!.id);
  const saiId = String(users.find((u) => u.email === 'sai@m.io')!.id);

  await ds.query(
    `INSERT INTO ref_role (code_role, libelle, est_actif, utilisateur_creation)
     VALUES ('ADMIN','Admin',true,'system'), ('LECTEUR','Lecteur',true,'system')`,
  );
  const roles = (await ds.query(
    `SELECT id, code_role FROM ref_role`,
  )) as Array<{ id: string; code_role: string }>;
  const adminRoleId = String(roles.find((r) => r.code_role === 'ADMIN')!.id);
  const lecteurRoleId = String(
    roles.find((r) => r.code_role === 'LECTEUR')!.id,
  );

  await ds.query(
    `INSERT INTO bridge_user_role (fk_user, fk_role, perimetre_type, est_actif, utilisateur_creation)
     VALUES ($1::bigint, $2::bigint, 'global', true, 'system'),
            ($3::bigint, $4::bigint, 'global', true, 'system')`,
    [adminId, adminRoleId, saiId, lecteurRoleId],
  );

  // Référentiels
  await ds.query(
    `INSERT INTO dim_structure
       (code_structure, libelle, type_structure, niveau_hierarchique,
        date_debut_validite, version_courante, est_actif, utilisateur_creation)
     VALUES ('S1','Struct1','filiale',1,'2026-01-01',true,true,'system')`,
  );
  const struct = (await ds.query(`SELECT id FROM dim_structure`)) as Array<{
    id: string;
  }>;
  await ds.query(
    `INSERT INTO dim_centre_responsabilite
       (code_cr, libelle, type_cr, fk_structure,
        date_debut_validite, version_courante, est_actif, utilisateur_creation)
     VALUES ('CR_A','CR A','profit_center',$1::bigint,'2026-01-01',true,true,'system'),
            ('CR_B','CR B','profit_center',$1::bigint,'2026-01-01',true,true,'system')`,
    [struct[0]!.id],
  );
  const crs = (await ds.query(
    `SELECT id, code_cr FROM dim_centre_responsabilite ORDER BY id`,
  )) as Array<{ id: string; code_cr: string }>;
  const cr1Id = String(crs[0]!.id);

  await ds.query(
    `INSERT INTO dim_compte
       (code_compte, libelle, classe, niveau, est_compte_collectif,
        est_porteur_interets, date_debut_validite, version_courante,
        est_actif, utilisateur_creation)
     VALUES ('611100','Salaires','6',4,false,false,'2026-01-01',true,true,'system')`,
  );
  await ds.query(
    `INSERT INTO dim_ligne_metier
       (code_ligne_metier, libelle, niveau, date_debut_validite,
        version_courante, est_actif, utilisateur_creation)
     VALUES ('RETAIL','Retail',1,'2026-01-01',true,true,'system')`,
  );
  await ds.query(
    `INSERT INTO dim_devise
       (code_iso, libelle, symbole, nb_decimales, est_devise_pivot,
        est_active, utilisateur_creation)
     VALUES ('XOF','Franc CFA','F CFA',0,true,true,'system')`,
  );
  await ds.query(
    `INSERT INTO dim_temps
       (date, annee, trimestre, mois, jour, jour_ouvre, est_fin_de_mois,
        est_fin_de_trimestre, est_fin_d_annee, exercice_fiscal, libelle_mois)
     VALUES ('2027-01-01',2027,1,1,1,true,false,false,false,2027,'Janvier')`,
  );

  // Saisisseur a user_perimetres CR_A uniquement
  await ds.query(
    `INSERT INTO user_perimetres (fk_user, cible_type, cible_id, origine, date_debut, actif, utilisateur_creation)
     VALUES ($1::bigint, 'CR', $2::bigint, 'AFFECTATION', '2026-01-01', true, 'system')`,
    [saiId, cr1Id],
  );

  return {
    adminId,
    saisisseurId: saiId,
    cr1Code: 'CR_A',
    cr1Id,
    compteCode: '611100',
    ligneMetierCode: 'RETAIL',
    deviseCode: 'XOF',
  };
}

function csv(lignes: string[]): {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
} {
  const text = lignes.join('\n');
  const buffer = Buffer.from(text, 'utf-8');
  return {
    buffer,
    originalname: 'realise.csv',
    mimetype: 'text/csv',
    size: buffer.length,
  };
}

const HEADER = 'code_cr,code_compte,code_ligne_metier,mois,code_devise,montant';

describe('RealiseImportService', () => {
  let ds: DataSource;
  let svc: RealiseImportService;
  let auditSvc: AuditService;
  let perimSvc: PerimetreService;
  let refs: SeedRefs;

  beforeAll(async () => {
    ds = await createDataSource();
  });
  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM fait_realise');
    await ds.query('DELETE FROM audit_log');
    await ds.query('DELETE FROM bridge_user_role');
    await ds.query('DELETE FROM ref_role');
    await ds.query('DELETE FROM user_perimetres');
    await ds.query('DELETE FROM dim_centre_responsabilite');
    await ds.query('DELETE FROM dim_structure');
    await ds.query('DELETE FROM dim_temps');
    await ds.query('DELETE FROM dim_compte');
    await ds.query('DELETE FROM dim_ligne_metier');
    await ds.query('DELETE FROM dim_devise');
    await ds.query('DELETE FROM "user"');
    refs = await seed(ds);
    auditSvc = new AuditService(ds.getRepository(AuditLog));
    perimSvc = new PerimetreService(
      ds.getRepository(UserRole),
      ds.getRepository(UserPerimetre),
    );
    svc = new RealiseImportService(ds, perimSvc, auditSvc);
  });

  function admin() {
    return { userId: refs.adminId, email: 'admin@m.io' };
  }
  function saisisseur() {
    return { userId: refs.saisisseurId, email: 'sai@m.io' };
  }

  it('import nominal 1 ligne valide → INSERT + statut IMPORTE + source IMPORT', async () => {
    const file = csv([
      HEADER,
      `${refs.cr1Code},${refs.compteCode},${refs.ligneMetierCode},2027-01,${refs.deviseCode},1500000`,
    ]);
    const r = await svc.importFichier(file, admin());
    expect(r.nbLignesTraitees).toBe(1);
    expect(r.nbLignesCreees).toBe(1);
    expect(r.nbLignesMisesAJour).toBe(0);
    expect(r.nbErreurs).toBe(0);
    const persist = await ds.getRepository(FaitRealise).find();
    expect(persist).toHaveLength(1);
    expect(persist[0]!.statut).toBe('IMPORTE');
    expect(persist[0]!.source).toBe('IMPORT');
    expect(Number(persist[0]!.montant)).toBe(1500000);
  });

  it('code CR inconnu → erreur dans le rapport', async () => {
    const file = csv([
      HEADER,
      `CR_INCONNU,${refs.compteCode},${refs.ligneMetierCode},2027-01,${refs.deviseCode},1000000`,
    ]);
    const r = await svc.importFichier(file, admin());
    expect(r.nbErreurs).toBe(1);
    expect(r.erreurs[0]!.message).toMatch(/CR_INCONNU/);
    expect(r.nbLignesCreees).toBe(0);
  });

  it('mois mal formé → erreur de validation', async () => {
    const file = csv([
      HEADER,
      `${refs.cr1Code},${refs.compteCode},${refs.ligneMetierCode},2027,${refs.deviseCode},1000000`,
    ]);
    const r = await svc.importFichier(file, admin());
    expect(r.nbErreurs).toBe(1);
    expect(r.erreurs[0]!.message).toMatch(/Format YYYY-MM/);
  });

  it('upsert : ligne IMPORTE existante mise à jour', async () => {
    const file1 = csv([
      HEADER,
      `${refs.cr1Code},${refs.compteCode},${refs.ligneMetierCode},2027-01,${refs.deviseCode},1000000`,
    ]);
    await svc.importFichier(file1, admin());
    // 2e import : même clé, montant différent
    const file2 = csv([
      HEADER,
      `${refs.cr1Code},${refs.compteCode},${refs.ligneMetierCode},2027-01,${refs.deviseCode},2500000`,
    ]);
    const r = await svc.importFichier(file2, admin());
    expect(r.nbLignesCreees).toBe(0);
    expect(r.nbLignesMisesAJour).toBe(1);
    const persist = await ds.getRepository(FaitRealise).find();
    expect(persist).toHaveLength(1);
    expect(Number(persist[0]!.montant)).toBe(2500000);
  });

  it('upsert : ligne VALIDE existante → ignorée avec raison', async () => {
    // Première création + validation manuelle SQL (pour éviter la dépendance
    // au RealiseService dans ce spec dédié à l'import).
    const file1 = csv([
      HEADER,
      `${refs.cr1Code},${refs.compteCode},${refs.ligneMetierCode},2027-01,${refs.deviseCode},1000000`,
    ]);
    await svc.importFichier(file1, admin());
    await ds.query(
      `UPDATE fait_realise SET statut='VALIDE', valide_le=NOW(), fk_valide_par=$1::bigint`,
      [refs.adminId],
    );
    const file2 = csv([
      HEADER,
      `${refs.cr1Code},${refs.compteCode},${refs.ligneMetierCode},2027-01,${refs.deviseCode},9999999`,
    ]);
    const r = await svc.importFichier(file2, admin());
    expect(r.nbLignesCreees).toBe(0);
    expect(r.nbLignesMisesAJour).toBe(0);
    expect(r.nbLignesIgnorees).toBe(1);
    expect(r.lignesIgnorees[0]!.raison).toMatch(/déjà validée/);
    const persist = await ds.getRepository(FaitRealise).findOne({ where: {} });
    expect(Number(persist!.montant)).toBe(1000000); // pas modifié
  });

  it('périmètre : ligne CR hors user_perimetres ignorée avec raison', async () => {
    const file = csv([
      HEADER,
      `CR_B,${refs.compteCode},${refs.ligneMetierCode},2027-01,${refs.deviseCode},5000000`,
    ]);
    const r = await svc.importFichier(file, saisisseur());
    expect(r.nbLignesCreees).toBe(0);
    expect(r.nbLignesIgnorees).toBe(1);
    expect(r.lignesIgnorees[0]!.raison).toMatch(/hors de votre périmètre/);
  });

  it('rapport contient les compteurs corrects sur batch mixte', async () => {
    // 1 OK, 1 erreur (CR inconnu), 1 ignorée (déjà validée)
    await svc.importFichier(
      csv([
        HEADER,
        `${refs.cr1Code},${refs.compteCode},${refs.ligneMetierCode},2027-01,${refs.deviseCode},111`,
      ]),
      admin(),
    );
    await ds.query(
      `UPDATE fait_realise SET statut='VALIDE', valide_le=NOW(), fk_valide_par=$1::bigint`,
      [refs.adminId],
    );
    const file = csv([
      HEADER,
      `${refs.cr1Code},${refs.compteCode},${refs.ligneMetierCode},2027-01,${refs.deviseCode},222`,
      `CR_INCONNU,${refs.compteCode},${refs.ligneMetierCode},2027-01,${refs.deviseCode},333`,
    ]);
    const r = await svc.importFichier(file, admin());
    expect(r.nbLignesTraitees).toBe(2);
    expect(r.nbErreurs).toBe(1);
    expect(r.nbLignesIgnorees).toBe(1);
    expect(r.nbLignesCreees + r.nbLignesMisesAJour).toBe(0);
  });

  it('audit IMPORTER_REALISE généré (1 par fichier)', async () => {
    const file = csv([
      HEADER,
      `${refs.cr1Code},${refs.compteCode},${refs.ligneMetierCode},2027-01,${refs.deviseCode},111`,
    ]);
    await svc.importFichier(file, admin());
    const audits = (await ds.query(
      `SELECT 1 FROM audit_log WHERE type_action='IMPORTER_REALISE'`,
    )) as unknown[];
    expect(audits).toHaveLength(1);
  });

  it('header invalide → BadRequestException', async () => {
    const file = csv([
      'col1,col2,col3',
      `${refs.cr1Code},${refs.compteCode},foo`,
    ]);
    await expect(svc.importFichier(file, admin())).rejects.toThrow(
      /Header invalide/,
    );
  });
});
