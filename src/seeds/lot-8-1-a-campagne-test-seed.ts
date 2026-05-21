/**
 * Seed Lot 8.1.A — Campagne test 2026 + Comité visa.
 *
 * Crée 1 campagne de démo `CAMPAGNE_TEST_2026` en statut PARAMETRAGE
 * + 3 membres de comité parmi les personas BSIC seedés. Idempotent
 * via `WHERE NOT EXISTS`.
 *
 * **Approche défensive** : si un email attendu n'existe pas dans
 * `"user"` (envs où les personas BSIC ne sont pas seedés), log warn
 * et SKIP la ligne plutôt que crash. Le signataire par défaut tombe
 * sur `admin@miznas.local` (garantie par auth-seed) si `dg@bsic.ne`
 * est absent.
 *
 * Usage : `npm run seed:lot-8-1-a-campagne`
 */
import 'reflect-metadata';
import type { DataSource } from 'typeorm';

import { AppDataSource } from '../data-source';

const CODE_CAMPAGNE = 'CAMPAGNE_TEST_2026';
const EXERCICE = 2026;
const LIBELLE_CAMPAGNE = 'Campagne test Lot 8.1.A';
const UTILISATEUR_CREATION = 'system (Lot 8.1.A seed)';

const EMAIL_SIGNATAIRE_DEFAUT = 'dg@bsic.ne';
const EMAIL_FALLBACK_SIGNATAIRE = 'admin@miznas.local';

interface MembreComite {
  email: string;
  ordre: number;
  libelleFonction: string;
}

const COMITE: readonly MembreComite[] = [
  { email: 'dga.ops@bsic.ne', ordre: 1, libelleFonction: 'DGA Opérations' },
  { email: 'dga.dev@bsic.ne', ordre: 2, libelleFonction: 'DGA Développement' },
  {
    email: 'finance@bsic.ne',
    ordre: 3,
    libelleFonction: 'Coordinateur Budgétaire',
  },
];

async function findUserIdByEmail(
  ds: DataSource,
  email: string,
): Promise<string | null> {
  const rows = (await ds.query(
    `SELECT "id" FROM "user" WHERE "email" = $1 LIMIT 1`,
    [email],
  )) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

async function seedLot81ACampagneTest(ds: DataSource): Promise<void> {
  // ─── 1. Résolution du signataire par défaut ──────────────────────
  let signataireId = await findUserIdByEmail(ds, EMAIL_SIGNATAIRE_DEFAUT);
  if (!signataireId) {
    console.warn(
      `[seed Lot 8.1.A] ${EMAIL_SIGNATAIRE_DEFAUT} introuvable — fallback ${EMAIL_FALLBACK_SIGNATAIRE}.`,
    );
    signataireId = await findUserIdByEmail(ds, EMAIL_FALLBACK_SIGNATAIRE);
  }
  if (!signataireId) {
    throw new Error(
      `[seed Lot 8.1.A] Aucun signataire trouvé (${EMAIL_SIGNATAIRE_DEFAUT} et ${EMAIL_FALLBACK_SIGNATAIRE} absents). Lance d'abord 'npm run seed:auth'.`,
    );
  }

  // ─── 2. INSERT campagne (idempotent via ON CONFLICT) ─────────────
  // **Hotfix Lot 8.1.A** : `INSERT ... SELECT $1 ... WHERE code = $1`
  // déclenchait PG 42P08 (types incohérents pour le paramètre $1 —
  // utilisé en SELECT donc déduit `text`, ET en WHERE code=$1 où
  // `code` est varchar(50) donc déduit `character varying`). Pattern
  // ON CONFLICT DO NOTHING utilise chaque paramètre une seule fois →
  // pas d'ambiguïté de type, et cohérent avec la convention idempotence
  // des migrations du projet (Lot 7.6 / 8.1.A).
  await ds.query(
    `INSERT INTO "campagne_budgetaire"
       ("code","exercice_fiscal","libelle","statut","mode_visa_defaut",
        "fk_user_signataire_defaut","utilisateur_creation")
     VALUES ($1, $2, $3, 'PARAMETRAGE', 'PARALLELE', $4::bigint, $5)
     ON CONFLICT ("code") DO NOTHING`,
    [
      CODE_CAMPAGNE,
      EXERCICE,
      LIBELLE_CAMPAGNE,
      signataireId,
      UTILISATEUR_CREATION,
    ],
  );

  const campRows = (await ds.query(
    `SELECT "id" FROM "campagne_budgetaire" WHERE "code" = $1`,
    [CODE_CAMPAGNE],
  )) as Array<{ id: string }>;
  if (campRows.length === 0) {
    throw new Error(
      `[seed Lot 8.1.A] Campagne ${CODE_CAMPAGNE} introuvable après INSERT — incohérence inattendue.`,
    );
  }
  const campagneId = campRows[0]!.id;
  console.log(
    `[seed Lot 8.1.A] Campagne ${CODE_CAMPAGNE} (id=${campagneId}) prête. Signataire: bigint ${signataireId}.`,
  );

  // ─── 3. INSERT 3 membres comité (idempotent + résilient) ─────────
  let nbInseres = 0;
  let nbSkipped = 0;
  for (const m of COMITE) {
    const userId = await findUserIdByEmail(ds, m.email);
    if (!userId) {
      console.warn(
        `[seed Lot 8.1.A] Membre ${m.email} introuvable — SKIP. (Persona BSIC non seedé dans cet env ?)`,
      );
      nbSkipped++;
      continue;
    }
    // Idempotence via ON CONFLICT sur la contrainte UNIQUE
    // `uq_camp_user (fk_campagne, fk_user)`. Le RETURNING ne renvoie
    // les colonnes QUE si l'INSERT a effectivement eu lieu (sinon
    // conflit silencieux → array vide), ce qui distingue parfaitement
    // l'insertion réelle d'un skip idempotent côté JS.
    const result = (await ds.query(
      `INSERT INTO "campagne_comite_membre"
         ("fk_campagne","fk_user","ordre","est_obligatoire","libelle_fonction","utilisateur_creation")
       VALUES ($1::uuid, $2::bigint, $3, true, $4, $5)
       ON CONFLICT ("fk_campagne","fk_user") DO NOTHING
       RETURNING "id"`,
      [campagneId, userId, m.ordre, m.libelleFonction, UTILISATEUR_CREATION],
    )) as Array<{ id: string }>;
    if (result.length > 0) {
      nbInseres++;
      console.log(
        `[seed Lot 8.1.A] Membre ajouté : ${m.email} (${m.libelleFonction}, ordre ${m.ordre}).`,
      );
    } else {
      console.log(
        `[seed Lot 8.1.A] Membre déjà présent : ${m.email} (skip idempotent).`,
      );
    }
  }

  console.log(
    `[seed Lot 8.1.A] Terminé. ${nbInseres} membre(s) inséré(s), ${nbSkipped} absent(s) ignoré(s).`,
  );
}

async function main(): Promise<void> {
  const ds = await AppDataSource.initialize();
  try {
    await seedLot81ACampagneTest(ds);
  } finally {
    await ds.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('[seed Lot 8.1.A] ERREUR :', err);
  process.exit(1);
});
