/**
 * Tests unitaires PerimetreService — couvre l'algorithme de filtrage
 * périmètre RBAC (Lot 3.3, Q5) avec pg-mem.
 *
 * Hiérarchie SOC_BANK_UEMOA construite à la main :
 *
 *   SOC_BANK_UEMOA (racine)
 *   ├── BR_CIV (branche Côte d'Ivoire)
 *   │   ├── DIR_CIV_RETAIL
 *   │   │   ├── DEPT_CIV_PARTICULIERS
 *   │   │   │   ├── AG_ABJ_PLATEAU (CR_AG_ABJ_PLATEAU)
 *   │   │   │   └── AG_ABJ_COCODY  (CR_AG_ABJ_COCODY)
 *   │   │   └── (CR_DIR_CIV_RETAIL)
 *   │   ├── DIR_CIV_CORPORATE       (CR_DIR_CIV_CORPORATE)
 *   │   └── BR_CIV_FONCTIONS        (CR_BR_CIV_FONCTIONS)
 *   └── BR_SEN
 *       └── AG_DKR_PLATEAU          (CR_AG_DKR_PLATEAU)
 */
import { UnauthorizedException } from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';

import { Permission } from '../../roles/entities/permission.entity';
import { RolePermission } from '../../roles/entities/role-permission.entity';
import { Role } from '../../roles/entities/role.entity';
import { DimCentreResponsabilite } from '../../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import { DimStructure } from '../../referentiels/structure/entities/dim-structure.entity';
import { User } from '../../users/entities/user.entity';
import { UserPerimetre } from '../../users/entities/user-perimetre.entity';
import { UserRole } from '../../users/entities/user-role.entity';
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
      UserPerimetre,
      Permission,
      RolePermission,
      DimStructure,
      DimCentreResponsabilite,
    ],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

interface SeedIds {
  userIds: Record<string, string>;
  roleIds: Record<string, string>;
  structureIds: Record<string, string>;
  crIds: Record<string, string>;
}

async function seedSocBank(ds: DataSource): Promise<SeedIds> {
  // 1. Roles
  for (const code of ['ADMIN', 'PREPARATEUR']) {
    await ds.query(
      `INSERT INTO ref_role ("code_role","libelle","est_actif","utilisateur_creation")
       VALUES ($1,$1,true,'system')`,
      [code],
    );
  }
  const roles = (await ds.query(
    `SELECT id, code_role FROM ref_role`,
  )) as Array<{ id: string; code_role: string }>;
  const roleIds: Record<string, string> = {};
  for (const r of roles) roleIds[r.code_role] = String(r.id);

  // 2. Users
  for (const email of [
    'admin@miznas.local',
    'preparateur_civ@miznas.local',
    'preparateur_sen@miznas.local',
    'no_role@miznas.local',
  ]) {
    await ds.query(
      `INSERT INTO "user"
        ("email","mot_de_passe_hash","nom","prenom","est_actif","utilisateur_creation")
       VALUES ($1,'hash','N','P',true,'system')`,
      [email],
    );
  }
  const users = (await ds.query(
    `SELECT id, email FROM "user"`,
  )) as Array<{ id: string; email: string }>;
  const userIds: Record<string, string> = {};
  for (const u of users) userIds[u.email] = String(u.id);

  // 3. Structures hiérarchiques
  // SOC_BANK_UEMOA → BR_CIV → DIR_CIV_RETAIL → DEPT_CIV_PARTICULIERS →
  //                                              AG_ABJ_PLATEAU / AG_ABJ_COCODY
  //                                          → DIR_CIV_CORPORATE
  //                                          → BR_CIV_FONCTIONS
  //                → BR_SEN  → AG_DKR_PLATEAU
  // + 1 structure désactivée AG_BURKINA pour tester la robustesse
  async function insStruct(
    code: string,
    parentId: string | null,
    estActif = true,
  ): Promise<string> {
    await ds.query(
      `INSERT INTO dim_structure
        ("code_structure","libelle","libelle_court","type_structure","niveau_hierarchique",
         "fk_structure_parent","code_pays","date_debut_validite","date_fin_validite",
         "version_courante","est_actif","utilisateur_creation")
       VALUES ($1,$1,NULL,'agence',1,$2,NULL,'2026-01-01',NULL,true,$3,'system')`,
      [code, parentId, estActif],
    );
    const r = (await ds.query(
      `SELECT id FROM dim_structure WHERE code_structure = $1`,
      [code],
    )) as Array<{ id: string }>;
    return String(r[0]!.id);
  }
  const sId: Record<string, string> = {};
  sId['SOC_BANK_UEMOA'] = await insStruct('SOC_BANK_UEMOA', null);
  sId['BR_CIV'] = await insStruct('BR_CIV', sId['SOC_BANK_UEMOA']);
  sId['DIR_CIV_RETAIL'] = await insStruct('DIR_CIV_RETAIL', sId['BR_CIV']);
  sId['DEPT_CIV_PARTICULIERS'] = await insStruct(
    'DEPT_CIV_PARTICULIERS',
    sId['DIR_CIV_RETAIL'],
  );
  sId['AG_ABJ_PLATEAU'] = await insStruct(
    'AG_ABJ_PLATEAU',
    sId['DEPT_CIV_PARTICULIERS'],
  );
  sId['AG_ABJ_COCODY'] = await insStruct(
    'AG_ABJ_COCODY',
    sId['DEPT_CIV_PARTICULIERS'],
  );
  sId['DIR_CIV_CORPORATE'] = await insStruct(
    'DIR_CIV_CORPORATE',
    sId['BR_CIV'],
  );
  sId['BR_CIV_FONCTIONS'] = await insStruct('BR_CIV_FONCTIONS', sId['BR_CIV']);
  sId['BR_SEN'] = await insStruct('BR_SEN', sId['SOC_BANK_UEMOA']);
  sId['AG_DKR_PLATEAU'] = await insStruct('AG_DKR_PLATEAU', sId['BR_SEN']);
  sId['AG_BURKINA_DESACT'] = await insStruct(
    'AG_BURKINA_DESACT',
    sId['SOC_BANK_UEMOA'],
    false, // désactivée
  );

  // 4. CR rattachés aux structures
  const crCodeToStructCode: Array<[string, string]> = [
    ['CR_DIR_CIV_RETAIL', 'DIR_CIV_RETAIL'],
    ['CR_DIR_CIV_CORPORATE', 'DIR_CIV_CORPORATE'],
    ['CR_DEPT_CIV_PARTICULIERS', 'DEPT_CIV_PARTICULIERS'],
    ['CR_AG_ABJ_PLATEAU', 'AG_ABJ_PLATEAU'],
    ['CR_AG_ABJ_COCODY', 'AG_ABJ_COCODY'],
    ['CR_BR_CIV_FONCTIONS', 'BR_CIV_FONCTIONS'],
    ['CR_AG_DKR_PLATEAU', 'AG_DKR_PLATEAU'],
  ];
  const crIds: Record<string, string> = {};
  for (const [crCode, sCode] of crCodeToStructCode) {
    await ds.query(
      `INSERT INTO dim_centre_responsabilite
        ("code_cr","libelle","libelle_court","type_cr","fk_structure",
         "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
       VALUES ($1,$1,NULL,'cdc',$2,'2026-01-01',NULL,true,true,'system')`,
      [crCode, sId[sCode]],
    );
    const r = (await ds.query(
      `SELECT id FROM dim_centre_responsabilite WHERE code_cr = $1`,
      [crCode],
    )) as Array<{ id: string }>;
    crIds[crCode] = String(r[0]!.id);
  }

  return {
    userIds,
    roleIds,
    structureIds: sId,
    crIds,
  };
}

async function attribuerRole(
  ds: DataSource,
  userId: string,
  roleId: string,
  perimetreType: string | null,
  perimetreId: string | null,
  estActif = true,
): Promise<void> {
  await ds.query(
    `INSERT INTO bridge_user_role
       ("fk_user","fk_role","perimetre_type","perimetre_id",
        "est_actif","utilisateur_creation")
     VALUES ($1,$2,$3,$4,$5,'system')`,
    [userId, roleId, perimetreType, perimetreId, estActif],
  );
}

describe('PerimetreService', () => {
  let ds: DataSource;
  let service: PerimetreService;
  let seed: SeedIds;

  beforeAll(async () => {
    ds = await createDataSource();
    service = new PerimetreService(
      ds.getRepository(UserRole),
      ds.getRepository(UserPerimetre),
    );
    seed = await seedSocBank(ds);
  });

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM bridge_user_role');
  });

  // ─── getCrAutorisesPourUser

  it('user sans rôle actif → UnauthorizedException', async () => {
    await expect(
      service.getCrAutorisesPourUser(seed.userIds['no_role@miznas.local']!),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("user avec rôle 'global' → null (pas de filtre)", async () => {
    await attribuerRole(
      ds,
      seed.userIds['admin@miznas.local']!,
      seed.roleIds['ADMIN']!,
      'global',
      null,
    );
    const result = await service.getCrAutorisesPourUser(
      seed.userIds['admin@miznas.local']!,
    );
    expect(result).toBeNull();
  });

  it("user avec perimetre_type=NULL → null (compat héritage)", async () => {
    await attribuerRole(
      ds,
      seed.userIds['admin@miznas.local']!,
      seed.roleIds['ADMIN']!,
      null,
      null,
    );
    const result = await service.getCrAutorisesPourUser(
      seed.userIds['admin@miznas.local']!,
    );
    expect(result).toBeNull();
  });

  it("rôle STRUCTURE pointant vers BR_CIV → 6 CR descendants", async () => {
    await attribuerRole(
      ds,
      seed.userIds['preparateur_civ@miznas.local']!,
      seed.roleIds['PREPARATEUR']!,
      'structure',
      seed.structureIds['BR_CIV']!,
    );
    const result = await service.getCrAutorisesPourUser(
      seed.userIds['preparateur_civ@miznas.local']!,
    );
    expect(result).not.toBeNull();
    const ids = result as string[];
    // 6 CR : DIR_CIV_RETAIL, DIR_CIV_CORPORATE, DEPT_CIV_PARTICULIERS,
    //        AG_ABJ_PLATEAU, AG_ABJ_COCODY, BR_CIV_FONCTIONS
    expect(ids).toHaveLength(6);
    expect(ids).toContain(seed.crIds['CR_AG_ABJ_PLATEAU']);
    expect(ids).toContain(seed.crIds['CR_BR_CIV_FONCTIONS']);
    // AG_DKR_PLATEAU (Sénégal) pas dedans
    expect(ids).not.toContain(seed.crIds['CR_AG_DKR_PLATEAU']);
  });

  it("rôle STRUCTURE pointant vers une feuille AG_ABJ_PLATEAU → 1 CR", async () => {
    await attribuerRole(
      ds,
      seed.userIds['preparateur_civ@miznas.local']!,
      seed.roleIds['PREPARATEUR']!,
      'structure',
      seed.structureIds['AG_ABJ_PLATEAU']!,
    );
    const result = await service.getCrAutorisesPourUser(
      seed.userIds['preparateur_civ@miznas.local']!,
    );
    expect(result).toEqual([seed.crIds['CR_AG_ABJ_PLATEAU']]);
  });

  it("rôle STRUCTURE pointant vers SOC_BANK_UEMOA → tous les CR", async () => {
    await attribuerRole(
      ds,
      seed.userIds['admin@miznas.local']!,
      seed.roleIds['ADMIN']!,
      'structure',
      seed.structureIds['SOC_BANK_UEMOA']!,
    );
    const result = await service.getCrAutorisesPourUser(
      seed.userIds['admin@miznas.local']!,
    );
    expect(result).not.toBeNull();
    expect(result).toHaveLength(7); // 7 CR seedés au total
  });

  it("2 rôles STRUCTURE BR_CIV + BR_SEN → union 7 CR", async () => {
    const userId = seed.userIds['admin@miznas.local']!;
    await attribuerRole(
      ds,
      userId,
      seed.roleIds['PREPARATEUR']!,
      'structure',
      seed.structureIds['BR_CIV']!,
    );
    await attribuerRole(
      ds,
      userId,
      seed.roleIds['PREPARATEUR']!,
      'structure',
      seed.structureIds['BR_SEN']!,
    );
    const result = await service.getCrAutorisesPourUser(userId);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(7); // 6 CR CIV + 1 CR SEN
    expect(result).toContain(seed.crIds['CR_AG_DKR_PLATEAU']);
  });

  it("rôle pointant vers structure désactivée → ignoré (warning), set vide", async () => {
    await attribuerRole(
      ds,
      seed.userIds['preparateur_sen@miznas.local']!,
      seed.roleIds['PREPARATEUR']!,
      'structure',
      seed.structureIds['AG_BURKINA_DESACT']!,
    );
    const result = await service.getCrAutorisesPourUser(
      seed.userIds['preparateur_sen@miznas.local']!,
    );
    expect(result).toEqual([]);
  });

  it("rôle pointant vers structure inexistante → ignoré, set vide", async () => {
    await attribuerRole(
      ds,
      seed.userIds['preparateur_sen@miznas.local']!,
      seed.roleIds['PREPARATEUR']!,
      'structure',
      '999999',
    );
    const result = await service.getCrAutorisesPourUser(
      seed.userIds['preparateur_sen@miznas.local']!,
    );
    expect(result).toEqual([]);
  });

  it("perimetre_type='centre_responsabilite' → CR direct", async () => {
    await attribuerRole(
      ds,
      seed.userIds['preparateur_civ@miznas.local']!,
      seed.roleIds['PREPARATEUR']!,
      'centre_responsabilite',
      seed.crIds['CR_AG_ABJ_PLATEAU']!,
    );
    const result = await service.getCrAutorisesPourUser(
      seed.userIds['preparateur_civ@miznas.local']!,
    );
    expect(result).toEqual([seed.crIds['CR_AG_ABJ_PLATEAU']]);
  });

  it("rôle inactif (estActif=false) → ignoré, throw Unauthorized si seul rôle", async () => {
    await attribuerRole(
      ds,
      seed.userIds['preparateur_civ@miznas.local']!,
      seed.roleIds['PREPARATEUR']!,
      'structure',
      seed.structureIds['BR_CIV']!,
      false, // inactif
    );
    await expect(
      service.getCrAutorisesPourUser(
        seed.userIds['preparateur_civ@miznas.local']!,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  // Lot 4.1 — la branche `NotImplementedException` historique (cas
  // d'un perimetre_type inconnu côté bridge_user_role) a disparu : le
  // service délègue désormais à user_perimetres pour les rôles non
  // globaux. La validation des cible_type est garantie par le CHECK
  // SQL `ck_user_perimetres_cible_type` côté table.

  // ─── getStructuresAutoriseesPourUser

  it("getStructuresAutoriseesPourUser BR_CIV → 7 structures (BR_CIV + 6 desc.)", async () => {
    await attribuerRole(
      ds,
      seed.userIds['preparateur_civ@miznas.local']!,
      seed.roleIds['PREPARATEUR']!,
      'structure',
      seed.structureIds['BR_CIV']!,
    );
    const result = await service.getStructuresAutoriseesPourUser(
      seed.userIds['preparateur_civ@miznas.local']!,
    );
    expect(result).not.toBeNull();
    // BR_CIV + DIR_CIV_RETAIL + DEPT_CIV_PARTICULIERS + AG_ABJ_PLATEAU
    // + AG_ABJ_COCODY + DIR_CIV_CORPORATE + BR_CIV_FONCTIONS = 7
    expect(result).toHaveLength(7);
  });
});

// ─── Lot 4.1 : getPerimetreEffectif (multi-périmètres user_perimetres) ─

describe('PerimetreService.getPerimetreEffectif (Lot 4.1)', () => {
  let ds: DataSource;
  let service: PerimetreService;
  let seed: SeedIds;

  beforeAll(async () => {
    ds = await createDataSource();
    service = new PerimetreService(
      ds.getRepository(UserRole),
      ds.getRepository(UserPerimetre),
    );
    seed = await seedSocBank(ds);
  });

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM bridge_user_role');
    await ds.query('DELETE FROM user_perimetres');
  });

  async function ajouterPerimetre(
    userId: string,
    cibleType: 'STRUCTURE' | 'CR' | 'CR_SET',
    options: {
      cibleId?: string | null;
      cibleCrIds?: string[] | null;
      origine?: 'PRINCIPAL' | 'AFFECTATION' | 'DELEGATION';
      dateDebut?: string;
      dateFin?: string | null;
      actif?: boolean;
    },
  ): Promise<void> {
    await ds.query(
      `INSERT INTO user_perimetres
         ("fk_user","cible_type","cible_id","cible_cr_ids","origine",
          "date_debut","date_fin","actif","utilisateur_creation")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'system')`,
      [
        userId,
        cibleType,
        options.cibleId ?? null,
        options.cibleCrIds ?? null,
        options.origine ?? 'AFFECTATION',
        options.dateDebut ?? '2026-01-01',
        options.dateFin ?? null,
        options.actif ?? true,
      ],
    );
  }

  it('STRUCTURE : descend l\'arbre', async () => {
    const userId = seed.userIds['preparateur_civ@miznas.local']!;
    await ajouterPerimetre(userId, 'STRUCTURE', {
      cibleId: seed.structureIds['BR_CIV']!,
    });
    const result = await service.getPerimetreEffectif(userId);
    // 6 CR sous BR_CIV
    expect(result).toHaveLength(6);
  });

  it("CR : ajoute uniquement le CR ciblé (pas de descente)", async () => {
    const userId = seed.userIds['preparateur_civ@miznas.local']!;
    await ajouterPerimetre(userId, 'CR', {
      cibleId: seed.crIds['CR_AG_ABJ_PLATEAU']!,
    });
    const result = await service.getPerimetreEffectif(userId);
    expect(result).toEqual([seed.crIds['CR_AG_ABJ_PLATEAU']!]);
  });

  it('CR_SET : retourne les CR de la liste, pas de descente', async () => {
    const userId = seed.userIds['preparateur_civ@miznas.local']!;
    await ajouterPerimetre(userId, 'CR_SET', {
      cibleCrIds: [
        seed.crIds['CR_AG_ABJ_PLATEAU']!,
        seed.crIds['CR_AG_ABJ_COCODY']!,
      ],
    });
    const result = await service.getPerimetreEffectif(userId);
    expect(result.sort()).toEqual(
      [
        seed.crIds['CR_AG_ABJ_PLATEAU']!,
        seed.crIds['CR_AG_ABJ_COCODY']!,
      ].sort(),
    );
  });

  it('union : multi-affectations → CR dédupliqués', async () => {
    const userId = seed.userIds['preparateur_civ@miznas.local']!;
    // Affectation 1 : un CR
    await ajouterPerimetre(userId, 'CR', {
      cibleId: seed.crIds['CR_AG_ABJ_PLATEAU']!,
    });
    // Affectation 2 : un CR_SET incluant le même CR + 1 autre
    await ajouterPerimetre(userId, 'CR_SET', {
      cibleCrIds: [
        seed.crIds['CR_AG_ABJ_PLATEAU']!,
        seed.crIds['CR_AG_ABJ_COCODY']!,
      ],
    });
    const result = await service.getPerimetreEffectif(userId);
    expect(result).toHaveLength(2);
  });

  it('exclut les périmètres avec date_fin dépassée', async () => {
    const userId = seed.userIds['preparateur_civ@miznas.local']!;
    await ajouterPerimetre(userId, 'CR', {
      cibleId: seed.crIds['CR_AG_ABJ_PLATEAU']!,
      dateDebut: '2026-01-01',
      dateFin: '2026-12-31',
    });
    // dateRef en 2027 → exclu
    const result = await service.getPerimetreEffectif(userId, '2027-06-01');
    expect(result).toEqual([]);
  });

  it('exclut les périmètres avec actif=false', async () => {
    const userId = seed.userIds['preparateur_civ@miznas.local']!;
    await ajouterPerimetre(userId, 'CR', {
      cibleId: seed.crIds['CR_AG_ABJ_PLATEAU']!,
      actif: false,
    });
    const result = await service.getPerimetreEffectif(userId);
    expect(result).toEqual([]);
  });

  it('exclut les périmètres avec date_debut > dateRef', async () => {
    const userId = seed.userIds['preparateur_civ@miznas.local']!;
    await ajouterPerimetre(userId, 'CR', {
      cibleId: seed.crIds['CR_AG_ABJ_PLATEAU']!,
      dateDebut: '2027-06-01',
    });
    const result = await service.getPerimetreEffectif(userId, '2027-01-01');
    expect(result).toEqual([]);
  });

  it("getCrAutorisesPourUser : null pour un user 'global' (court-circuit admin)", async () => {
    const userId = seed.userIds['admin@miznas.local']!;
    await ds.query(
      `INSERT INTO bridge_user_role ("fk_user","fk_role","perimetre_type","est_actif","utilisateur_creation")
       VALUES ($1, $2, 'global', true, 'system')`,
      [userId, seed.roleIds['ADMIN']!],
    );
    const result = await service.getCrAutorisesPourUser(userId);
    expect(result).toBeNull();
  });

  // ─── Lot 4.1-fix2.A : priorité user_perimetres ─────────────────

  it("Lot 4.1-fix2 : user_perimetres prioritaire — bridge global ignoré", async () => {
    const userId = seed.userIds['preparateur_civ@miznas.local']!;
    // Bridge 'global' → admin théorique
    await ds.query(
      `INSERT INTO bridge_user_role ("fk_user","fk_role","perimetre_type","est_actif","utilisateur_creation")
       VALUES ($1, $2, 'global', true, 'system')`,
      [userId, seed.roleIds['ADMIN']!],
    );
    // Mais une affectation explicite CR_SET dans user_perimetres
    await ajouterPerimetre(userId, 'CR_SET', {
      cibleCrIds: [
        seed.crIds['CR_AG_ABJ_PLATEAU']!,
        seed.crIds['CR_AG_ABJ_COCODY']!,
      ],
    });
    const result = await service.getCrAutorisesPourUser(userId);
    // Doit retourner EXACTEMENT 2 CR (pas null, pas l'union avec
    // tous les CR de l'univers) — l'affectation explicite restreint.
    expect(result).not.toBeNull();
    expect((result as string[]).sort()).toEqual(
      [
        seed.crIds['CR_AG_ABJ_PLATEAU']!,
        seed.crIds['CR_AG_ABJ_COCODY']!,
      ].sort(),
    );
  });

  it("Lot 4.1-fix2 : user_perimetres STRUCTURE prioritaire — bridge global ignoré", async () => {
    const userId = seed.userIds['preparateur_civ@miznas.local']!;
    await ds.query(
      `INSERT INTO bridge_user_role ("fk_user","fk_role","perimetre_type","est_actif","utilisateur_creation")
       VALUES ($1, $2, 'global', true, 'system')`,
      [userId, seed.roleIds['ADMIN']!],
    );
    await ajouterPerimetre(userId, 'STRUCTURE', {
      cibleId: seed.structureIds['BR_CIV']!,
    });
    const result = await service.getCrAutorisesPourUser(userId);
    expect(result).not.toBeNull();
    // 6 CR sous BR_CIV — pas l'univers complet
    expect(result).toHaveLength(6);
  });

  it("Lot 4.1-fix2 : fallback bridge_user_role si user_perimetres VIDE", async () => {
    const userId = seed.userIds['preparateur_civ@miznas.local']!;
    await ds.query(
      `INSERT INTO bridge_user_role ("fk_user","fk_role","perimetre_type","perimetre_id","est_actif","utilisateur_creation")
       VALUES ($1, $2, 'centre_responsabilite', $3, true, 'system')`,
      [userId, seed.roleIds['PREPARATEUR']!, seed.crIds['CR_AG_ABJ_PLATEAU']!],
    );
    // Aucune ligne user_perimetres → fallback bridge
    const result = await service.getCrAutorisesPourUser(userId);
    expect(result).toEqual([seed.crIds['CR_AG_ABJ_PLATEAU']!]);
  });

  it("Lot 4.1-fix2 : fallback bridge 'global' → null (admin) si user_perimetres VIDE", async () => {
    const userId = seed.userIds['admin@miznas.local']!;
    await ds.query(
      `INSERT INTO bridge_user_role ("fk_user","fk_role","perimetre_type","est_actif","utilisateur_creation")
       VALUES ($1, $2, 'global', true, 'system')`,
      [userId, seed.roleIds['ADMIN']!],
    );
    const result = await service.getCrAutorisesPourUser(userId);
    expect(result).toBeNull(); // admin global
  });

  it("Lot 4.1-fix2 : user_perimetres expirée (date_fin dépassée) → fallback bridge", async () => {
    const userId = seed.userIds['preparateur_civ@miznas.local']!;
    await ds.query(
      `INSERT INTO bridge_user_role ("fk_user","fk_role","perimetre_type","est_actif","utilisateur_creation")
       VALUES ($1, $2, 'global', true, 'system')`,
      [userId, seed.roleIds['ADMIN']!],
    );
    // Affectation expirée hier
    const hier = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await ajouterPerimetre(userId, 'CR', {
      cibleId: seed.crIds['CR_AG_ABJ_PLATEAU']!,
      dateDebut: '2024-01-01',
      dateFin: hier,
    });
    const result = await service.getCrAutorisesPourUser(userId);
    // L'affectation expirée est ignorée → fallback bridge global → null
    expect(result).toBeNull();
  });
});
