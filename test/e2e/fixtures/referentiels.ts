/**
 * Helpers e2e pour récupérer les ids des références seedées (temps,
 * compte, ligne métier, devise, CR) via SQL direct.
 *
 * Évite la duplication d'un round-trip HTTP par référence et reste
 * conforme à la convention "in-process pour pré-requis".
 */
import type { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

export async function getTempsIdParDate(
  app: INestApplication,
  date: string,
): Promise<string> {
  const ds = app.get<DataSource>(getDataSourceToken());
  const rows = (await ds.query(`SELECT id FROM dim_temps WHERE date = $1`, [
    date,
  ])) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error(`[e2e fixture] dim_temps date=${date} introuvable.`);
  }
  return String(rows[0]!.id);
}

export async function getCompteId(
  app: INestApplication,
  codeCompte: string,
): Promise<string> {
  const ds = app.get<DataSource>(getDataSourceToken());
  const rows = (await ds.query(
    `SELECT id FROM dim_compte WHERE code_compte = $1 AND version_courante = true`,
    [codeCompte],
  )) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error(`[e2e fixture] dim_compte code=${codeCompte} introuvable.`);
  }
  return String(rows[0]!.id);
}

export async function getLigneMetierId(
  app: INestApplication,
  codeLigne: string,
): Promise<string> {
  const ds = app.get<DataSource>(getDataSourceToken());
  const rows = (await ds.query(
    `SELECT id FROM dim_ligne_metier WHERE code_ligne_metier = $1 AND version_courante = true`,
    [codeLigne],
  )) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error(
      `[e2e fixture] dim_ligne_metier code=${codeLigne} introuvable.`,
    );
  }
  return String(rows[0]!.id);
}

export async function getDeviseId(
  app: INestApplication,
  codeIso: string,
): Promise<string> {
  const ds = app.get<DataSource>(getDataSourceToken());
  const rows = (await ds.query(
    `SELECT id FROM dim_devise WHERE code_iso = $1`,
    [codeIso],
  )) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error(`[e2e fixture] dim_devise code=${codeIso} introuvable.`);
  }
  return String(rows[0]!.id);
}

export async function getCrId(
  app: INestApplication,
  codeCr: string,
): Promise<string> {
  const ds = app.get<DataSource>(getDataSourceToken());
  const rows = (await ds.query(
    `SELECT id FROM dim_centre_responsabilite WHERE code_cr = $1 AND version_courante = true`,
    [codeCr],
  )) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error(
      `[e2e fixture] dim_centre_responsabilite code=${codeCr} introuvable.`,
    );
  }
  return String(rows[0]!.id);
}

export async function getVersionId(
  app: INestApplication,
  codeVersion: string,
): Promise<string> {
  const ds = app.get<DataSource>(getDataSourceToken());
  const rows = (await ds.query(
    `SELECT id FROM dim_version WHERE code_version = $1`,
    [codeVersion],
  )) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error(
      `[e2e fixture] dim_version code=${codeVersion} introuvable.`,
    );
  }
  return String(rows[0]!.id);
}

export async function getScenarioId(
  app: INestApplication,
  codeScenario: string,
): Promise<string> {
  const ds = app.get<DataSource>(getDataSourceToken());
  const rows = (await ds.query(
    `SELECT id FROM dim_scenario WHERE code_scenario = $1`,
    [codeScenario],
  )) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error(
      `[e2e fixture] dim_scenario code=${codeScenario} introuvable.`,
    );
  }
  return String(rows[0]!.id);
}
