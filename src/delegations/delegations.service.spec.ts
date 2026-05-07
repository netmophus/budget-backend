/**
 * Tests unitaires DelegationsService (Lot 4.2.A) via pg-mem.
 *
 * Couvre :
 *  - Création (cas passant + 9 cas de rejet incl. anti-chaînage)
 *  - Révocation (3 cas dont 403 par tiers)
 *  - Listing (delegataire / emis / toutes)
 *  - expirerAutomatiquement (6 cas)
 *  - Audit (CREER/REVOQUER/EXPIRER_DELEGATION)
 */
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';

import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import {
  type EffectivePermission,
  PermissionsService,
} from '../auth/permissions.service';
import { Permission } from '../roles/entities/permission.entity';
import { Role } from '../roles/entities/role.entity';
import { RolePermission } from '../roles/entities/role-permission.entity';
import { User } from '../users/entities/user.entity';
import { UserPerimetre } from '../users/entities/user-perimetre.entity';
import { UserRole } from '../users/entities/user-role.entity';
import { DelegationsService } from './delegations.service';
import { Delegation } from './entities/delegation.entity';

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
  const ds = db.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: [
      User,
      UserRole,
      UserPerimetre,
      Role,
      Permission,
      RolePermission,
      AuditLog,
      Delegation,
    ],
    synchronize: true,
  }) as DataSource;
  await ds.initialize();
  return ds;
}

interface SeedIds {
  delegantId: string;
  delegataireId: string;
  tiersId: string;
  perimetreNatifId: string;
  perimetreNatif2Id: string;
  perimetreDelegueId: string; // origine='DELEGATION' (pour anti-chaînage)
}

async function seed(ds: DataSource): Promise<SeedIds> {
  await ds.query(
    `INSERT INTO "user" (email, mot_de_passe_hash, nom, prenom, est_actif, utilisateur_creation)
     VALUES
       ('delegant@miznas.local','h','Delegant','X', true, 'system'),
       ('delegataire@miznas.local','h','Delegataire','Y', true, 'system'),
       ('tiers@miznas.local','h','Tiers','Z', true, 'system')`,
  );
  const users = (await ds.query(
    `SELECT email, id FROM "user"`,
  )) as Array<{ email: string; id: string }>;
  const map = new Map(users.map((u) => [u.email, String(u.id)]));
  const delegantId = map.get('delegant@miznas.local')!;
  const delegataireId = map.get('delegataire@miznas.local')!;
  const tiersId = map.get('tiers@miznas.local')!;

  // Périmètres pour le délégant : 2 natifs (origine=AFFECTATION) +
  // 1 délégué (origine=DELEGATION) pour tester anti-chaînage.
  // date_debut volontairement très ancienne pour que les tests
  // d'expiration (date_fin=2024-12-31) puissent créer des
  // délégations valides à partir d'un périmètre encore actif.
  await ds.query(
    `INSERT INTO user_perimetres (fk_user, cible_type, cible_id, origine, date_debut, actif, utilisateur_creation)
     VALUES
       ($1::bigint, 'CR', 100::bigint, 'AFFECTATION', '2020-01-01', true, 'system'),
       ($1::bigint, 'CR', 101::bigint, 'AFFECTATION', '2020-01-01', true, 'system'),
       ($1::bigint, 'CR', 102::bigint, 'DELEGATION',  '2020-01-01', true, 'system')`,
    [delegantId],
  );
  const perims = (await ds.query(
    `SELECT id, cible_id, origine FROM user_perimetres WHERE fk_user = $1::bigint ORDER BY id`,
    [delegantId],
  )) as Array<{ id: string; cible_id: string; origine: string }>;
  return {
    delegantId,
    delegataireId,
    tiersId,
    perimetreNatifId: String(perims[0]!.id),
    perimetreNatif2Id: String(perims[1]!.id),
    perimetreDelegueId: String(perims[2]!.id),
  };
}

/** Mock minimal de PermissionsService pour les tests unitaires. */
function makePermissionsServiceMock(
  permsParUser: Record<string, string[]>,
): PermissionsService {
  return {
    getEffectivePermissions: async (userId: string): Promise<EffectivePermission[]> => {
      const codes = permsParUser[userId] ?? [];
      return codes.map((c) => ({
        code_permission: c,
        module: 'BUDGET',
        perimetre_type: 'global' as const,
        perimetre_id: null,
      }));
    },
    hasPermission: async () => true,
    getPermissionsEffectivesAvecContexte: async () => [],
  } as unknown as PermissionsService;
}

describe('DelegationsService', () => {
  let ds: DataSource;
  let service: DelegationsService;
  let auditService: AuditService;
  let ids: SeedIds;

  beforeAll(async () => {
    ds = await createDataSource();
  });

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM delegations');
    await ds.query('DELETE FROM user_perimetres');
    await ds.query('DELETE FROM audit_log');
    await ds.query('DELETE FROM "user"');
    ids = await seed(ds);

    auditService = new AuditService(ds.getRepository(AuditLog));
    // Délégant a toutes les permissions BUDGET — délégataire aucune
    const permsMock = makePermissionsServiceMock({
      [ids.delegantId]: [
        'BUDGET.SAISIR',
        'BUDGET.SOUMETTRE',
        'BUDGET.VALIDER',
        'BUDGET.PUBLIER',
      ],
      [ids.delegataireId]: [],
    });
    service = new DelegationsService(
      ds.getRepository(Delegation),
      ds.getRepository(UserPerimetre),
      ds.getRepository(User),
      auditService,
      permsMock,
    );
  });

  // ─── Création (≥ 12 cas) ─────────────────────────────────────────

  const baseDto = (
    delegataireId: string,
    perimetreId: string,
    overrides: Partial<{
      permissions: string[];
      dateDebut: string;
      dateFin: string;
      motif: string;
    }> = {},
  ) =>
    ({
      fkDelegataire: delegataireId,
      perimetreUserPerimetreIds: [perimetreId],
      permissions: ['VALIDATION'],
      motif: 'Mission BCEAO',
      dateDebut: '2027-01-01',
      dateFin: '2027-01-31',
      ...overrides,
    }) as never;

  it('cas passant : création OK + miroir user_perimetres + audit', async () => {
    const r = await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    expect(r.delegation.id).toBeDefined();
    expect(r.delegation.actif).toBe(true);
    expect(r.warnings).toEqual([]);

    // Miroir user_perimetres
    const miroirs = (await ds.query(
      `SELECT origine, delegation_id FROM user_perimetres
        WHERE fk_user = $1::bigint AND origine = 'DELEGATION'`,
      [ids.delegataireId],
    )) as Array<{ origine: string; delegation_id: string }>;
    expect(miroirs).toHaveLength(1);
    expect(String(miroirs[0]!.delegation_id)).toBe(String(r.delegation.id));

    // Audit
    const audits = (await ds.query(
      `SELECT type_action FROM audit_log WHERE type_action = 'CREER_DELEGATION'`,
    )) as Array<{ type_action: string }>;
    expect(audits).toHaveLength(1);
  });

  it('rejet : delegant = delegataire', async () => {
    await expect(
      service.creer(baseDto(ids.delegantId, ids.perimetreNatifId), {
        userId: ids.delegantId,
        email: 'delegant@miznas.local',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejet : date_fin < date_debut', async () => {
    await expect(
      service.creer(
        baseDto(ids.delegataireId, ids.perimetreNatifId, {
          dateDebut: '2027-02-01',
          dateFin: '2027-01-01',
        }),
        { userId: ids.delegantId, email: 'delegant@miznas.local' },
      ),
    ).rejects.toThrow(/date_fin/);
  });

  it('ANTI-CHAÎNAGE STRICT : rejet si périmètre source origine=DELEGATION', async () => {
    await expect(
      service.creer(
        baseDto(ids.delegataireId, ids.perimetreDelegueId),
        { userId: ids.delegantId, email: 'delegant@miznas.local' },
      ),
    ).rejects.toThrow(/chaîne de délégation est interdite/);
  });

  it("rejet : périmètre n'appartient pas au délégant", async () => {
    // Crée un périmètre pour un AUTRE user
    await ds.query(
      `INSERT INTO user_perimetres (fk_user, cible_type, cible_id, origine, date_debut, actif, utilisateur_creation)
       VALUES ($1::bigint, 'CR', 200::bigint, 'AFFECTATION', '2026-01-01', true, 'system')`,
      [ids.tiersId],
    );
    const tiersPerim = (await ds.query(
      `SELECT id FROM user_perimetres WHERE fk_user = $1::bigint`,
      [ids.tiersId],
    )) as Array<{ id: string }>;
    await expect(
      service.creer(
        baseDto(ids.delegataireId, String(tiersPerim[0]!.id)),
        { userId: ids.delegantId, email: 'delegant@miznas.local' },
      ),
    ).rejects.toThrow(/n'appartient pas/);
  });

  it("rejet : permission non possédée par le délégant", async () => {
    // Délégant n'a que BUDGET.SAISIR (mock vide pour les autres)
    const permsRestreints = makePermissionsServiceMock({
      [ids.delegantId]: ['BUDGET.SAISIR'],
    });
    const restrictedService = new DelegationsService(
      ds.getRepository(Delegation),
      ds.getRepository(UserPerimetre),
      ds.getRepository(User),
      auditService,
      permsRestreints,
    );
    await expect(
      restrictedService.creer(
        baseDto(ids.delegataireId, ids.perimetreNatifId, {
          permissions: ['PUBLICATION'],
        }),
        { userId: ids.delegantId, email: 'delegant@miznas.local' },
      ),
    ).rejects.toThrow(/BUDGET.PUBLIER/);
  });

  it('rejet : périmètre inactif', async () => {
    await ds.query(
      `UPDATE user_perimetres SET actif = false WHERE id = $1::bigint`,
      [ids.perimetreNatifId],
    );
    await expect(
      service.creer(
        baseDto(ids.delegataireId, ids.perimetreNatifId),
        { userId: ids.delegantId, email: 'delegant@miznas.local' },
      ),
    ).rejects.toThrow(/inactif/);
  });

  it('rejet : délégataire inexistant', async () => {
    await expect(
      service.creer(baseDto('999999', ids.perimetreNatifId), {
        userId: ids.delegantId,
        email: 'delegant@miznas.local',
      }),
    ).rejects.toThrow(/Délégataire/);
  });

  it("rejet : périmètres demandés introuvables", async () => {
    await expect(
      service.creer(
        baseDto(ids.delegataireId, '999999'),
        { userId: ids.delegantId, email: 'delegant@miznas.local' },
      ),
    ).rejects.toThrow(/introuvables/);
  });

  it('warning chevauchement : 2e délégation même couple/perm/dates', async () => {
    await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId, {
        dateDebut: '2027-01-01',
        dateFin: '2027-01-31',
      }),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    const r2 = await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId, {
        dateDebut: '2027-01-15',
        dateFin: '2027-02-15',
      }),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    expect(r2.warnings.length).toBeGreaterThan(0);
    expect(r2.warnings[0]).toMatch(/Chevauchement/);
  });

  it('création crée des miroirs avec origine=DELEGATION et délégation_id rempli', async () => {
    const r = await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    const m = (await ds.query(
      `SELECT origine, delegation_id, cible_type, cible_id
         FROM user_perimetres WHERE fk_user = $1::bigint AND origine = 'DELEGATION'`,
      [ids.delegataireId],
    )) as Array<{
      origine: string;
      delegation_id: string;
      cible_type: string;
      cible_id: string;
    }>;
    expect(m).toHaveLength(1);
    expect(m[0]!.origine).toBe('DELEGATION');
    expect(String(m[0]!.delegation_id)).toBe(String(r.delegation.id));
    expect(m[0]!.cible_type).toBe('CR');
  });

  it('audit_log CREER_DELEGATION contient le payload riche', async () => {
    await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    const audits = (await ds.query(
      `SELECT payload_apres FROM audit_log WHERE type_action = 'CREER_DELEGATION'`,
    )) as Array<{ payload_apres: { permissions: string[]; motif: string } }>;
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload_apres.permissions).toEqual(['VALIDATION']);
    expect(audits[0]!.payload_apres.motif).toBe('Mission BCEAO');
  });

  // ─── Révocation (≥ 5 cas) ────────────────────────────────────────

  it('révocation par le délégant : OK + miroirs désactivés + audit', async () => {
    const r = await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    await service.revoquer(
      String(r.delegation.id),
      { motif: 'Retour de mission' },
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
      false,
    );
    const d = (await ds.query(
      `SELECT actif, revoquee_le, motif_revocation FROM delegations WHERE id = $1::bigint`,
      [r.delegation.id],
    )) as Array<{
      actif: boolean;
      revoquee_le: Date | null;
      motif_revocation: string;
    }>;
    expect(d[0]!.actif).toBe(false);
    expect(d[0]!.revoquee_le).not.toBeNull();
    expect(d[0]!.motif_revocation).toBe('Retour de mission');
    // Miroirs désactivés
    const miroirs = (await ds.query(
      `SELECT actif FROM user_perimetres WHERE delegation_id = $1::bigint`,
      [r.delegation.id],
    )) as Array<{ actif: boolean }>;
    expect(miroirs.every((m) => m.actif === false)).toBe(true);
    // Audit
    const audits = (await ds.query(
      `SELECT type_action FROM audit_log WHERE type_action = 'REVOQUER_DELEGATION'`,
    )) as Array<{ type_action: string }>;
    expect(audits).toHaveLength(1);
  });

  it('révocation par admin : OK même si pas le délégant', async () => {
    const r = await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    await service.revoquer(
      String(r.delegation.id),
      { motif: 'Anomalie détectée' },
      { userId: ids.tiersId, email: 'admin@miznas.local' },
      true, // isAdmin
    );
    const d = (await ds.query(
      `SELECT actif FROM delegations WHERE id = $1::bigint`,
      [r.delegation.id],
    )) as Array<{ actif: boolean }>;
    expect(d[0]!.actif).toBe(false);
  });

  it('révocation par tiers (ni délégant ni admin) : 403', async () => {
    const r = await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    await expect(
      service.revoquer(
        String(r.delegation.id),
        { motif: 'Tentative' },
        { userId: ids.tiersId, email: 'tiers@miznas.local' },
        false,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('révoquer une délégation déjà inactive → BadRequest', async () => {
    const r = await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    await service.revoquer(
      String(r.delegation.id),
      { motif: 'm' },
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
      false,
    );
    await expect(
      service.revoquer(
        String(r.delegation.id),
        { motif: 'm2' },
        { userId: ids.delegantId, email: 'delegant@miznas.local' },
        false,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ─── Listing ─────────────────────────────────────────────────────

  it('listerEnTantQueDelegataire retourne les délégations reçues', async () => {
    await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    const recues = await service.listerEnTantQueDelegataire(ids.delegataireId);
    expect(recues).toHaveLength(1);
    expect(recues[0]!.fkDelegataire).toBe(ids.delegataireId);
    expect(recues[0]!.statut).toBe('ACTIVE');
  });

  it('listerEmises retourne les délégations émises', async () => {
    await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    const emises = await service.listerEmises(ids.delegantId);
    expect(emises).toHaveLength(1);
    expect(emises[0]!.fkDelegant).toBe(ids.delegantId);
  });

  // ─── expirerAutomatiquement (≥ 6 cas) ────────────────────────────

  it('cron : délégation date_fin < today → actif=false + audit', async () => {
    const r = await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId, {
        dateDebut: '2024-01-01',
        dateFin: '2024-12-31',
      }),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    const result = await service.expirerAutomatiquement();
    expect(result.nbExpirees).toBe(1);
    const d = (await ds.query(
      `SELECT actif FROM delegations WHERE id = $1::bigint`,
      [r.delegation.id],
    )) as Array<{ actif: boolean }>;
    expect(d[0]!.actif).toBe(false);
    const audits = (await ds.query(
      `SELECT type_action FROM audit_log WHERE type_action = 'EXPIRER_DELEGATION'`,
    )) as Array<{ type_action: string }>;
    expect(audits).toHaveLength(1);
  });

  it('cron : miroirs user_perimetres désactivés', async () => {
    const r = await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId, {
        dateDebut: '2024-01-01',
        dateFin: '2024-12-31',
      }),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    await service.expirerAutomatiquement();
    const miroirs = (await ds.query(
      `SELECT actif FROM user_perimetres WHERE delegation_id = $1::bigint`,
      [r.delegation.id],
    )) as Array<{ actif: boolean }>;
    expect(miroirs.every((m) => m.actif === false)).toBe(true);
  });

  it('cron : délégation déjà inactive → ignorée (pas de double EXPIRER)', async () => {
    const r = await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId, {
        dateDebut: '2024-01-01',
        dateFin: '2024-12-31',
      }),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    // Désactiver manuellement
    await ds.query(
      `UPDATE delegations SET actif = false WHERE id = $1::bigint`,
      [r.delegation.id],
    );
    const result = await service.expirerAutomatiquement();
    expect(result.nbExpirees).toBe(0);
  });

  it('cron : délégation date_fin = today → reste active', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId, {
        dateDebut: '2024-01-01',
        dateFin: today,
      }),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    const result = await service.expirerAutomatiquement();
    expect(result.nbExpirees).toBe(0);
  });

  it('cron : compteur correct sur 2 délégations expirées', async () => {
    // 2 délégations expirées
    await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId, {
        dateDebut: '2024-01-01',
        dateFin: '2024-12-31',
      }),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatif2Id, {
        dateDebut: '2024-01-01',
        dateFin: '2024-12-31',
        permissions: ['SAISIE'],
      }),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    const result = await service.expirerAutomatiquement();
    expect(result.nbExpirees).toBe(2);
  });

  // ─── getPermissionsRecues ────────────────────────────────────────

  it("getPermissionsRecues retourne les perms d'une délégation active", async () => {
    const r = await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId, {
        permissions: ['VALIDATION', 'SAISIE'],
      }),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    const recues = await service.getPermissionsRecues(
      ids.delegataireId,
      '2027-01-15',
    );
    expect(recues).toHaveLength(2);
    expect(recues.map((p) => p.permission).sort()).toEqual([
      'SAISIE',
      'VALIDATION',
    ]);
    expect(recues.every((p) => p.delegationId === String(r.delegation.id))).toBe(
      true,
    );
  });

  it('getPermissionsRecues exclut une délégation expirée', async () => {
    await service.creer(
      baseDto(ids.delegataireId, ids.perimetreNatifId, {
        dateDebut: '2024-01-01',
        dateFin: '2024-12-31',
      }),
      { userId: ids.delegantId, email: 'delegant@miznas.local' },
    );
    const recues = await service.getPermissionsRecues(
      ids.delegataireId,
      '2027-01-15',
    );
    expect(recues).toEqual([]);
  });
});
