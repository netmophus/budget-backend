/**
 * Tests unitaires ConfigurationBanqueService (Lot B1) via pg-mem.
 *
 * Couvre : lecture complète + membres, version publique (whitelist
 * stricte — aucun champ sensible), update + audit transactionnel,
 * CRUD membre (ajout / désactivation logique).
 */
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';

import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { ConfigurationBanqueService } from './configuration-banque.service';
import { ConfigurationBanqueMembreComite } from './entities/configuration-banque-membre-comite.entity';
import { ConfigurationBanque } from './entities/configuration-banque.entity';

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
    entities: [ConfigurationBanque, ConfigurationBanqueMembreComite, AuditLog],
    synchronize: true,
  }) as DataSource;
  await ds.initialize();
  return ds;
}

const USER = { userId: '1', email: 'admin@test.local' };

async function seedConfig(ds: DataSource): Promise<void> {
  await ds.query(
    `INSERT INTO configuration_banque
       (id, nom, sigle, nom_commercial_complet, ville_siege, pays,
        couleur_primaire, couleur_primaire_dark, couleur_secondaire,
        contexte_marche, positionnement, utilisateur_creation)
     VALUES (1, 'BSIC NIGER', 'BSIC', 'Banque Sahelo-Saharienne', 'Niamey',
        'Niger', '#1B2A4E', '#0F1B33', '#C49B3F',
        'marche concurrentiel UEMOA', 'banque de reference', 'system')`,
  );
  await ds.query(
    `INSERT INTO configuration_banque_membre_comite
       (fk_configuration_banque, nom_prenom, titre, fonction, ordre_affichage, est_actif, utilisateur_creation)
     VALUES
       (1, 'Souleymane DIORI', 'M.', 'PRESIDENT', 1, true, 'system'),
       (1, 'Halima OUSMANE', 'Mme', 'MEMBRE', 2, true, 'system')`,
  );
}

describe('ConfigurationBanqueService', () => {
  let ds: DataSource;
  let svc: ConfigurationBanqueService;

  beforeAll(async () => {
    ds = await createDataSource();
  });
  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM configuration_banque_membre_comite');
    await ds.query('DELETE FROM configuration_banque');
    await ds.query('DELETE FROM audit_log');
    await seedConfig(ds);
    const audit = new AuditService(ds.getRepository(AuditLog));
    svc = new ConfigurationBanqueService(
      ds.getRepository(ConfigurationBanque),
      ds.getRepository(ConfigurationBanqueMembreComite),
      audit,
    );
  });

  it('getConfiguration : renvoie la config complète + membres ordonnés', async () => {
    const c = await svc.getConfiguration();
    expect(c.nom).toBe('BSIC NIGER');
    expect(c.contexteMarche).toBe('marche concurrentiel UEMOA');
    expect(c.membres).toHaveLength(2);
    expect(c.membres[0].nomPrenom).toBe('Souleymane DIORI');
    expect(c.membres[0].fonction).toBe('PRESIDENT');
  });

  it('getConfigurationPublique : whitelist stricte (pas de champ sensible)', async () => {
    const pub = await svc.getConfigurationPublique();
    expect(pub.nom).toBe('BSIC NIGER');
    expect(pub.couleurPrimaire).toBe('#1B2A4E');
    // Champs sensibles ABSENTS de la version publique.
    expect(pub).not.toHaveProperty('contexteMarche');
    expect(pub).not.toHaveProperty('positionnement');
    expect(pub).not.toHaveProperty('membres');
    expect(pub).not.toHaveProperty('refReglementaireBceao');
  });

  it('updateConfiguration : applique les champs + écrit un audit', async () => {
    const res = await svc.updateConfiguration(
      { nom: 'ECOBANK NIGER', couleurPrimaire: '#008751' },
      USER,
    );
    expect(res.nom).toBe('ECOBANK NIGER');
    expect(res.couleurPrimaire).toBe('#008751');
    const audits = (await ds.query(
      `SELECT 1 FROM audit_log WHERE type_action='CONFIGURATION_BANQUE_MODIFIEE'`,
    )) as unknown[];
    expect(audits).toHaveLength(1);
  });

  it('ajouterMembre : crée un membre actif + audit', async () => {
    const m = await svc.ajouterMembre(
      { nomPrenom: 'Issoufou BARRY', titre: 'M.', fonction: 'DG' },
      USER,
    );
    expect(m.nomPrenom).toBe('Issoufou BARRY');
    expect(m.estActif).toBe(true);
    const c = await svc.getConfiguration();
    expect(c.membres).toHaveLength(3);
  });

  it('desactiverMembre : suppression logique (est_actif=false)', async () => {
    const c = await svc.getConfiguration();
    const cible = c.membres[1];
    const res = await svc.desactiverMembre(cible.id, USER);
    expect(res.estActif).toBe(false);
    // Toujours présent en base (désactivé, pas supprimé).
    const apres = await svc.getConfiguration();
    expect(apres.membres).toHaveLength(2);
    expect(apres.membres.find((m) => m.id === cible.id)?.estActif).toBe(false);
  });

  // ─── Lot B3 — contexte email + cache ───────────────────────────────

  it('getBankContextForEmail : objet plat depuis la config', async () => {
    const ctx = await svc.getBankContextForEmail();
    expect(ctx.sigle).toBe('BSIC');
    expect(ctx.nom).toBe('BSIC NIGER');
    expect(ctx.adresseComplete).toContain('Niamey');
    expect(ctx.adresseComplete).toContain('Niger');
  });

  it('getBankContextForEmail : cache 5 min, invalidé par updateConfiguration', async () => {
    const c1 = await svc.getBankContextForEmail();
    expect(c1.sigle).toBe('BSIC');
    // Modif directe en base (contourne le service) → toujours servi du cache.
    await ds.query(`UPDATE configuration_banque SET sigle='XXX' WHERE id=1`);
    expect((await svc.getBankContextForEmail()).sigle).toBe('BSIC');
    // updateConfiguration invalide le cache → valeur fraîche au prochain appel.
    await svc.updateConfiguration({ sigle: 'ECOBANK' }, USER);
    expect((await svc.getBankContextForEmail()).sigle).toBe('ECOBANK');
  });

  it('getBankContextForEmail : fallback DEFAULT si config absente', async () => {
    await ds.query('DELETE FROM configuration_banque_membre_comite');
    await ds.query('DELETE FROM configuration_banque');
    const ctx = await svc.getBankContextForEmail();
    expect(ctx.sigle).toBe('BSIC'); // DEFAULT_BANK_BRANDING
    expect(ctx.nom).toBe('BSIC NIGER');
    expect(ctx.groupe).toBeNull();
  });
});
