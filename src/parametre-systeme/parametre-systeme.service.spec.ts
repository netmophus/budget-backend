/**
 * Tests unitaires ParametreSystemeService via pg-mem (Palier 1 —
 * gouvernance saisie réalisé).
 */
import { NotFoundException } from '@nestjs/common';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';

import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { ParametreSysteme } from './entities/parametre-systeme.entity';
import { ParametreSystemeService } from './parametre-systeme.service';

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
    entities: [ParametreSysteme, AuditLog],
    synchronize: true,
  }) as DataSource;
  await ds.initialize();
  return ds;
}

const USER: AuthUser = { userId: '1', email: 'admin@miznas.local' };

describe('ParametreSystemeService', () => {
  let ds: DataSource;
  let service: ParametreSystemeService;

  beforeAll(async () => {
    ds = await createDataSource();
    const audit = new AuditService(ds.getRepository(AuditLog));
    service = new ParametreSystemeService(
      ds.getRepository(ParametreSysteme),
      audit,
    );
  });

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM parametre_systeme');
    await ds.query('DELETE FROM audit_log');
  });

  async function seedMode(valeur: string): Promise<void> {
    await ds.query(
      `INSERT INTO parametre_systeme (cle, valeur, type, utilisateur_creation)
       VALUES ('mode_saisie_realise', $1, 'ENUM', 'system')`,
      [valeur],
    );
  }

  it('getModeSaisieRealise → CENTRALISE par défaut si paramètre absent', async () => {
    expect(await service.getModeSaisieRealise()).toBe('CENTRALISE');
  });

  it('getModeSaisieRealise reflète la valeur seedée (DECENTRALISE)', async () => {
    await seedMode('DECENTRALISE');
    expect(await service.getModeSaisieRealise()).toBe('DECENTRALISE');
  });

  it('valeur corrompue en base → retombe sur CENTRALISE', async () => {
    await seedMode('N_IMPORTE_QUOI');
    expect(await service.getModeSaisieRealise()).toBe('CENTRALISE');
  });

  it('setModeSaisieRealise CENTRALISE → DECENTRALISE met à jour + audit', async () => {
    await seedMode('CENTRALISE');
    const res = await service.setModeSaisieRealise('DECENTRALISE', USER);
    expect(res).toBe('DECENTRALISE');
    expect(await service.getModeSaisieRealise()).toBe('DECENTRALISE');

    const audits = (await ds.query(
      `SELECT type_action, utilisateur, entite_cible FROM audit_log`,
    )) as Array<{
      type_action: string;
      utilisateur: string;
      entite_cible: string;
    }>;
    expect(audits).toHaveLength(1);
    expect(audits[0]!.type_action).toBe('MODIFIER_PARAMETRE_SYSTEME');
    expect(audits[0]!.utilisateur).toBe('admin@miznas.local');
    expect(audits[0]!.entite_cible).toBe('parametre_systeme');
  });

  it('setValeur sur une clé inexistante → NotFoundException', async () => {
    await expect(
      service.setValeur('cle_inexistante', 'x', USER),
    ).rejects.toThrow(NotFoundException);
  });
});
