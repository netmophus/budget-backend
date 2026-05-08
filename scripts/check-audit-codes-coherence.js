#!/usr/bin/env node
/**
 * Vérifie la cohérence entre les codes audit insérés dans les
 * migrations (`ref_type_action_audit`) et le type union TypeAction
 * de `src/audit/entities/audit-log.entity.ts`.
 *
 * Détecte la dette type bug Lot Administration où un code audit
 * était inséré en base sans être déclaré dans le type TS — ts-jest
 * et nest build laissent passer ce désalignement.
 *
 * Sortie :
 *   - 0 si tous les codes des migrations sont dans TypeAction.
 *   - 1 (échec CI) si désaccord, avec détail des codes manquants.
 *
 * Heuristique simple basée sur des regex (pas d'AST) — suffisante
 * pour le pattern de migrations existant.
 *
 * Lot 6.1 — chantier 6.1.A.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'src', 'migrations');
const AUDIT_ENTITY = path.join(
  REPO_ROOT,
  'src',
  'audit',
  'entities',
  'audit-log.entity.ts',
);

function lire(file) {
  return fs.readFileSync(file, 'utf8');
}

/**
 * Extrait le set des codes déclarés dans le type union TypeAction.
 * Cible les littéraux entre quotes simples sur les lignes du type.
 */
function extraireCodesTypeAction(source) {
  const match = source.match(/export\s+type\s+TypeAction\s*=([\s\S]*?);/);
  if (!match) {
    throw new Error('TypeAction introuvable dans audit-log.entity.ts');
  }
  const codes = new Set();
  const re = /'([A-Z][A-Z0-9_]*)'/g;
  let m;
  while ((m = re.exec(match[1])) !== null) {
    codes.add(m[1]);
  }
  return codes;
}

/**
 * Extrait, pour chaque migration, le set des codes insérés dans
 * `ref_type_action_audit` via les `INSERT INTO "ref_type_action_audit" ...
 * VALUES ('CODE', ...)`.
 */
function extraireCodesMigrations() {
  const result = new Map(); // file -> Set<code>
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  for (const f of files) {
    const source = lire(path.join(MIGRATIONS_DIR, f));
    if (!/INSERT\s+INTO\s+"ref_type_action_audit"/i.test(source)) continue;
    const codes = new Set();
    // Cible le bloc VALUES (...) qui suit l'INSERT INTO ref_type_action_audit
    const blocs = source.match(
      /INSERT\s+INTO\s+"ref_type_action_audit"[\s\S]*?(?:ON CONFLICT|;\s*`)/gi,
    );
    if (!blocs) continue;
    for (const bloc of blocs) {
      // Premier élément de chaque tuple VALUES ('CODE', ...) au début
      // du tuple uniquement (pour éviter de matcher les libellés).
      const re = /\(\s*\n?\s*'([A-Z][A-Z0-9_]*)'/g;
      let m;
      while ((m = re.exec(bloc)) !== null) {
        codes.add(m[1]);
      }
    }
    if (codes.size > 0) result.set(f, codes);
  }
  return result;
}

function main() {
  const typeActionCodes = extraireCodesTypeAction(lire(AUDIT_ENTITY));
  const migrationCodes = extraireCodesMigrations();

  const orphans = []; // codes dans une migration MAIS pas dans TypeAction
  for (const [file, codes] of migrationCodes) {
    for (const code of codes) {
      if (!typeActionCodes.has(code)) {
        orphans.push({ code, file });
      }
    }
  }

  if (orphans.length > 0) {
    console.error('\n❌ Désalignement migrations ↔ TypeAction\n');
    console.error('Codes audit présents dans une migration mais ABSENTS du');
    console.error('type union TypeAction (src/audit/entities/audit-log.entity.ts) :\n');
    for (const o of orphans) {
      console.error(`  - ${o.code}  (migration : ${o.file})`);
    }
    console.error(
      '\nAjoute-les au type TypeAction pour que ts-jest, tsc et le code applicatif',
    );
    console.error('soient cohérents avec la base.\n');
    process.exit(1);
  }

  console.log(
    `✅ ${typeActionCodes.size} codes audit déclarés, ` +
      `${[...migrationCodes.values()].reduce((n, s) => n + s.size, 0)} insertions migrations — alignement OK.`,
  );
}

main();
