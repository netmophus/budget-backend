/**
 * Tests unitaires CompteImportService.
 *
 * Stratégie : pg-mem + un vrai CompteService câblé sur le repo
 * mémoire. Le CSV est écrit dans un répertoire temporaire et passé
 * au service via importCsv (le chemin direct, sans buffer wrapper).
 *
 * Notes pg-mem (rappel partagé avec compte.service.spec.ts) :
 *  - bigint en number → coerce avec String() pour comparer.
 *  - Pas de WITH RECURSIVE (les findDescendants/Ancestors restent
 *    couverts ailleurs).
 *  - FK auto-référente : NULL avant DELETE pour le nettoyage.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

import { CsvImportService } from '../../common/csv/csv-import.service';
import { CompteImportService } from './compte-import.service';
import { CompteService } from './compte.service';
import { DimCompte } from './entities/dim-compte.entity';

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
    entities: [DimCompte],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

async function rawInsert(
  ds: DataSource,
  attrs: {
    codeCompte: string;
    libelle?: string;
    classe?: number;
    niveau?: number;
    parentId?: string | null;
    sens?: string | null;
    estCompteCollectif?: boolean;
    estPorteurInterets?: boolean;
    dateDebutValidite?: string;
  },
): Promise<string> {
  // Date passée pour que les UPDATE upsert créent une nouvelle
  // version SCD2 (et non un écrasement intra-jour).
  const past = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await ds.query(
    `INSERT INTO dim_compte
       ("code_compte","libelle","classe","sous_classe","fk_compte_parent",
        "niveau","sens","code_poste_budgetaire","est_compte_collectif",
        "est_porteur_interets","date_debut_validite","date_fin_validite",
        "version_courante","est_actif","utilisateur_creation")
     VALUES ($1,$2,$3,NULL,$4,$5,$6,NULL,$7,$8,$9,NULL,true,true,'system')`,
    [
      attrs.codeCompte,
      attrs.libelle ?? attrs.codeCompte,
      attrs.classe ?? 6,
      attrs.parentId ?? null,
      attrs.niveau ?? 1,
      attrs.sens ?? null,
      attrs.estCompteCollectif ?? false,
      attrs.estPorteurInterets ?? false,
      attrs.dateDebutValidite ?? past,
    ],
  );
  const rows = (await ds.query(
    `SELECT id FROM dim_compte WHERE code_compte = $1 AND version_courante = true`,
    [attrs.codeCompte],
  )) as Array<{ id: string | number }>;
  return String(rows[0]!.id);
}

describe('CompteImportService', () => {
  let dataSource: DataSource;
  let repo: Repository<DimCompte>;
  let compteService: CompteService;
  let csvImportService: CsvImportService;
  let importService: CompteImportService;
  let tmpDir: string;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(DimCompte);
    compteService = new CompteService(repo, dataSource);
    csvImportService = new CsvImportService();
    importService = new CompteImportService(csvImportService, compteService);
    tmpDir = mkdtempSync(join(tmpdir(), 'compte-import-test-'));
  });

  afterAll(async () => {
    rmSync(tmpDir, { recursive: true, force: true });
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('UPDATE dim_compte SET fk_compte_parent = NULL');
    await dataSource.query('DELETE FROM dim_compte');
  });

  function writeCsv(name: string, lines: string[]): string {
    const path = join(tmpDir, name);
    writeFileSync(path, lines.join('\n'), 'utf-8');
    return path;
  }

  const HEADER =
    'code_compte,libelle,classe,sous_classe,code_compte_parent,niveau,sens,code_poste_budgetaire,est_compte_collectif,est_porteur_interets';

  // ─── Cas nominal

  it('importe 10 lignes valides ordonnées (insert-only) → imported=10', async () => {
    const path = writeCsv('nominal.csv', [
      HEADER,
      '6,CHARGES,6,,,1,D,,false,false',
      '60,Charges expl,6,,6,2,D,,false,false',
      '61,Charges perso,6,,6,2,D,,false,false',
      '601,Achats,6,,60,3,D,,false,false',
      '611,Rémunérations,6,,61,3,D,,false,false',
      '601100,Achats matières,6,,601,4,D,,true,false',
      '601200,Achats fourn,6,,601,4,D,,true,false',
      '611100,Salaires bruts,6,,611,4,D,MASSE_SAL,true,false',
      '611200,Primes,6,,611,4,D,MASSE_SAL,true,false',
      '611300,Avantages nature,6,,611,4,D,MASSE_SAL,true,false',
    ]);

    const report = await importService.importCsv(path, 'insert-only', 'tester');

    expect(report.totalLines).toBe(10);
    expect(report.imported).toBe(10);
    expect(report.updated).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.errors).toEqual([]);
    expect(typeof report.dureeMs).toBe('number');

    const inDb = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM dim_compte WHERE version_courante = true`,
    )) as Array<{ c: number }>;
    expect(inDb[0]!.c).toBe(10);
  });

  // ─── Tri implicite

  it('importe en désordre (enfant avant parent) → tri par niveau ASC, imported=4', async () => {
    const path = writeCsv('disorder.csv', [
      HEADER,
      // Volontairement désordonnés : niveau 4 avant niveau 1.
      '601100,Achats matières,6,,601,4,D,,true,false',
      '601,Achats,6,,60,3,D,,false,false',
      '6,CHARGES,6,,,1,D,,false,false',
      '60,Charges expl,6,,6,2,D,,false,false',
    ]);

    const report = await importService.importCsv(path, 'insert-only', 'tester');

    expect(report.imported).toBe(4);
    expect(report.errors).toEqual([]);

    const codes = (await dataSource.query(
      `SELECT code_compte FROM dim_compte WHERE version_courante = true ORDER BY niveau, code_compte`,
    )) as Array<{ code_compte: string }>;
    expect(codes.map((c) => c.code_compte)).toEqual([
      '6',
      '60',
      '601',
      '601100',
    ]);
  });

  // ─── Validation Zod

  it('ligne mal formée → errors[].code=VALIDATION_ZOD, ne stoppe pas le batch', async () => {
    const path = writeCsv('zod-bad.csv', [
      HEADER,
      '6,CHARGES,6,,,1,D,,false,false',
      // Ligne 3 : code_compte vide (regex ^[0-9]+$ rejette '').
      ',Mauvais,6,,6,2,D,,false,false',
      '60,Charges expl,6,,6,2,D,,false,false',
    ]);

    const report = await importService.importCsv(path, 'insert-only', 'tester');

    expect(report.imported).toBe(2); // 6 + 60
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({
      ligne: 3,
      code: 'VALIDATION_ZOD',
    });
  });

  // ─── Parent inconnu

  it('ligne avec parent absent du batch ET de la base → PARENT_INCONNU', async () => {
    const path = writeCsv('parent-missing.csv', [
      HEADER,
      '6,CHARGES,6,,,1,D,,false,false',
      // Parent INEXISTANT : ni en base, ni dans le batch.
      '999100,Orphelin,6,,INEXISTANT,4,D,,true,false',
    ]);

    const report = await importService.importCsv(path, 'insert-only', 'tester');

    expect(report.imported).toBe(1); // racine 6
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({
      ligne: 3,
      codeCompte: '999100',
      code: 'PARENT_INCONNU',
    });
  });

  // ─── Doublon insert-only → SKIP

  it('mode insert-only : doublon existant → skipped (pas d\'erreur)', async () => {
    await rawInsert(dataSource, {
      codeCompte: '6',
      classe: 6,
      niveau: 1,
      sens: 'D',
    });

    const path = writeCsv('dup-insert-only.csv', [
      HEADER,
      '6,CHARGES,6,,,1,D,,false,false',
      '60,Charges expl,6,,6,2,D,,false,false',
    ]);

    const report = await importService.importCsv(path, 'insert-only', 'tester');

    expect(report.skipped).toBe(1);
    expect(report.imported).toBe(1); // 60
    expect(report.errors).toEqual([]);

    // Pas de duplication SCD2 sur '6'.
    const versions6 = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM dim_compte WHERE code_compte = '6'`,
    )) as Array<{ c: number }>;
    expect(versions6[0]!.c).toBe(1);
  });

  // ─── Doublon upsert + libellé différent → UPDATE (nouvelle version SCD2)

  it('mode upsert : libellé modifié → updated, V1 fermée + V2 courante', async () => {
    await rawInsert(dataSource, {
      codeCompte: '6',
      libelle: 'CHARGES',
      classe: 6,
      niveau: 1,
      sens: 'D',
    });

    const path = writeCsv('upsert-diff.csv', [
      HEADER,
      '6,CHARGES (V2),6,,,1,D,,false,false',
    ]);

    const report = await importService.importCsv(path, 'upsert', 'tester');

    expect(report.updated).toBe(1);
    expect(report.imported).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.errors).toEqual([]);

    const versions = (await dataSource.query(
      `SELECT libelle, version_courante FROM dim_compte WHERE code_compte = '6' ORDER BY date_debut_validite ASC`,
    )) as Array<{ libelle: string; version_courante: boolean }>;
    expect(versions).toHaveLength(2);
    expect(versions[0]!.version_courante).toBe(false);
    expect(versions[1]!.version_courante).toBe(true);
    expect(versions[1]!.libelle).toBe('CHARGES (V2)');
  });

  // ─── Doublon upsert + champs identiques → SKIP (no-op, pas de bruit historique)

  it('mode upsert : tous les champs SCD2 identiques → skipped (no-op)', async () => {
    await rawInsert(dataSource, {
      codeCompte: '6',
      libelle: 'CHARGES',
      classe: 6,
      niveau: 1,
      sens: 'D',
    });

    const path = writeCsv('upsert-noop.csv', [
      HEADER,
      // Strictement identique à la V1 en base.
      '6,CHARGES,6,,,1,D,,false,false',
    ]);

    const report = await importService.importCsv(path, 'upsert', 'tester');

    expect(report.skipped).toBe(1);
    expect(report.updated).toBe(0);
    expect(report.imported).toBe(0);
    expect(report.errors).toEqual([]);

    // Une seule version : pas de pollution historique.
    const versions = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM dim_compte WHERE code_compte = '6'`,
    )) as Array<{ c: number }>;
    expect(versions[0]!.c).toBe(1);
  });

  // ─── CSV vide

  it('CSV avec uniquement l\'entête → totalLines=0, rapport vide', async () => {
    const path = writeCsv('empty.csv', [HEADER]);

    const report = await importService.importCsv(path, 'insert-only', 'tester');

    expect(report).toMatchObject({
      totalLines: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    });
  });

  // ─── importBuffer (wrapper temp file)

  it('importBuffer écrit un fichier temporaire et nettoie après l\'import', async () => {
    const csv = [
      HEADER,
      '6,CHARGES,6,,,1,D,,false,false',
    ].join('\n');

    const report = await importService.importBuffer(
      Buffer.from(csv, 'utf-8'),
      'insert-only',
      'tester',
    );

    expect(report.imported).toBe(1);
    expect(report.errors).toEqual([]);
  });
});
