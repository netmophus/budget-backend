/**
 * Tests unitaires UsersAdminService (Lot Administration) via pg-mem.
 *
 * Couverture exhaustive : CRUD + reset password + forcer déconnexion +
 * historique connexion + rôles (attribuer/retirer + cumul).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';

import { AuditLog } from '../../audit/entities/audit-log.entity';
import { AuditService } from '../../audit/audit.service';
import type { AuthService } from '../../auth/auth.service';
import type { EmailQueueProducer } from '../../notifications/email-queue.producer';
import { EmailLog } from '../../notifications/entities/email-log.entity';
import { Permission } from '../../roles/entities/permission.entity';
import { Role } from '../../roles/entities/role.entity';
import { RolePermission } from '../../roles/entities/role-permission.entity';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/user-role.entity';
import { UsersAdminService } from './users-admin.service';

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
      User,
      UserRole,
      Role,
      Permission,
      RolePermission,
      AuditLog,
      EmailLog,
    ],
    synchronize: true,
  }) as DataSource;
  await ds.initialize();
  return ds;
}

interface SeedIds {
  adminId: string;
  ciblId: string;
  roleAdminId: string;
  roleSaisisseurId: string;
  roleValidateurId: string;
}

async function seed(ds: DataSource): Promise<SeedIds> {
  await ds.query(
    `INSERT INTO ref_role (code_role, libelle, est_actif, utilisateur_creation)
     VALUES ('ADMIN','Admin',true,'system'),
            ('SAISISSEUR','Saisisseur',true,'system'),
            ('VALIDATEUR','Validateur',true,'system')`,
  );
  const roles = (await ds.query(
    `SELECT id, code_role FROM ref_role`,
  )) as Array<{ id: string; code_role: string }>;
  const roleId = (code: string) =>
    String(roles.find((r) => r.code_role === code)!.id);

  await ds.query(
    `INSERT INTO "user" (email, mot_de_passe_hash, nom, prenom, est_actif, utilisateur_creation)
     VALUES ('admin@test.local','h','A','Dmin',true,'system'),
            ('cible@test.local','h','C','Ible',true,'system')`,
  );
  const users = (await ds.query(`SELECT id, email FROM "user"`)) as Array<{
    id: string;
    email: string;
  }>;
  const adminId = String(users.find((u) => u.email === 'admin@test.local')!.id);
  const ciblId = String(users.find((u) => u.email === 'cible@test.local')!.id);

  // Le user "cible" a déjà 1 rôle (SAISISSEUR) pour les tests rôles.
  await ds.query(
    `INSERT INTO bridge_user_role (fk_user, fk_role, perimetre_type, est_actif, utilisateur_creation)
     VALUES ($1::bigint, $2::bigint, 'global', true, 'system')`,
    [ciblId, roleId('SAISISSEUR')],
  );

  return {
    adminId,
    ciblId,
    roleAdminId: roleId('ADMIN'),
    roleSaisisseurId: roleId('SAISISSEUR'),
    roleValidateurId: roleId('VALIDATEUR'),
  };
}

function makeAuthMock(): AuthService {
  return {
    revokerTousTokensActifs: jest.fn().mockResolvedValue(undefined),
    // Lot 6.4.A — utilisé par resetPassword pour calculer la date
    // d'expiration du mdp temporaire (now + 7 jours).
    nouvelleDateExpiration: jest.fn(
      (jours?: number) => new Date(Date.now() + (jours ?? 90) * 86_400_000),
    ),
  } as unknown as AuthService;
}

interface QueueMock {
  publier: jest.Mock;
}

function makeQueueMock(): EmailQueueProducer & QueueMock {
  return {
    publier: jest.fn().mockResolvedValue(undefined),
  } as unknown as EmailQueueProducer & QueueMock;
}

describe('UsersAdminService', () => {
  let ds: DataSource;
  let svc: UsersAdminService;
  let auditSvc: AuditService;
  let authMock: AuthService;
  let queueMock: EmailQueueProducer & QueueMock;
  let ids: SeedIds;

  beforeAll(async () => {
    ds = await createDataSource();
  });
  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM bridge_user_role');
    await ds.query('DELETE FROM "user"');
    await ds.query('DELETE FROM ref_role');
    await ds.query('DELETE FROM audit_log');
    ids = await seed(ds);
    auditSvc = new AuditService(ds.getRepository(AuditLog));
    authMock = makeAuthMock();
    queueMock = makeQueueMock();
    svc = new UsersAdminService(
      ds.getRepository(User),
      ds.getRepository(UserRole),
      ds.getRepository(Role),
      ds.getRepository(EmailLog), // Lot 6.4.C
      auditSvc,
      authMock,
      queueMock, // Lot 6.4.C
    );
  });

  const auteur = (id: string) => ({ userId: id, email: 'admin@test.local' });

  // ─── creer ────────────────────────────────────────────────────

  describe('creer', () => {
    it('création nominale avec hash bcrypt + ligne(s) bridge_user_role + audit CREER_USER', async () => {
      const r = await svc.creer(
        {
          email: 'nouveau@test.local',
          nom: 'Diallo',
          prenom: 'Aïcha',
          motDePasseInitial: 'PassWord!2026',
          fkRoles: [ids.roleSaisisseurId],
        },
        auteur(ids.adminId),
      );
      expect(r.email).toBe('nouveau@test.local');
      const persist = await ds
        .getRepository(User)
        .findOne({ where: { email: 'nouveau@test.local' } });
      expect(persist).not.toBeNull();
      expect(
        await bcrypt.compare('PassWord!2026', persist!.motDePasseHash),
      ).toBe(true);
      const roles = await ds
        .getRepository(UserRole)
        .find({ where: { fkUser: r.id, estActif: true } });
      expect(roles).toHaveLength(1);
      const audits = (await ds.query(
        `SELECT type_action, payload_apres FROM audit_log WHERE type_action='CREER_USER'`,
      )) as Array<{
        type_action: string;
        payload_apres: Record<string, unknown>;
      }>;
      expect(audits).toHaveLength(1);
      // Le mot de passe en clair ne doit JAMAIS apparaître dans l'audit.
      const payloadStr = JSON.stringify(audits[0]!.payload_apres);
      expect(payloadStr).not.toContain('PassWord!2026');
    });

    it('rejette si email déjà utilisé (Conflict)', async () => {
      await expect(
        svc.creer(
          {
            email: 'cible@test.local',
            nom: 'X',
            prenom: 'Y',
            motDePasseInitial: 'PassWord!2026',
            fkRoles: [ids.roleSaisisseurId],
          },
          auteur(ids.adminId),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejette si rôle inexistant (BadRequest)', async () => {
      await expect(
        svc.creer(
          {
            email: 'nouveau@test.local',
            nom: 'X',
            prenom: 'Y',
            motDePasseInitial: 'PassWord!2026',
            fkRoles: ['999999'],
          },
          auteur(ids.adminId),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('création multi-rôles (cumul) crée 2 lignes bridge', async () => {
      const r = await svc.creer(
        {
          email: 'multi@test.local',
          nom: 'Multi',
          prenom: 'Rolu',
          motDePasseInitial: 'PassWord!2026',
          fkRoles: [ids.roleSaisisseurId, ids.roleValidateurId],
        },
        auteur(ids.adminId),
      );
      const roles = await ds
        .getRepository(UserRole)
        .find({ where: { fkUser: r.id, estActif: true } });
      expect(roles).toHaveLength(2);
    });
  });

  // ─── modifier ─────────────────────────────────────────────────

  describe('modifier', () => {
    it('modifie nom/prenom/email', async () => {
      const r = await svc.modifier(
        ids.ciblId,
        {
          nom: 'NouveauNom',
          prenom: 'Nouveau',
          email: 'cible-modif@test.local',
        },
        auteur(ids.adminId),
      );
      expect(r.nom).toBe('NouveauNom');
      expect(r.email).toBe('cible-modif@test.local');
    });

    it('rejette si email collisionne avec un autre user', async () => {
      await expect(
        svc.modifier(
          ids.ciblId,
          { email: 'admin@test.local' },
          auteur(ids.adminId),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejette user introuvable (NotFound)', async () => {
      await expect(
        svc.modifier('999999', { nom: 'Z' }, auteur(ids.adminId)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── desactiver / reactiver ───────────────────────────────────

  describe('desactiver / reactiver', () => {
    it('desactiver passe estActif=false + audit DESACTIVER_USER', async () => {
      const r = await svc.desactiver(ids.ciblId, auteur(ids.adminId));
      expect(r.estActif).toBe(false);
      const audits = (await ds.query(
        `SELECT 1 FROM audit_log WHERE type_action='DESACTIVER_USER'`,
      )) as unknown[];
      expect(audits).toHaveLength(1);
    });

    it('refuse auto-désactivation (Forbidden)', async () => {
      await expect(
        svc.desactiver(ids.adminId, auteur(ids.adminId)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('reactiver passe estActif=true + audit REACTIVER_USER', async () => {
      await svc.desactiver(ids.ciblId, auteur(ids.adminId));
      const r = await svc.reactiver(ids.ciblId, auteur(ids.adminId));
      expect(r.estActif).toBe(true);
      const audits = (await ds.query(
        `SELECT 1 FROM audit_log WHERE type_action='REACTIVER_USER'`,
      )) as unknown[];
      expect(audits).toHaveLength(1);
    });
  });

  // ─── reset password ────────────────────────────────────────────

  describe('resetPassword', () => {
    it('génère un mdp temporaire (≥12 chars, conforme à la policy), force doit_changer_mdp + expiration 7j, publie un job email avec mdp en secret (pas en payload), réponse API SANS mdp', async () => {
      const r = await svc.resetPassword(ids.ciblId, auteur(ids.adminId));

      // 1. Réponse API : success + message, PAS de motDePasseTemporaire
      // (breaking change Lot 6.4.C).
      expect(r).toEqual({
        success: true,
        message: expect.stringContaining('cible@test.local'),
      });
      expect(
        (r as unknown as { motDePasseTemporaire?: string })
          .motDePasseTemporaire,
      ).toBeUndefined();

      // 2. User en base : doit_changer_mdp=true, date_expiration_mdp posée,
      //    nouveau hash bcrypt.
      const u = await ds
        .getRepository(User)
        .findOne({ where: { id: ids.ciblId } });
      expect(u!.doitChangerMdp).toBe(true);
      expect(u!.dateExpirationMdp).not.toBeNull();
      // L'expiration est ~7 jours dans le futur (tolérance 1 min).
      const diffMs = u!.dateExpirationMdp!.getTime() - Date.now();
      expect(diffMs).toBeGreaterThan(6 * 86_400_000);
      expect(diffMs).toBeLessThan(8 * 86_400_000);

      // 3. Job email publié avec secrets (mdp en clair dans les
      //    secrets BullMQ, pas en email_log.payload).
      expect(queueMock.publier).toHaveBeenCalledTimes(1);
      const [emailLogId, secrets] = queueMock.publier.mock.calls[0] as [
        string | number, // pg-mem renvoie les bigint en number, Postgres en string
        Record<string, string>,
      ];
      expect(emailLogId).toBeDefined();
      expect(secrets).toEqual(
        expect.objectContaining({
          mdpTemporaire: expect.any(String),
          dateExpiration: expect.any(String),
        }),
      );
      const mdpClair = secrets.mdpTemporaire;
      expect(mdpClair.length).toBeGreaterThanOrEqual(12);
      expect(mdpClair).toMatch(/[A-Z]/);
      expect(mdpClair).toMatch(/[a-z]/);
      expect(mdpClair).toMatch(/[0-9]/);
      expect(mdpClair).toMatch(/[^A-Za-z0-9]/);
      // Le mdp clair valide bien le hash bcrypt en base.
      expect(await bcrypt.compare(mdpClair, u!.motDePasseHash)).toBe(true);

      // 4. email_log inséré statut EN_ATTENTE, payload SANS mdp.
      const log = await ds
        .getRepository(EmailLog)
        .findOne({ where: { id: String(emailLogId) } });
      expect(log).not.toBeNull();
      expect(log!.statut).toBe('EN_ATTENTE');
      expect(log!.evenement).toBe('RESET_PASSWORD_ADMIN');
      expect(JSON.stringify(log!.payload)).not.toContain(mdpClair);

      // 5. SÉCURITÉ : le mdp en clair n'apparaît PAS dans audit_log.
      const audits = (await ds.query(
        `SELECT payload_apres, commentaire FROM audit_log
          WHERE type_action='RESET_PASSWORD_USER'`,
      )) as Array<{ payload_apres: unknown; commentaire: string }>;
      expect(audits).toHaveLength(1);
      const blob = JSON.stringify(audits[0]) + audits[0]!.commentaire;
      expect(blob).not.toContain(mdpClair);
    });
  });

  // ─── forcer déconnexion ───────────────────────────────────────

  describe('forcerDeconnexion', () => {
    it('appelle authService.revokerTousTokensActifs + audit', async () => {
      const r = await svc.forcerDeconnexion(ids.ciblId, auteur(ids.adminId));
      expect(r.revoquees).toBe(true);
      expect(authMock.revokerTousTokensActifs).toHaveBeenCalledWith(
        ids.ciblId,
        'forced',
      );
      const audits = (await ds.query(
        `SELECT 1 FROM audit_log WHERE type_action='FORCER_DECONNEXION_USER'`,
      )) as unknown[];
      expect(audits).toHaveLength(1);
    });
  });

  // ─── historique ───────────────────────────────────────────────

  describe('getHistoriqueConnexion', () => {
    it('retourne les 50 dernières lignes LOGIN/LOGIN_FAILED/LOGOUT', async () => {
      const u = await ds
        .getRepository(User)
        .findOne({ where: { id: ids.ciblId } });
      // Insérons quelques entrées audit
      for (const t of ['LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'CREER_USER']) {
        await ds.query(
          `INSERT INTO audit_log (type_action, utilisateur, entite_cible, statut, ip_source, user_agent)
           VALUES ($1, $2, 'user', 'success', '10.0.0.1', 'Mozilla/5.0')`,
          [t, u!.email],
        );
      }
      const r = await svc.getHistoriqueConnexion(ids.ciblId);
      // CREER_USER exclu, donc 3 entrées
      expect(r).toHaveLength(3);
      expect(r.map((x) => x.typeAction).sort()).toEqual([
        'LOGIN',
        'LOGIN_FAILED',
        'LOGOUT',
      ]);
    });
  });

  // ─── rôles ────────────────────────────────────────────────────

  describe('rôles (attribuer/retirer + cumul)', () => {
    it('attribuer un rôle absent : crée la ligne + audit ATTRIBUER_ROLE', async () => {
      const r = await svc.attribuerRole(
        ids.ciblId,
        { fkRole: ids.roleValidateurId, motif: 'Cumul SAISISSEUR+VALIDATEUR' },
        auteur(ids.adminId),
      );
      expect(r.codeRole).toBe('VALIDATEUR');
      expect(r.estActif).toBe(true);
      const audits = (await ds.query(
        `SELECT 1 FROM audit_log WHERE type_action='ATTRIBUER_ROLE'`,
      )) as unknown[];
      expect(audits).toHaveLength(1);
    });

    it('attribuer un rôle déjà actif : idempotent (pas de doublon)', async () => {
      await svc.attribuerRole(
        ids.ciblId,
        { fkRole: ids.roleValidateurId },
        auteur(ids.adminId),
      );
      await svc.attribuerRole(
        ids.ciblId,
        { fkRole: ids.roleValidateurId },
        auteur(ids.adminId),
      );
      const lignes = await ds
        .getRepository(UserRole)
        .find({ where: { fkUser: ids.ciblId, fkRole: ids.roleValidateurId } });
      expect(lignes).toHaveLength(1);
    });

    it('attribuer un rôle inactif : le réactive', async () => {
      // Désactiver d'abord
      await ds.query(
        `UPDATE bridge_user_role SET est_actif=false
          WHERE fk_user=$1::bigint AND fk_role=$2::bigint`,
        [ids.ciblId, ids.roleSaisisseurId],
      );
      const r = await svc.attribuerRole(
        ids.ciblId,
        { fkRole: ids.roleSaisisseurId },
        auteur(ids.adminId),
      );
      expect(r.estActif).toBe(true);
    });

    it('lister rôles : retourne uniquement les actifs', async () => {
      await svc.attribuerRole(
        ids.ciblId,
        { fkRole: ids.roleValidateurId },
        auteur(ids.adminId),
      );
      const r = await svc.listerRoles(ids.ciblId);
      expect(r.map((x) => x.codeRole).sort()).toEqual([
        'SAISISSEUR',
        'VALIDATEUR',
      ]);
    });

    it('retirer un rôle parmi 2 : OK (≥1 reste)', async () => {
      await svc.attribuerRole(
        ids.ciblId,
        { fkRole: ids.roleValidateurId },
        auteur(ids.adminId),
      );
      const r = await svc.retirerRole(
        ids.ciblId,
        ids.roleSaisisseurId,
        { motif: 'Bascule rôle' },
        auteur(ids.adminId),
      );
      expect(r.retire).toBe(true);
      const restants = await svc.listerRoles(ids.ciblId);
      expect(restants).toHaveLength(1);
      expect(restants[0]!.codeRole).toBe('VALIDATEUR');
    });

    it('retirer le DERNIER rôle actif : refusé (BadRequest)', async () => {
      await expect(
        svc.retirerRole(
          ids.ciblId,
          ids.roleSaisisseurId,
          {},
          auteur(ids.adminId),
        ),
      ).rejects.toThrow(/au moins un rôle actif/);
    });

    it('retirer un rôle non attribué : NotFound', async () => {
      await expect(
        svc.retirerRole(ids.ciblId, ids.roleAdminId, {}, auteur(ids.adminId)),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
