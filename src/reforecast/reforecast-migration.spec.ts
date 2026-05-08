/**
 * Tests Lot 5.3.A — vérifient que la migration 055 contient bien
 * les éléments structurels attendus (extensions dim_version,
 * permission BUDGET.REFORECAST_LANCER, 6 codes audit, alignement
 * sur le type TypeAction TypeScript) et qu'elle est idempotente.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(
  __dirname,
  '..',
  'migrations',
  '1779200000160-AjoutReforecastTrimestriel.ts',
);

let SQL: string;
beforeAll(() => {
  SQL = readFileSync(MIGRATION_PATH, 'utf8');
});

describe('Migration 055 — AjoutReforecastTrimestriel', () => {
  it('ajoute les 9 colonnes attendues à dim_version', () => {
    const cols = [
      'fk_version_source',
      'fk_scenario_source',
      'trimestre_consolide',
      'annee_consolide',
      'methode_extrapolation',
      'statut_publication',
      'date_obsolescence',
      'fk_version_remplacante',
    ];
    for (const c of cols) {
      expect(SQL).toContain(`"${c}"`);
    }
    // Default ACTIVE pour statut_publication
    expect(SQL).toMatch(/"statut_publication"\s+varchar\(20\)\s+NOT NULL\s+DEFAULT\s+'ACTIVE'/i);
  });

  it('ajoute les 4 CHECK constraints attendus', () => {
    expect(SQL).toContain('chk_dim_version_statut_publication');
    expect(SQL).toContain('chk_dim_version_methode_extrapolation');
    expect(SQL).toContain('chk_dim_version_trimestre');
    expect(SQL).toContain('chk_dim_version_reforecast_coherence');
    // Vérifie le contenu du check de cohérence (NORMALE ↔ REFORECAST)
    expect(SQL).toContain("'reforecast'");
    expect(SQL).toMatch(/MOYENNE_TRIMESTRE.*BUDGET_INITIAL.*MANUELLE/s);
  });

  it('insère la permission BUDGET.REFORECAST_LANCER (idempotente)', () => {
    expect(SQL).toContain("'BUDGET.REFORECAST_LANCER'");
    expect(SQL).toMatch(/ON CONFLICT \("code_permission"\) DO NOTHING/);
  });

  it('attribue la permission à ADMIN et VALIDATEUR (et seulement eux)', () => {
    expect(SQL).toContain("['ADMIN', 'BUDGET.REFORECAST_LANCER']");
    expect(SQL).toContain("['VALIDATEUR', 'BUDGET.REFORECAST_LANCER']");
    expect(SQL).not.toContain("['SAISISSEUR', 'BUDGET.REFORECAST_LANCER']");
    expect(SQL).not.toContain("['LECTEUR', 'BUDGET.REFORECAST_LANCER']");
  });

  it('insère les 6 codes audit *_REFORECAST avec ON CONFLICT DO NOTHING', () => {
    const codes = [
      'LANCER_REFORECAST',
      'SOUMETTRE_REFORECAST',
      'VALIDER_REFORECAST',
      'REJETER_REFORECAST',
      'PUBLIER_REFORECAST',
      'MARQUER_REFORECAST_OBSOLETE',
    ];
    for (const c of codes) {
      expect(SQL).toContain(`'${c}'`);
    }
    expect(SQL).toMatch(/ON CONFLICT \("code"\) DO NOTHING/);
  });

  it('ajoute "reforecast" au référentiel ref_type_version', () => {
    expect(SQL).toContain("'Reforecast trimestriel'");
    expect(SQL).toMatch(/INSERT INTO "ref_type_version"/);
  });

  it('utilise IF NOT EXISTS pour les colonnes / index (idempotence)', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS/);
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS "idx_dim_version_source"/);
    expect(SQL).toMatch(
      /CREATE INDEX IF NOT EXISTS "idx_dim_version_statut_publication"/,
    );
  });

  it('utilise des DO blocks pour ajouter les FK / CHECK de manière idempotente', () => {
    // Pattern : IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ...)
    const matches = SQL.match(/SELECT 1 FROM pg_constraint WHERE conname/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(7);
  });

  it('méthode down() supprime les codes / permission / type / colonnes', () => {
    expect(SQL).toMatch(/public async down/);
    expect(SQL).toContain(`DELETE FROM "ref_type_action_audit"`);
    expect(SQL).toContain(`DELETE FROM "ref_permission"`);
    expect(SQL).toContain(`DELETE FROM "ref_type_version"`);
    expect(SQL).toMatch(/DROP COLUMN IF EXISTS "fk_version_source"/);
  });
});

describe('Type TypeAction — alignement avec migration', () => {
  it('contient les 6 codes audit du Lot 5.3', () => {
    const path = join(
      __dirname,
      '..',
      'audit',
      'entities',
      'audit-log.entity.ts',
    );
    const code = readFileSync(path, 'utf8');
    const codes = [
      'LANCER_REFORECAST',
      'SOUMETTRE_REFORECAST',
      'VALIDER_REFORECAST',
      'REJETER_REFORECAST',
      'PUBLIER_REFORECAST',
      'MARQUER_REFORECAST_OBSOLETE',
    ];
    for (const c of codes) {
      expect(code).toContain(`'${c}'`);
    }
  });
});
