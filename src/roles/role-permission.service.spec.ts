/**
 * Tests unitaires RolePermissionService (PR A) via pg-mem.
 *
 * Couvre l'édition de la matrice bridge_role_permission :
 *  - ajouter (nominal + idempotent)
 *  - retirer (nominal)
 *  - garde-fous : permissions verrouillées sur ADMIN (SYSTEM.ADMIN,
 *    ROLE.GERER, USER.GERER) + anti-lockout ROLE.GERER.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';

import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { RolePermissionService } from './role-permission.service';

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
    entities: [User, UserRole, Role, Permission, RolePermission, AuditLog],
    synchronize: true,
  }) as DataSource;
  await ds.initialize();
  return ds;
}

interface SeedIds {
  adminUserId: string;
  rhUserId: string;
  roleAdminId: string;
  roleSaisisseurId: string;
  roleRhId: string;
  permSystemAdminId: string;
  permRoleGererId: string;
  permUserGererId: string;
  permBudgetSaisirId: string;
  permBudgetLireId: string;
}

async function seed(ds: DataSource): Promise<SeedIds> {
  await ds.query(
    `INSERT INTO ref_role (code_role, libelle, est_actif, utilisateur_creation)
     VALUES ('ADMIN','Admin',true,'system'),
            ('SAISISSEUR','Saisisseur',true,'system'),
            ('GESTION_RH','Gestion RH',true,'system')`,
  );
  const roles = (await ds.query(
    `SELECT id, code_role FROM ref_role`,
  )) as Array<{ id: string; code_role: string }>;
  const roleId = (c: string) =>
    String(roles.find((r) => r.code_role === c)!.id);

  await ds.query(
    `INSERT INTO ref_permission (code_permission, libelle, module, utilisateur_creation)
     VALUES ('SYSTEM.ADMIN','Admin système','SYSTEM','system'),
            ('ROLE.GERER','Gérer les rôles','ROLE','system'),
            ('USER.GERER','Gérer les users','USER','system'),
            ('BUDGET.SAISIR','Saisir budget','BUDGET','system'),
            ('BUDGET.LIRE','Lire budget','BUDGET','system')`,
  );
  const perms = (await ds.query(
    `SELECT id, code_permission FROM ref_permission`,
  )) as Array<{ id: string; code_permission: string }>;
  const permId = (c: string) =>
    String(perms.find((p) => p.code_permission === c)!.id);

  // ADMIN porte les 3 permissions protégées + BUDGET.SAISIR.
  for (const code of [
    'SYSTEM.ADMIN',
    'ROLE.GERER',
    'USER.GERER',
    'BUDGET.SAISIR',
  ]) {
    await ds.query(
      `INSERT INTO bridge_role_permission (fk_role, fk_permission)
       VALUES ($1::bigint, $2::bigint)`,
      [roleId('ADMIN'), permId(code)],
    );
  }
  // GESTION_RH porte ROLE.GERER (rôle métier non protégé → terrain de
  // l'anti-lockout).
  await ds.query(
    `INSERT INTO bridge_role_permission (fk_role, fk_permission)
     VALUES ($1::bigint, $2::bigint)`,
    [roleId('GESTION_RH'), permId('ROLE.GERER')],
  );

  await ds.query(
    `INSERT INTO "user" (email, mot_de_passe_hash, nom, prenom, est_actif, utilisateur_creation)
     VALUES ('admin@test.local','h','A','Dmin',true,'system'),
            ('rh@test.local','h','R','H',true,'system')`,
  );
  const users = (await ds.query(`SELECT id, email FROM "user"`)) as Array<{
    id: string;
    email: string;
  }>;
  const userId = (e: string) => String(users.find((u) => u.email === e)!.id);

  // Le user RH porte le rôle GESTION_RH (pour exercer l'anti-lockout).
  await ds.query(
    `INSERT INTO bridge_user_role (fk_user, fk_role, perimetre_type, est_actif, utilisateur_creation)
     VALUES ($1::bigint, $2::bigint, 'global', true, 'system')`,
    [userId('rh@test.local'), roleId('GESTION_RH')],
  );

  return {
    adminUserId: userId('admin@test.local'),
    rhUserId: userId('rh@test.local'),
    roleAdminId: roleId('ADMIN'),
    roleSaisisseurId: roleId('SAISISSEUR'),
    roleRhId: roleId('GESTION_RH'),
    permSystemAdminId: permId('SYSTEM.ADMIN'),
    permRoleGererId: permId('ROLE.GERER'),
    permUserGererId: permId('USER.GERER'),
    permBudgetSaisirId: permId('BUDGET.SAISIR'),
    permBudgetLireId: permId('BUDGET.LIRE'),
  };
}

describe('RolePermissionService', () => {
  let ds: DataSource;
  let svc: RolePermissionService;
  let ids: SeedIds;

  beforeAll(async () => {
    ds = await createDataSource();
  });
  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM bridge_user_role');
    await ds.query('DELETE FROM bridge_role_permission');
    await ds.query('DELETE FROM "user"');
    await ds.query('DELETE FROM ref_permission');
    await ds.query('DELETE FROM ref_role');
    await ds.query('DELETE FROM audit_log');
    ids = await seed(ds);
    const auditSvc = new AuditService(ds.getRepository(AuditLog));
    svc = new RolePermissionService(
      ds.getRepository(Role),
      ds.getRepository(Permission),
      ds.getRepository(RolePermission),
      ds.getRepository(UserRole),
      auditSvc,
    );
  });

  const admin = () => ({ userId: ids.adminUserId, email: 'admin@test.local' });
  const rh = () => ({ userId: ids.rhUserId, email: 'rh@test.local' });

  async function nbLien(roleId: string, permId: string): Promise<number> {
    const rows = (await ds.query(
      `SELECT 1 FROM bridge_role_permission
        WHERE fk_role=$1::bigint AND fk_permission=$2::bigint`,
      [roleId, permId],
    )) as unknown[];
    return rows.length;
  }

  // ─── ajouter ──────────────────────────────────────────────────

  it('ajouter une permission absente : crée le lien + audit ATTRIBUER_PERMISSION', async () => {
    const r = await svc.ajouterPermission(
      ids.roleSaisisseurId,
      ids.permBudgetLireId,
      admin(),
    );
    expect(r.deja).toBe(false);
    expect(r.codePermission).toBe('BUDGET.LIRE');
    expect(await nbLien(ids.roleSaisisseurId, ids.permBudgetLireId)).toBe(1);
    const audits = (await ds.query(
      `SELECT 1 FROM audit_log WHERE type_action='ATTRIBUER_PERMISSION'`,
    )) as unknown[];
    expect(audits).toHaveLength(1);
  });

  it('ajouter une permission déjà présente : idempotent (deja=true, pas de doublon, pas d’audit)', async () => {
    await svc.ajouterPermission(
      ids.roleSaisisseurId,
      ids.permBudgetLireId,
      admin(),
    );
    const r = await svc.ajouterPermission(
      ids.roleSaisisseurId,
      ids.permBudgetLireId,
      admin(),
    );
    expect(r.deja).toBe(true);
    expect(await nbLien(ids.roleSaisisseurId, ids.permBudgetLireId)).toBe(1);
    const audits = (await ds.query(
      `SELECT 1 FROM audit_log WHERE type_action='ATTRIBUER_PERMISSION'`,
    )) as unknown[];
    // Un seul audit (le 1er ajout), pas pour le no-op idempotent.
    expect(audits).toHaveLength(1);
  });

  it('ajouter sur un rôle introuvable : NotFound', async () => {
    await expect(
      svc.ajouterPermission('999999', ids.permBudgetLireId, admin()),
    ).rejects.toThrow(NotFoundException);
  });

  // ─── retirer (nominal) ────────────────────────────────────────

  it('retirer une permission non protégée : supprime le lien + audit RETIRER_PERMISSION', async () => {
    const r = await svc.retirerPermission(
      ids.roleAdminId,
      ids.permBudgetSaisirId,
      admin(),
    );
    expect(r.deja).toBe(false);
    expect(await nbLien(ids.roleAdminId, ids.permBudgetSaisirId)).toBe(0);
    const audits = (await ds.query(
      `SELECT 1 FROM audit_log WHERE type_action='RETIRER_PERMISSION'`,
    )) as unknown[];
    expect(audits).toHaveLength(1);
  });

  it('retirer une permission non possédée par le rôle : NotFound', async () => {
    await expect(
      svc.retirerPermission(
        ids.roleSaisisseurId,
        ids.permBudgetLireId,
        admin(),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // ─── garde-fous : permissions verrouillées sur ADMIN ──────────

  it('retirer SYSTEM.ADMIN du rôle ADMIN : Forbidden', async () => {
    await expect(
      svc.retirerPermission(ids.roleAdminId, ids.permSystemAdminId, admin()),
    ).rejects.toThrow(ForbiddenException);
    expect(await nbLien(ids.roleAdminId, ids.permSystemAdminId)).toBe(1);
  });

  it('retirer ROLE.GERER du rôle ADMIN : Forbidden', async () => {
    await expect(
      svc.retirerPermission(ids.roleAdminId, ids.permRoleGererId, admin()),
    ).rejects.toThrow(ForbiddenException);
    expect(await nbLien(ids.roleAdminId, ids.permRoleGererId)).toBe(1);
  });

  it('retirer USER.GERER du rôle ADMIN : Forbidden', async () => {
    await expect(
      svc.retirerPermission(ids.roleAdminId, ids.permUserGererId, admin()),
    ).rejects.toThrow(ForbiddenException);
    expect(await nbLien(ids.roleAdminId, ids.permUserGererId)).toBe(1);
  });

  // ─── garde-fou : anti-lockout ─────────────────────────────────

  it('anti-lockout : un user retire ROLE.GERER d’un rôle qu’il porte : Forbidden', async () => {
    // rh@test.local porte GESTION_RH qui possède ROLE.GERER.
    await expect(
      svc.retirerPermission(ids.roleRhId, ids.permRoleGererId, rh()),
    ).rejects.toThrow(ForbiddenException);
    expect(await nbLien(ids.roleRhId, ids.permRoleGererId)).toBe(1);
  });

  it('anti-lockout ciblé : un user qui NE porte PAS le rôle peut retirer ROLE.GERER de ce rôle', async () => {
    // admin@test.local ne porte pas GESTION_RH → retrait autorisé.
    const r = await svc.retirerPermission(
      ids.roleRhId,
      ids.permRoleGererId,
      admin(),
    );
    expect(r.deja).toBe(false);
    expect(await nbLien(ids.roleRhId, ids.permRoleGererId)).toBe(0);
  });
});
