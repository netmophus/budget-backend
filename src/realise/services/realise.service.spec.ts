/**
 * Tests unitaires RealiseService (Lot 5.1) via pg-mem.
 *
 * Couvre : creer (nominal + doublon + périmètre), modifier
 * (IMPORTE / VALIDE), supprimer (IMPORTE / VALIDE), valider en lot
 * (succès + double validation refusée + audit), getGrille (pas de
 * filtrage périmètre), payload audit avant/après.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';

import { AuditLog } from '../../audit/entities/audit-log.entity';
import { AuditService } from '../../audit/audit.service';
import {
  PerimetreService,
} from '../../budget/services/perimetre.service';
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
import { RealiseService } from './realise.service';

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
      UserPerimetre,
      UserRole,
      User,
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

interface SeedIds {
  adminId: string;
  validateurId: string;
  saisisseurId: string;
  cr1: string; // dans périmètre saisisseur
  cr2: string; // hors périmètre
  compte: string;
  ligneMetier: string;
  temps1: string; // 2027-01-01
  temps2: string;
  devise: string;
}

async function seed(ds: DataSource): Promise<SeedIds> {
  // Users
  await ds.query(
    `INSERT INTO "user" (email, mot_de_passe_hash, nom, prenom, est_actif)
     VALUES ('admin@test.local','h','A','D',true),
            ('val@test.local','h','V','L',true),
            ('sai@test.local','h','S','I',true)`,
  );
  const users = (await ds.query(
    `SELECT email, id FROM "user" ORDER BY id`,
  )) as Array<{ email: string; id: string }>;
  const map = new Map(users.map((u) => [u.email, String(u.id)]));

  // 2 rôles : ADMIN (global) + LECTEUR (utilisé pour saisisseur/validateur,
  // qui ont en plus user_perimetres). PerimetreService.loadRolesActifs
  // exige au moins 1 rôle actif sinon UnauthorizedException.
  await ds.query(
    `INSERT INTO ref_role (code_role, libelle, est_actif, utilisateur_creation)
     VALUES ('ADMIN','Admin',true,'system'),
            ('LECTEUR','Lecteur',true,'system')`,
  );
  const roles = (await ds.query(
    `SELECT id, code_role FROM ref_role`,
  )) as Array<{ id: string; code_role: string }>;
  const roleAdminId = String(
    roles.find((r) => r.code_role === 'ADMIN')!.id,
  );
  const roleLecteurId = String(
    roles.find((r) => r.code_role === 'LECTEUR')!.id,
  );
  await ds.query(
    `INSERT INTO bridge_user_role (fk_user, fk_role, perimetre_type, est_actif, utilisateur_creation)
     VALUES ($1::bigint, $2::bigint, 'global', true, 'system'),
            ($3::bigint, $4::bigint, 'global', true, 'system'),
            ($5::bigint, $4::bigint, 'global', true, 'system')`,
    [
      map.get('admin@test.local'),
      roleAdminId,
      map.get('val@test.local'),
      roleLecteurId,
      map.get('sai@test.local'),
    ],
  );

  // Structure parente d'abord (FK requise par CR)
  await ds.query(
    `INSERT INTO dim_structure
       (code_structure, libelle, type_structure, niveau_hierarchique,
        date_debut_validite, version_courante, est_actif, utilisateur_creation)
     VALUES ('TEST_STRUCT','Structure test','filiale',1,'2026-01-01',true,true,'system')`,
  );
  const struct = (await ds.query(`SELECT id FROM dim_structure`)) as Array<{
    id: string;
  }>;
  // dim_centre_responsabilite (entité TypeORM chargée). Insertion
  // minimale : on utilise les colonnes obligatoires.
  await ds.query(
    `INSERT INTO dim_centre_responsabilite
       (code_cr, libelle, type_cr, fk_structure,
        date_debut_validite, version_courante, est_actif, utilisateur_creation)
     VALUES
       ('CR_1','CR un','profit_center',$1::bigint,'2026-01-01',true,true,'system'),
       ('CR_2','CR deux','profit_center',$1::bigint,'2026-01-01',true,true,'system')`,
    [struct[0]!.id],
  );
  const crs = (await ds.query(
    `SELECT id, code_cr FROM dim_centre_responsabilite ORDER BY id`,
  )) as Array<{ id: string; code_cr: string }>;
  const cr1 = String(crs[0]!.id);
  const cr2 = String(crs[1]!.id);

  // user_perimetres saisisseur sur CR_1
  await ds.query(
    `INSERT INTO user_perimetres (fk_user, cible_type, cible_id, origine, date_debut, actif, utilisateur_creation)
     VALUES ($1::bigint, 'CR', $2::bigint, 'AFFECTATION', '2026-01-01', true, 'system')`,
    [map.get('sai@test.local'), cr1],
  );

  // dim_compte / dim_ligne_metier / dim_devise (entités TypeORM)
  await ds.query(
    `INSERT INTO dim_compte
       (code_compte, libelle, classe, niveau, est_compte_collectif,
        est_porteur_interets, date_debut_validite, version_courante,
        est_actif, utilisateur_creation)
     VALUES ('611100','Salaires','6',4,false,false,'2026-01-01',true,true,'system')`,
  );
  const compte = (await ds.query(`SELECT id FROM dim_compte`)) as Array<{
    id: string;
  }>;

  await ds.query(
    `INSERT INTO dim_ligne_metier
       (code_ligne_metier, libelle, niveau, date_debut_validite,
        version_courante, est_actif, utilisateur_creation)
     VALUES ('RETAIL','Retail',1,'2026-01-01',true,true,'system')`,
  );
  const lm = (await ds.query(`SELECT id FROM dim_ligne_metier`)) as Array<{
    id: string;
  }>;

  await ds.query(
    `INSERT INTO dim_devise
       (code_iso, libelle, symbole, nb_decimales, est_devise_pivot,
        est_active, utilisateur_creation)
     VALUES ('XOF','Franc CFA','F CFA',0,true,true,'system')`,
  );
  const devise = (await ds.query(`SELECT id FROM dim_devise`)) as Array<{
    id: string;
  }>;

  // dim_temps : 2 mois — entité TypeORM avec colonnes obligatoires
  await ds.query(
    `INSERT INTO dim_temps
       (date, annee, trimestre, mois, jour, jour_ouvre, est_fin_de_mois,
        est_fin_de_trimestre, est_fin_d_annee, exercice_fiscal, libelle_mois)
     VALUES
       ('2027-01-01',2027,1,1,1,true,false,false,false,2027,'Janvier'),
       ('2027-02-01',2027,1,2,1,true,false,false,false,2027,'Février')`,
  );
  const temps = (await ds.query(
    `SELECT id, date FROM dim_temps ORDER BY date`,
  )) as Array<{ id: string; date: Date }>;

  return {
    adminId: map.get('admin@test.local')!,
    validateurId: map.get('val@test.local')!,
    saisisseurId: map.get('sai@test.local')!,
    cr1,
    cr2,
    compte: String(compte[0]!.id),
    ligneMetier: String(lm[0]!.id),
    temps1: String(temps[0]!.id),
    temps2: String(temps[1]!.id),
    devise: String(devise[0]!.id),
  };
}

describe('RealiseService', () => {
  let ds: DataSource;
  let svc: RealiseService;
  let auditSvc: AuditService;
  let perimSvc: PerimetreService;
  let ids: SeedIds;

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
    ids = await seed(ds);
    auditSvc = new AuditService(ds.getRepository(AuditLog));
    perimSvc = new PerimetreService(
      ds.getRepository(UserRole),
      ds.getRepository(UserPerimetre),
    );
    svc = new RealiseService(
      ds.getRepository(FaitRealise),
      perimSvc,
      auditSvc,
    );
  });

  const auteur = (id: string) => ({ userId: id, email: `u${id}@m.io` });

  function dtoBase() {
    return {
      fkCentreResponsabilite: ids.cr1,
      fkCompte: ids.compte,
      fkLigneMetier: ids.ligneMetier,
      fkTemps: ids.temps1,
      fkDevise: ids.devise,
      montant: 1_500_000,
    };
  }

  // ─── creer ────────────────────────────────────────────────

  describe('creer', () => {
    it('crée une ligne IMPORTE / source=SAISIE + audit SAISIR_REALISE', async () => {
      const r = await svc.creer(dtoBase(), auteur(ids.saisisseurId));
      expect(r.statut).toBe('IMPORTE');
      expect(r.source).toBe('SAISIE');
      expect(r.montant).toBe(1_500_000);
      const audits = (await ds.query(
        `SELECT type_action FROM audit_log WHERE type_action='SAISIR_REALISE'`,
      )) as Array<{ type_action: string }>;
      expect(audits).toHaveLength(1);
    });

    it('rejet doublon (ConflictException) sur unicité dimensions', async () => {
      await svc.creer(dtoBase(), auteur(ids.saisisseurId));
      await expect(
        svc.creer(dtoBase(), auteur(ids.saisisseurId)),
      ).rejects.toThrow(ConflictException);
    });

    it('rejet périmètre : CR hors user_perimetres → 403', async () => {
      await expect(
        svc.creer(
          { ...dtoBase(), fkCentreResponsabilite: ids.cr2 },
          auteur(ids.saisisseurId),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin global passe sans périmètre user_perimetres', async () => {
      const r = await svc.creer(
        { ...dtoBase(), fkCentreResponsabilite: ids.cr2 },
        auteur(ids.adminId),
      );
      expect(r.fkCentreResponsabilite).toBe(ids.cr2);
    });
  });

  // ─── modifier ─────────────────────────────────────────────

  describe('modifier', () => {
    it('modifie nominal sur statut=IMPORTE + audit avec payloadAvant/Après', async () => {
      const cree = await svc.creer(dtoBase(), auteur(ids.saisisseurId));
      const r = await svc.modifier(
        cree.id,
        { montant: 2_000_000, commentaire: 'rectif' },
        auteur(ids.saisisseurId),
      );
      expect(r.montant).toBe(2_000_000);
      const audits = (await ds.query(
        `SELECT payload_avant, payload_apres FROM audit_log
          WHERE type_action='SAISIR_REALISE' AND id_cible = $1`,
        [r.id],
      )) as Array<{
        payload_avant: { montant: number };
        payload_apres: { montant: number };
      }>;
      const modifs = audits.filter(
        (a) => a.payload_avant && a.payload_avant.montant !== undefined,
      );
      expect(modifs.length).toBeGreaterThan(0);
      expect(modifs[0]!.payload_avant.montant).toBe(1_500_000);
      expect(modifs[0]!.payload_apres.montant).toBe(2_000_000);
    });

    it('rejet 400 sur statut=VALIDE', async () => {
      const cree = await svc.creer(dtoBase(), auteur(ids.saisisseurId));
      await svc.valider([cree.id], auteur(ids.adminId));
      await expect(
        svc.modifier(cree.id, { montant: 99 }, auteur(ids.adminId)),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejet 404 si ligne introuvable', async () => {
      await expect(
        svc.modifier('999999', { montant: 1 }, auteur(ids.adminId)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── supprimer ───────────────────────────────────────────

  describe('supprimer', () => {
    it('supprime nominal + audit SUPPRIMER_REALISE', async () => {
      const cree = await svc.creer(dtoBase(), auteur(ids.saisisseurId));
      await svc.supprimer(cree.id, auteur(ids.saisisseurId));
      const restant = await ds
        .getRepository(FaitRealise)
        .findOne({ where: { id: cree.id } });
      expect(restant).toBeNull();
      const audits = (await ds.query(
        `SELECT 1 FROM audit_log WHERE type_action='SUPPRIMER_REALISE'`,
      )) as unknown[];
      expect(audits).toHaveLength(1);
    });

    it('rejet 400 sur statut=VALIDE', async () => {
      const cree = await svc.creer(dtoBase(), auteur(ids.saisisseurId));
      await svc.valider([cree.id], auteur(ids.adminId));
      await expect(
        svc.supprimer(cree.id, auteur(ids.adminId)),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── valider en lot ───────────────────────────────────────

  describe('valider', () => {
    it('passe N lignes IMPORTE → VALIDE + audit par ligne', async () => {
      const a = await svc.creer(dtoBase(), auteur(ids.saisisseurId));
      const b = await svc.creer(
        { ...dtoBase(), fkTemps: ids.temps2 },
        auteur(ids.saisisseurId),
      );
      const r = await svc.valider(
        [a.id, b.id],
        auteur(ids.validateurId),
      );
      expect(r.nbValidees).toBe(2);
      const lignes = await ds
        .getRepository(FaitRealise)
        .find({ where: [{ id: a.id }, { id: b.id }] });
      for (const l of lignes) {
        expect(l.statut).toBe('VALIDE');
        expect(String(l.fkValidePar)).toBe(ids.validateurId);
        expect(l.valideLe).not.toBeNull();
      }
      const audits = (await ds.query(
        `SELECT 1 FROM audit_log WHERE type_action='VALIDER_REALISE'`,
      )) as unknown[];
      expect(audits).toHaveLength(2);
    });

    it('rejet si une ligne est déjà VALIDE — transaction rollback', async () => {
      const a = await svc.creer(dtoBase(), auteur(ids.saisisseurId));
      await svc.valider([a.id], auteur(ids.validateurId));
      const b = await svc.creer(
        { ...dtoBase(), fkTemps: ids.temps2 },
        auteur(ids.saisisseurId),
      );
      await expect(
        svc.valider([a.id, b.id], auteur(ids.validateurId)),
      ).rejects.toThrow(BadRequestException);
      // b reste IMPORTE (rollback préventif)
      const lignes = await ds
        .getRepository(FaitRealise)
        .findOne({ where: { id: b.id } });
      expect(lignes!.statut).toBe('IMPORTE');
    });

    it('rejet 404 si ligne inexistante dans la liste', async () => {
      await expect(
        svc.valider(['999999'], auteur(ids.validateurId)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── lecture ──────────────────────────────────────────────

  describe('getGrille / lister', () => {
    it('getGrille pas de filtrage périmètre (lecture transverse)', async () => {
      // Saisie sur CR_1 depuis admin (le saisisseur n'a pas accès à CR_2)
      await svc.creer(dtoBase(), auteur(ids.adminId));
      // getGrille appelé par un user qui n'a pas d'accès écriture au CR
      // → la lecture passe quand même.
      const grille = await svc.getGrille({
        crId: ids.cr1,
        moisDebut: '2027-01',
        moisFin: '2027-12',
      });
      expect(grille).toHaveLength(1);
    });

    it('lister avec filtre statut', async () => {
      const a = await svc.creer(dtoBase(), auteur(ids.saisisseurId));
      await svc.valider([a.id], auteur(ids.validateurId));
      const r = await svc.lister({ statut: 'VALIDE' });
      expect(r.items).toHaveLength(1);
      expect(r.items[0]!.statut).toBe('VALIDE');
    });
  });
});
