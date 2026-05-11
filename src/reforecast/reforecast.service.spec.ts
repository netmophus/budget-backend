/**
 * Tests ReforecastService (Lot 5.3.A) via pg-mem.
 *
 * Couvre :
 *  - lancer() : 3 méthodes d'extrapolation + validations
 *  - obsolescence : OBSOLETE de l'ancien reforecast ACTIVE
 *  - audit : LANCER_REFORECAST + MARQUER_REFORECAST_OBSOLETE
 *  - lister/getById : filtrage type='reforecast' / statutPublication
 *  - getComparaison : origine REALISE/EXTRAPOLATION/MANUEL
 */
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';

import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { DimCentreResponsabilite } from '../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import { DimCompte } from '../referentiels/compte/entities/dim-compte.entity';
import { DimDevise } from '../referentiels/devise/entities/dim-devise.entity';
import { DimLigneMetier } from '../referentiels/ligne-metier/entities/dim-ligne-metier.entity';
import { DimProduit } from '../referentiels/produit/entities/dim-produit.entity';
import { DimScenario } from '../referentiels/scenario/entities/dim-scenario.entity';
import { DimSegment } from '../referentiels/segment/entities/dim-segment.entity';
import { DimStructure } from '../referentiels/structure/entities/dim-structure.entity';
import { DimTemps } from '../referentiels/temps/entities/dim-temps.entity';
import { DimVersion } from '../referentiels/version/entities/dim-version.entity';
import { FaitBudget } from '../faits/budget/entities/fait-budget.entity';
import { FaitRealise } from '../realise/entities/fait-realise.entity';
import { Permission } from '../roles/entities/permission.entity';
import { Role } from '../roles/entities/role.entity';
import { RolePermission } from '../roles/entities/role-permission.entity';
import { User } from '../users/entities/user.entity';
import { UserPerimetre } from '../users/entities/user-perimetre.entity';
import { UserRole } from '../users/entities/user-role.entity';
import type { LancerReforecastDto } from './dto/reforecast.dto';
import { ReforecastService } from './reforecast.service';

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
      AuditLog,
      User,
      UserRole,
      UserPerimetre,
      Role,
      Permission,
      RolePermission,
      DimStructure,
      DimCentreResponsabilite,
      DimCompte,
      DimLigneMetier,
      DimDevise,
      DimProduit,
      DimSegment,
      DimTemps,
      DimVersion,
      DimScenario,
      FaitBudget,
      FaitRealise,
    ],
    synchronize: true,
  }) as DataSource;
  await ds.initialize();
  return ds;
}

interface SeedIds {
  cr1: string;
  cr2: string;
  versionSourceId: string;
  scenarioId: string;
  compteCharge: string;
  compteProduit: string;
  ligneMetier: string;
  devise: string;
  produit: string;
  segment: string;
  structure: string;
  // 12 mois 2027
  temps: string[]; // [t1, t2, …, t12]
}

async function seed(ds: DataSource): Promise<SeedIds> {
  // User validateur (requis par chk_fait_realise_valide_coherence)
  await ds.query(
    `INSERT INTO "user" (email, mot_de_passe_hash, nom, prenom, est_actif)
     VALUES ('admin@m.io','h','A','D',true)`,
  );
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
       (code_cr, libelle, type_cr, fk_structure, date_debut_validite,
        version_courante, est_actif, utilisateur_creation)
     VALUES ('CR_A','A','profit_center',$1::bigint,'2026-01-01',true,true,'system'),
            ('CR_B','B','profit_center',$1::bigint,'2026-01-01',true,true,'system')`,
    [struct[0]!.id],
  );
  const crs = (await ds.query(
    `SELECT id, code_cr FROM dim_centre_responsabilite ORDER BY code_cr`,
  )) as Array<{ id: string; code_cr: string }>;
  await ds.query(
    `INSERT INTO dim_compte
       (code_compte, libelle, classe, niveau, est_compte_collectif,
        est_porteur_interets, date_debut_validite, version_courante,
        est_actif, utilisateur_creation)
     VALUES
       ('611','Charges','6',4,false,false,'2026-01-01',true,true,'system'),
       ('701','Produits','7',4,false,false,'2026-01-01',true,true,'system')`,
  );
  const comptes = (await ds.query(
    `SELECT id, code_compte FROM dim_compte ORDER BY code_compte`,
  )) as Array<{ id: string; code_compte: string }>;
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
    `INSERT INTO dim_devise (code_iso, libelle, symbole, nb_decimales,
       est_devise_pivot, est_active, utilisateur_creation)
     VALUES ('XOF','F CFA','F CFA',0,true,true,'system')`,
  );
  const dev = (await ds.query(`SELECT id FROM dim_devise`)) as Array<{
    id: string;
  }>;
  await ds.query(
    `INSERT INTO dim_produit (code_produit, libelle, type_produit, niveau,
       est_porteur_interets, date_debut_validite, version_courante,
       est_actif, utilisateur_creation)
     VALUES ('P1','Produit','autre',1,false,'2026-01-01',true,true,'system')`,
  );
  const prod = (await ds.query(`SELECT id FROM dim_produit`)) as Array<{
    id: string;
  }>;
  await ds.query(
    `INSERT INTO dim_segment (code_segment, libelle, categorie,
       date_debut_validite, version_courante, est_actif, utilisateur_creation)
     VALUES ('SEG','Segment','particulier','2026-01-01',true,true,'system')`,
  );
  const seg = (await ds.query(`SELECT id FROM dim_segment`)) as Array<{
    id: string;
  }>;

  // Version source publiée + scenario
  await ds.query(
    `INSERT INTO dim_version
       (code_version, libelle, type_version, exercice_fiscal, statut,
        statut_publication, utilisateur_creation)
     VALUES ('BI_2027','Budget initial 2027','budget_initial',2027,'gele','ACTIVE','system')`,
  );
  const ver = (await ds.query(`SELECT id FROM dim_version`)) as Array<{
    id: string;
  }>;
  await ds.query(
    `INSERT INTO dim_scenario
       (code_scenario, libelle, type_scenario, statut, exercice_fiscal, utilisateur_creation)
     VALUES ('OPT_2027','Optimiste','central','actif',2027,'system')`,
  );
  const sce = (await ds.query(`SELECT id FROM dim_scenario`)) as Array<{
    id: string;
  }>;

  // 12 mois 2027 (1er du mois)
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    const trim = Math.ceil(m / 3);
    await ds.query(
      `INSERT INTO dim_temps
        (date, annee, trimestre, mois, jour, jour_ouvre, est_fin_de_mois,
         est_fin_de_trimestre, est_fin_d_annee, exercice_fiscal, libelle_mois)
       VALUES ($1, 2027, $2, $3, 1, true, false, false, false, 2027, $4)`,
      [`2027-${mm}-01`, trim, m, `M${m}`],
    );
  }
  const temps = (await ds.query(
    `SELECT id FROM dim_temps ORDER BY mois`,
  )) as Array<{ id: string }>;

  return {
    cr1: String(crs[0]!.id),
    cr2: String(crs[1]!.id),
    versionSourceId: String(ver[0]!.id),
    scenarioId: String(sce[0]!.id),
    compteCharge: String(comptes.find((c) => c.code_compte === '611')!.id),
    compteProduit: String(comptes.find((c) => c.code_compte === '701')!.id),
    ligneMetier: String(lm[0]!.id),
    devise: String(dev[0]!.id),
    produit: String(prod[0]!.id),
    segment: String(seg[0]!.id),
    structure: String(struct[0]!.id),
    temps: temps.map((t) => String(t.id)),
  };
}

async function insertBudget(
  ds: DataSource,
  ids: SeedIds,
  versionId: string,
  fkCompte: string,
  monthIdx: number,
  fkCr: string,
  montant: number,
): Promise<void> {
  await ds.query(
    `INSERT INTO fait_budget
      (fk_temps, fk_compte, fk_structure, fk_centre, fk_ligne_metier,
       fk_produit, fk_segment, fk_devise, fk_version, fk_scenario,
       montant_devise, montant_fcfa, taux_change_applique, mode_saisie,
       utilisateur_creation)
     VALUES ($1::bigint, $2::bigint, $3::bigint, $4::bigint, $5::bigint,
             $6::bigint, $7::bigint, $8::bigint, $9::bigint, $10::bigint,
             $11, $11, 1, 'MONTANT', 'system')`,
    [
      ids.temps[monthIdx]!,
      fkCompte,
      ids.structure,
      fkCr,
      ids.ligneMetier,
      ids.produit,
      ids.segment,
      ids.devise,
      versionId,
      ids.scenarioId,
      montant,
    ],
  );
}

async function insertRealise(
  ds: DataSource,
  ids: SeedIds,
  fkCompte: string,
  monthIdx: number,
  fkCr: string,
  montant: number,
  statut: 'IMPORTE' | 'VALIDE' = 'VALIDE',
): Promise<void> {
  // user_id du validateur (créé dans seed())
  const userRows = (await ds.query(
    `SELECT id FROM "user" WHERE email = 'admin@m.io'`,
  )) as Array<{ id: string }>;
  const validUser = String(userRows[0]!.id);
  await ds.query(
    `INSERT INTO fait_realise
      (fk_centre_responsabilite, fk_compte, fk_ligne_metier, fk_temps, fk_devise,
       montant, taux_change_applique, mode, statut, source,
       valide_le, fk_valide_par, utilisateur_creation)
     VALUES ($1::bigint, $2::bigint, $3::bigint, $4::bigint, $5::bigint,
             $6, 1, 'MNT', $7, 'IMPORT',
             $8, $9, 'system')`,
    [
      fkCr,
      fkCompte,
      ids.ligneMetier,
      ids.temps[monthIdx]!,
      ids.devise,
      montant,
      statut,
      statut === 'VALIDE' ? '2027-04-01' : null,
      statut === 'VALIDE' ? validUser : null,
    ],
  );
}

function buildService(ds: DataSource): {
  service: ReforecastService;
  audit: AuditService;
} {
  const auditRepo = ds.getRepository(AuditLog);
  const audit = new AuditService(auditRepo);
  const versionRepo = ds.getRepository(DimVersion);
  const service = new ReforecastService(versionRepo, ds, audit);
  return { service, audit };
}

const USER = { userId: 'u1', email: 'admin@m.io' };

describe('ReforecastService.lancer', () => {
  let ds: DataSource;
  let ids: SeedIds;

  beforeEach(async () => {
    ds = await createDataSource();
    ids = await seed(ds);
    // Budget initial : 1000 par mois sur compte 611, 12 mois, CR_A
    for (let m = 0; m < 12; m++) {
      await insertBudget(
        ds,
        ids,
        ids.versionSourceId,
        ids.compteCharge,
        m,
        ids.cr1,
        1000,
      );
    }
    // Réalisé T1 (m=0,1,2) sur compte 611, CR_A : 800, 900, 1100
    await insertRealise(ds, ids, ids.compteCharge, 0, ids.cr1, 800);
    await insertRealise(ds, ids, ids.compteCharge, 1, ids.cr1, 900);
    await insertRealise(ds, ids, ids.compteCharge, 2, ids.cr1, 1100);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  function dto(over: Partial<LancerReforecastDto> = {}): LancerReforecastDto {
    return {
      fkVersionSource: ids.versionSourceId,
      fkScenarioSource: ids.scenarioId,
      trimestreConsolide: 1,
      anneeConsolide: 2027,
      methodeExtrapolation: 'MOYENNE_TRIMESTRE',
      libelleNouveauVersion: 'Reforecast T1 2027',
      ...over,
    };
  }

  it('MOYENNE_TRIMESTRE : T1=réalisé, T2-T4=moyenne du T1', async () => {
    const { service } = buildService(ds);
    const r = await service.lancer(
      dto({ methodeExtrapolation: 'MOYENNE_TRIMESTRE' }),
      USER,
    );
    expect(r.id).toBeDefined();
    expect(r.statut).toBe('ouvert');
    expect(r.statutPublication).toBe('ACTIVE');

    // Lignes générées : doivent être 12 (1 mois × 1 compte × 1 CR avec budget initial)
    const rows = (await ds.query(
      `SELECT t.mois, fb.montant_fcfa::float AS m
         FROM fait_budget fb
         INNER JOIN dim_temps t ON t.id = fb.fk_temps
        WHERE fb.fk_version = $1::bigint
        ORDER BY t.mois`,
      [r.id],
    )) as Array<{ mois: number; m: number }>;
    expect(rows).toHaveLength(12);

    // T1 (mois 1-3) : valeurs réelles 800, 900, 1100
    expect(rows[0]!.m).toBe(800);
    expect(rows[1]!.m).toBe(900);
    expect(rows[2]!.m).toBe(1100);
    // T2-T4 (mois 4-12) : moyenne (800+900+1100)/3 = 933.333…
    const moy = (800 + 900 + 1100) / 3;
    for (let i = 3; i < 12; i++) {
      expect(rows[i]!.m).toBeCloseTo(moy, 2);
    }
  });

  it('BUDGET_INITIAL : T2-T4 reprend le budget source intact', async () => {
    const { service } = buildService(ds);
    const r = await service.lancer(
      dto({ methodeExtrapolation: 'BUDGET_INITIAL' }),
      USER,
    );
    const rows = (await ds.query(
      `SELECT t.mois, fb.montant_fcfa::float AS m
         FROM fait_budget fb
         INNER JOIN dim_temps t ON t.id = fb.fk_temps
        WHERE fb.fk_version = $1::bigint
        ORDER BY t.mois`,
      [r.id],
    )) as Array<{ mois: number; m: number }>;
    // T1 = réalisé
    expect(rows[0]!.m).toBe(800);
    // T2-T4 = budget initial 1000
    for (let i = 3; i < 12; i++) {
      expect(rows[i]!.m).toBe(1000);
    }
  });

  it('MANUELLE : T2-T4 = 0', async () => {
    const { service } = buildService(ds);
    const r = await service.lancer(
      dto({ methodeExtrapolation: 'MANUELLE' }),
      USER,
    );
    const rows = (await ds.query(
      `SELECT t.mois, fb.montant_fcfa::float AS m
         FROM fait_budget fb
         INNER JOIN dim_temps t ON t.id = fb.fk_temps
        WHERE fb.fk_version = $1::bigint
        ORDER BY t.mois`,
      [r.id],
    )) as Array<{ mois: number; m: number }>;
    for (let i = 3; i < 12; i++) {
      expect(rows[i]!.m).toBe(0);
    }
  });

  it('T1 sans réalisé pour un mois donné : montant=0 (la ligne existe mais le réalisé manque)', async () => {
    // Supprimons le réalisé du mois 1
    await ds.query(`DELETE FROM fait_realise WHERE fk_temps = $1::bigint`, [
      ids.temps[0]!,
    ]);
    const { service } = buildService(ds);
    const r = await service.lancer(
      dto({ methodeExtrapolation: 'BUDGET_INITIAL' }),
      USER,
    );
    const rows = (await ds.query(
      `SELECT t.mois, fb.montant_fcfa::float AS m
         FROM fait_budget fb
         INNER JOIN dim_temps t ON t.id = fb.fk_temps
        WHERE fb.fk_version = $1::bigint
        ORDER BY t.mois`,
      [r.id],
    )) as Array<{ mois: number; m: number }>;
    expect(rows[0]!.m).toBe(0); // pas de réalisé → 0
    expect(rows[1]!.m).toBe(900); // réalisé existe
  });

  it('rejette si version source non publiée (gele)', async () => {
    await ds.query(
      `UPDATE dim_version SET statut = 'ouvert' WHERE id = $1::bigint`,
      [ids.versionSourceId],
    );
    const { service } = buildService(ds);
    await expect(service.lancer(dto(), USER)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('rejette si version source introuvable', async () => {
    const { service } = buildService(ds);
    await expect(
      service.lancer(dto({ fkVersionSource: '999999' }), USER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejette si scénario source introuvable', async () => {
    const { service } = buildService(ds);
    await expect(
      service.lancer(dto({ fkScenarioSource: '999999' }), USER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejette si aucun réalisé VALIDE pour le trimestre consolidé', async () => {
    await ds.query(`DELETE FROM fait_realise`);
    const { service } = buildService(ds);
    await expect(service.lancer(dto(), USER)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('rejette si réalisé existe mais en statut IMPORTE seulement', async () => {
    await ds.query(
      `UPDATE fait_realise SET statut = 'IMPORTE', valide_le = NULL, fk_valide_par = NULL`,
    );
    const { service } = buildService(ds);
    await expect(service.lancer(dto(), USER)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('audit LANCER_REFORECAST émis avec payload complet', async () => {
    const { service } = buildService(ds);
    const r = await service.lancer(dto(), USER);
    const audits = (await ds.query(
      `SELECT type_action, payload_apres FROM audit_log
        WHERE id_cible = $1::text AND type_action = 'LANCER_REFORECAST'`,
      [r.id],
    )) as Array<{
      type_action: string;
      payload_apres: Record<string, unknown>;
    }>;
    expect(audits).toHaveLength(1);
    const payload = audits[0]!.payload_apres;
    expect(payload.methodeExtrapolation).toBe('MOYENNE_TRIMESTRE');
    expect(payload.trimestreConsolide).toBe(1);
    expect(payload.anneeConsolide).toBe(2027);
    expect(typeof payload.nbLignes).toBe('number');
  });

  it('obsolescence : le reforecast ACTIVE existant est marqué OBSOLETE par le nouveau', async () => {
    const { service } = buildService(ds);
    const r1 = await service.lancer(dto(), USER);
    const r2 = await service.lancer(
      dto({ libelleNouveauVersion: 'Reforecast T1 2027 (v2)' }),
      USER,
    );

    const rows = (await ds.query(
      `SELECT id, statut_publication, fk_version_remplacante, date_obsolescence
         FROM dim_version WHERE id IN ($1::bigint, $2::bigint)
        ORDER BY id`,
      [r1.id, r2.id],
    )) as Array<{
      id: string;
      statut_publication: string;
      fk_version_remplacante: string | null;
      date_obsolescence: Date | null;
    }>;
    const oldRow = rows.find((x) => String(x.id) === r1.id)!;
    const newRow = rows.find((x) => String(x.id) === r2.id)!;
    expect(oldRow.statut_publication).toBe('OBSOLETE');
    expect(String(oldRow.fk_version_remplacante)).toBe(r2.id);
    expect(oldRow.date_obsolescence).toBeTruthy();
    expect(newRow.statut_publication).toBe('ACTIVE');
  });

  it('obsolescence : audit MARQUER_REFORECAST_OBSOLETE émis', async () => {
    const { service } = buildService(ds);
    const r1 = await service.lancer(dto(), USER);
    await service.lancer(dto({ libelleNouveauVersion: 'v2' }), USER);

    const audits = (await ds.query(
      `SELECT id_cible FROM audit_log
        WHERE type_action = 'MARQUER_REFORECAST_OBSOLETE'
          AND id_cible = $1::text`,
      [r1.id],
    )) as Array<{ id_cible: string }>;
    expect(audits).toHaveLength(1);
  });

  it("audit du nouveau lancer() inclut reforecastObsolete avec l'id de l'ancien", async () => {
    const { service } = buildService(ds);
    const r1 = await service.lancer(dto(), USER);
    const r2 = await service.lancer(dto({ libelleNouveauVersion: 'v2' }), USER);
    const audits = (await ds.query(
      `SELECT payload_apres FROM audit_log
        WHERE id_cible = $1::text AND type_action = 'LANCER_REFORECAST'`,
      [r2.id],
    )) as Array<{ payload_apres: { reforecastObsolete?: string[] } }>;
    const payload = audits[0]!.payload_apres;
    expect(payload.reforecastObsolete).toBeDefined();
    expect(payload.reforecastObsolete!.map(String)).toContain(r1.id);
  });

  it('code version contient le timestamp pour éviter collisions', async () => {
    const { service } = buildService(ds);
    const r = await service.lancer(dto(), USER);
    expect(r.codeVersion).toMatch(/^REFORECAST_T1_2027_\d+$/);
  });

  it('perf : génération de 240 lignes < 2 secondes (extrapolation 6000 attendue ~50s en pg-mem, ms en prod)', async () => {
    // 20 CR × 12 mois = 240 lignes. On mesure le temps du `service
    // .lancer()` exclusivement (pas le seed). En pg-mem une INSERT
    // ...SELECT vaut bcp plus que la somme de N INSERT, donc le
    // service est rapide même quand le seed est lent.
    await ds.query(`DELETE FROM fait_budget`);
    for (let i = 1; i <= 20; i++) {
      await ds.query(
        `INSERT INTO dim_centre_responsabilite
           (code_cr, libelle, type_cr, fk_structure, date_debut_validite,
            version_courante, est_actif, utilisateur_creation)
         VALUES ($1, $2, 'profit_center', $3::bigint, '2026-01-01', true, true, 'system')`,
        [`CR_PERF_${i}`, `Perf ${i}`, ids.structure],
      );
    }
    const newCrs = (await ds.query(
      `SELECT id FROM dim_centre_responsabilite WHERE code_cr LIKE 'CR_PERF_%'`,
    )) as Array<{ id: string }>;
    for (const cr of newCrs) {
      for (let m = 0; m < 12; m++) {
        await insertBudget(
          ds,
          ids,
          ids.versionSourceId,
          ids.compteCharge,
          m,
          String(cr.id),
          1000,
        );
      }
    }
    const { service } = buildService(ds);
    const t0 = Date.now();
    const r = await service.lancer(
      dto({ methodeExtrapolation: 'BUDGET_INITIAL' }),
      USER,
    );
    const elapsed = Date.now() - t0;
    expect(r.id).toBeDefined();
    const cnt = (await ds.query(
      `SELECT COUNT(*)::int AS n FROM fait_budget WHERE fk_version = $1::bigint`,
      [r.id],
    )) as Array<{ n: number }>;
    expect(cnt[0]!.n).toBeGreaterThanOrEqual(240);
    // Le `service.lancer()` lui-même doit être rapide même en pg-mem.
    expect(elapsed).toBeLessThan(2000);
    // Diagnostic visible
    if (elapsed > 500) {
      console.warn(`[perf reforecast] 240 lignes générées en ${elapsed}ms`);
    }
  }, 30000); // timeout test = 30s pour absorber la lenteur du seed pg-mem
});

describe('ReforecastService.lister + getById + getEntityById', () => {
  let ds: DataSource;
  let ids: SeedIds;

  beforeEach(async () => {
    ds = await createDataSource();
    ids = await seed(ds);
    for (let m = 0; m < 12; m++) {
      await insertBudget(
        ds,
        ids,
        ids.versionSourceId,
        ids.compteCharge,
        m,
        ids.cr1,
        1000,
      );
    }
    await insertRealise(ds, ids, ids.compteCharge, 0, ids.cr1, 800);
    await insertRealise(ds, ids, ids.compteCharge, 1, ids.cr1, 900);
    await insertRealise(ds, ids, ids.compteCharge, 2, ids.cr1, 1100);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('lister : ne renvoie que les versions type=reforecast', async () => {
    const { service } = buildService(ds);
    await service.lancer(
      {
        fkVersionSource: ids.versionSourceId,
        fkScenarioSource: ids.scenarioId,
        trimestreConsolide: 1,
        anneeConsolide: 2027,
        methodeExtrapolation: 'BUDGET_INITIAL',
        libelleNouveauVersion: 'r1',
      },
      USER,
    );
    const list = await service.lister({});
    expect(list).toHaveLength(1);
    // La version source 'budget_initial' n'est pas dans la liste
    expect(list.every((v) => v.id !== ids.versionSourceId)).toBe(true);
  });

  it('lister : par défaut filtre sur statutPublication=ACTIVE', async () => {
    const { service } = buildService(ds);
    await service.lancer(
      {
        fkVersionSource: ids.versionSourceId,
        fkScenarioSource: ids.scenarioId,
        trimestreConsolide: 1,
        anneeConsolide: 2027,
        methodeExtrapolation: 'BUDGET_INITIAL',
        libelleNouveauVersion: 'r1',
      },
      USER,
    );
    await service.lancer(
      {
        fkVersionSource: ids.versionSourceId,
        fkScenarioSource: ids.scenarioId,
        trimestreConsolide: 1,
        anneeConsolide: 2027,
        methodeExtrapolation: 'BUDGET_INITIAL',
        libelleNouveauVersion: 'r2',
      },
      USER,
    );
    // r1 est OBSOLETE, r2 est ACTIVE
    const actifs = await service.lister({});
    expect(actifs).toHaveLength(1);
    expect(actifs[0]!.libelle).toBe('r2');

    const obsoletes = await service.lister({ statutPublication: 'OBSOLETE' });
    expect(obsoletes).toHaveLength(1);
    expect(obsoletes[0]!.libelle).toBe('r1');
  });

  it('lister : filtre par anneeConsolide', async () => {
    const { service } = buildService(ds);
    await service.lancer(
      {
        fkVersionSource: ids.versionSourceId,
        fkScenarioSource: ids.scenarioId,
        trimestreConsolide: 1,
        anneeConsolide: 2027,
        methodeExtrapolation: 'BUDGET_INITIAL',
        libelleNouveauVersion: 'r1',
      },
      USER,
    );
    expect(await service.lister({ anneeConsolide: 2027 })).toHaveLength(1);
    expect(await service.lister({ anneeConsolide: 2028 })).toHaveLength(0);
  });

  it('getById : 404 sur id inexistant', async () => {
    const { service } = buildService(ds);
    await expect(service.getById('999999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("getById : 404 sur une version type='budget_initial' (pas un reforecast)", async () => {
    const { service } = buildService(ds);
    await expect(service.getById(ids.versionSourceId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("getEntityById renvoie l'entité brute pour usage du workflow", async () => {
    const { service } = buildService(ds);
    const r = await service.lancer(
      {
        fkVersionSource: ids.versionSourceId,
        fkScenarioSource: ids.scenarioId,
        trimestreConsolide: 1,
        anneeConsolide: 2027,
        methodeExtrapolation: 'BUDGET_INITIAL',
        libelleNouveauVersion: 'r1',
      },
      USER,
    );
    const entity = await service.getEntityById(r.id);
    expect(entity.typeVersion).toBe('reforecast');
    expect(entity.statutPublication).toBe('ACTIVE');
  });
});

describe('ReforecastService.getComparaison', () => {
  let ds: DataSource;
  let ids: SeedIds;

  beforeEach(async () => {
    ds = await createDataSource();
    ids = await seed(ds);
    for (let m = 0; m < 12; m++) {
      await insertBudget(
        ds,
        ids,
        ids.versionSourceId,
        ids.compteCharge,
        m,
        ids.cr1,
        1000,
      );
    }
    await insertRealise(ds, ids, ids.compteCharge, 0, ids.cr1, 800);
    await insertRealise(ds, ids, ids.compteCharge, 1, ids.cr1, 900);
    await insertRealise(ds, ids, ids.compteCharge, 2, ids.cr1, 1100);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it("classe les lignes par origine (REALISE / EXTRAPOLATION) et calcule l'écart", async () => {
    const { service } = buildService(ds);
    const r = await service.lancer(
      {
        fkVersionSource: ids.versionSourceId,
        fkScenarioSource: ids.scenarioId,
        trimestreConsolide: 1,
        anneeConsolide: 2027,
        methodeExtrapolation: 'BUDGET_INITIAL',
        libelleNouveauVersion: 'r1',
      },
      USER,
    );
    const cmp = await service.getComparaison(r.id);
    expect(cmp.lignes).toHaveLength(12);
    // 3 lignes REALISE (T1)
    expect(cmp.lignes.filter((l) => l.origine === 'REALISE')).toHaveLength(3);
    // 9 lignes EXTRAPOLATION (T2-T4)
    expect(
      cmp.lignes.filter((l) => l.origine === 'EXTRAPOLATION'),
    ).toHaveLength(9);
    // Ligne mois 1 : source=1000, reforecast=800 (réalisé), écart=-200
    const m1 = cmp.lignes.find((l) => l.mois === 1)!;
    expect(m1.montantSource).toBe(1000);
    expect(m1.montantReforecast).toBe(800);
    expect(m1.ecart).toBe(-200);
    // Ligne mois 4 : source=1000, reforecast=1000 (BUDGET_INITIAL), écart=0
    const m4 = cmp.lignes.find((l) => l.mois === 4)!;
    expect(m4.ecart).toBe(0);
    // Total
    expect(cmp.totalSource).toBe(12000);
    expect(cmp.totalReforecast).toBe(800 + 900 + 1100 + 9 * 1000);
  });

  it('méthode MANUELLE : origine=MANUEL pour T2-T4', async () => {
    const { service } = buildService(ds);
    const r = await service.lancer(
      {
        fkVersionSource: ids.versionSourceId,
        fkScenarioSource: ids.scenarioId,
        trimestreConsolide: 1,
        anneeConsolide: 2027,
        methodeExtrapolation: 'MANUELLE',
        libelleNouveauVersion: 'r1',
      },
      USER,
    );
    const cmp = await service.getComparaison(r.id);
    const manuels = cmp.lignes.filter((l) => l.origine === 'MANUEL');
    expect(manuels).toHaveLength(9);
    expect(manuels.every((l) => l.montantReforecast === 0)).toBe(true);
  });
});
