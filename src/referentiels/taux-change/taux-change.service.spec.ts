/**
 * Tests unitaires TauxChangeService via pg-mem.
 *
 * Couvre :
 *  - findTauxApplicable (date exacte, date entre 2 taux, date avant
 *    tout taux → null, devise inconnue → null)
 *  - create avec résolution codeDevise + date → fkDevise + fkTemps
 *    et invariant unicité (devise, temps, type)
 *  - refus pivot, refus devise/date inconnues
 *  - update / remove
 *
 * Limitation pg-mem : l'index unique partiel et le CHECK > 0 ne sont
 * pas tous créés par `synchronize:true`. Les invariants sont protégés
 * en première ligne par le service (vérification d'unicité applicative,
 * validation Min(0.00000001) au DTO). L'index unique composite reste
 * une 2ᵉ ligne de défense côté Postgres réel.
 */
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';

import { DimDevise } from '../devise/entities/dim-devise.entity';
import { DimTemps } from '../temps/entities/dim-temps.entity';
import { RefTauxChange } from './entities/ref-taux-change.entity';
import { TauxChangeService } from './taux-change.service';

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
    entities: [RefTauxChange, DimDevise, DimTemps],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

async function insertDevise(
  ds: DataSource,
  codeIso: string,
  estPivot = false,
): Promise<string> {
  await ds.query(
    `INSERT INTO dim_devise
      ("code_iso","libelle","nb_decimales","est_devise_pivot","est_active","utilisateur_creation")
     VALUES ($1,$2,2,$3,true,'system')`,
    [codeIso, codeIso, estPivot],
  );
  const r = (await ds.query(`SELECT id FROM dim_devise WHERE code_iso = $1`, [
    codeIso,
  ])) as Array<{ id: string | number }>;
  return String(r[0]!.id);
}

async function insertTemps(ds: DataSource, date: string): Promise<string> {
  // Champs minimaux pour la table dim_temps (cf. seed temps).
  // Note : pg-mem peut ne pas couvrir tous les CHECK, on fournit
  // des valeurs cohérentes.
  const [y, m, d] = date.split('-').map((s) => parseInt(s, 10));
  await ds.query(
    `INSERT INTO dim_temps
      ("date","annee","trimestre","mois","jour","jour_ouvre","est_fin_de_mois",
       "est_fin_de_trimestre","est_fin_d_annee","exercice_fiscal","libelle_mois")
     VALUES ($1,$2,$3,$4,$5,true,false,false,false,$2,'')`,
    [date, y, Math.ceil(m! / 3), m, d],
  );
  const r = (await ds.query(`SELECT id FROM dim_temps WHERE date = $1`, [
    date,
  ])) as Array<{ id: string | number }>;
  return String(r[0]!.id);
}

async function insertTaux(
  ds: DataSource,
  fkDevise: string,
  fkTemps: string,
  taux: string,
  typeTaux: 'cloture' | 'moyen_mensuel' | 'fixe_budgetaire',
): Promise<void> {
  await ds.query(
    `INSERT INTO ref_taux_change
      ("fk_devise","fk_temps","taux_vers_pivot","source","type_taux","utilisateur_creation")
     VALUES ($1,$2,$3,'BCEAO',$4,'system')`,
    [fkDevise, fkTemps, taux, typeTaux],
  );
}

describe('TauxChangeService', () => {
  let dataSource: DataSource;
  let repo: Repository<RefTauxChange>;
  let deviseRepo: Repository<DimDevise>;
  let tempsRepo: Repository<DimTemps>;
  let service: TauxChangeService;

  beforeAll(async () => {
    dataSource = await createDataSource();
    repo = dataSource.getRepository(RefTauxChange);
    deviseRepo = dataSource.getRepository(DimDevise);
    tempsRepo = dataSource.getRepository(DimTemps);
    service = new TauxChangeService(repo, deviseRepo, tempsRepo);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM ref_taux_change');
    await dataSource.query('DELETE FROM dim_devise');
    await dataSource.query('DELETE FROM dim_temps');
  });

  // ─── findTauxApplicable

  describe('findTauxApplicable (CRITIQUE Lot 3.2)', () => {
    let fkEur: string;
    let fkTemps0331: string;
    let fkTemps0630: string;

    beforeEach(async () => {
      fkEur = await insertDevise(dataSource, 'EUR');
      await insertDevise(dataSource, 'XOF', true);
      fkTemps0331 = await insertTemps(dataSource, '2026-03-31');
      fkTemps0630 = await insertTemps(dataSource, '2026-06-30');
      await insertTemps(dataSource, '2026-04-15');
      await insertTemps(dataSource, '2026-01-15');

      await insertTaux(
        dataSource,
        fkEur,
        fkTemps0331,
        '655.95700000',
        'cloture',
      );
      await insertTaux(
        dataSource,
        fkEur,
        fkTemps0630,
        '656.10000000',
        'cloture',
      );
    });

    // pg-mem normalise les numeric en supprimant les zéros de fin
    // (655.95700000 → 655.957). On compare en parseFloat pour être
    // tolérant, l'important c'est la valeur numérique.

    it('date exacte → retourne le taux exact', async () => {
      const r = await service.findTauxApplicable(
        'EUR',
        '2026-03-31',
        'cloture',
      );
      expect(r).not.toBeNull();
      expect(parseFloat(r!.tauxVersPivot)).toBeCloseTo(655.957, 5);
      expect(r!.dateApplicable).toBe('2026-03-31');
    });

    it('date entre deux taux → retourne le plus récent antérieur', async () => {
      const r = await service.findTauxApplicable(
        'EUR',
        '2026-04-15',
        'cloture',
      );
      expect(r).not.toBeNull();
      expect(r!.dateApplicable).toBe('2026-03-31');
      expect(parseFloat(r!.tauxVersPivot)).toBeCloseTo(655.957, 5);
    });

    it('date après le dernier taux → retourne le dernier taux', async () => {
      const r = await service.findTauxApplicable(
        'EUR',
        '2026-06-30',
        'cloture',
      );
      expect(r!.dateApplicable).toBe('2026-06-30');
      expect(parseFloat(r!.tauxVersPivot)).toBeCloseTo(656.1, 5);
    });

    it('date avant tout taux → null', async () => {
      const r = await service.findTauxApplicable(
        'EUR',
        '2026-01-15',
        'cloture',
      );
      expect(r).toBeNull();
    });

    it('devise inconnue → null', async () => {
      const r = await service.findTauxApplicable(
        'JPY',
        '2026-03-31',
        'cloture',
      );
      expect(r).toBeNull();
    });

    it('typeTaux différent → null si aucun taux de ce type', async () => {
      const r = await service.findTauxApplicable(
        'EUR',
        '2026-03-31',
        'moyen_mensuel',
      );
      expect(r).toBeNull();
    });

    it('case-insensitive sur codeDevise', async () => {
      const r = await service.findTauxApplicable(
        'eur',
        '2026-03-31',
        'cloture',
      );
      expect(r).not.toBeNull();
    });
  });

  // ─── create

  describe('create', () => {
    let fkEur: string;
    let fkXof: string;
    let fkTemps: string;

    beforeEach(async () => {
      fkEur = await insertDevise(dataSource, 'EUR');
      fkXof = await insertDevise(dataSource, 'XOF', true);
      fkTemps = await insertTemps(dataSource, '2026-03-31');
      void fkXof;
      void fkEur;
      void fkTemps;
    });

    it('crée un taux avec résolution codeDevise + date → fkDevise + fkTemps', async () => {
      const created = await service.create(
        {
          codeDevise: 'EUR',
          date: '2026-03-31',
          tauxVersPivot: 655.957,
          typeTaux: 'cloture',
        },
        'admin@miznas.local',
      );
      expect(created.fkDevise).toBeDefined();
      expect(created.fkTemps).toBeDefined();
      expect(created.tauxVersPivot).toContain('655.957');
    });

    it('refuse devise inconnue (422)', async () => {
      await expect(
        service.create(
          {
            codeDevise: 'JPY',
            date: '2026-03-31',
            tauxVersPivot: 6,
            typeTaux: 'cloture',
          },
          'admin',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('refuse date inconnue (422)', async () => {
      await expect(
        service.create(
          {
            codeDevise: 'EUR',
            date: '2050-01-01',
            tauxVersPivot: 600,
            typeTaux: 'cloture',
          },
          'admin',
        ),
      ).rejects.toThrow(/dim_temps/);
    });

    it('refuse de créer un taux pour la devise pivot (XOF)', async () => {
      await expect(
        service.create(
          {
            codeDevise: 'XOF',
            date: '2026-03-31',
            tauxVersPivot: 1,
            typeTaux: 'cloture',
          },
          'admin',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('refuse doublon (devise, date, type) — 409', async () => {
      await service.create(
        {
          codeDevise: 'EUR',
          date: '2026-03-31',
          tauxVersPivot: 655.957,
          typeTaux: 'cloture',
        },
        'admin',
      );
      await expect(
        service.create(
          {
            codeDevise: 'EUR',
            date: '2026-03-31',
            tauxVersPivot: 656,
            typeTaux: 'cloture',
          },
          'admin',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── update / remove

  describe('update', () => {
    it('met à jour seulement tauxVersPivot et source', async () => {
      const fkEur = await insertDevise(dataSource, 'EUR');
      const fkTemps = await insertTemps(dataSource, '2026-03-31');
      await insertTaux(dataSource, fkEur, fkTemps, '655.0', 'cloture');
      const all = await repo.find();
      const id = String(all[0]!.id);

      const updated = await service.update(id, {
        tauxVersPivot: 656.5,
        source: 'manuel',
      });
      expect(updated.tauxVersPivot).toContain('656.5');
      expect(updated.source).toBe('manuel');
    });

    it('throws NotFoundException pour id inconnu', async () => {
      await expect(service.update('999', { tauxVersPivot: 1 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('supprime un taux existant', async () => {
      const fkEur = await insertDevise(dataSource, 'EUR');
      const fkTemps = await insertTemps(dataSource, '2026-03-31');
      await insertTaux(dataSource, fkEur, fkTemps, '655.0', 'cloture');
      const all = await repo.find();
      const id = String(all[0]!.id);

      expect(await service.remove(id)).toBe(true);
      expect(await repo.count()).toBe(0);
    });

    it('retourne false si id inconnu', async () => {
      expect(await service.remove('999')).toBe(false);
    });
  });
});
