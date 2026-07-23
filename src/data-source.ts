import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource, type DataSourceOptions } from 'typeorm';

dotenv.config();

// Globs relatifs au dossier courant : en local via ts-node `__dirname`
// pointe sur `src/` (matche les .ts), sur Heroku après `nest build`
// `__dirname` pointe sur `dist/` (matche les .js). Normalisation des
// séparateurs pour rester valable sous Windows comme sous Linux.
const root = __dirname.replace(/\\/g, '/');

// Aiven / Heroku Postgres imposent TLS (`sslmode=require`). Activé via
// DB_SSL=true. `rejectUnauthorized: false` accepte le certificat du
// fournisseur sans embarquer sa CA (suffisant pour recette/pilote).
const ssl =
  process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;

// DATABASE_URL (chaîne de connexion unique, ce que fournit Aiven/Heroku)
// prioritaire ; sinon variables discrètes pour le dev local.
const databaseUrl = process.env.DATABASE_URL;

const commonOptions = {
  type: 'postgres' as const,
  ssl,
  entities: [`${root}/**/*.entity{.ts,.js}`],
  migrations: [`${root}/migrations/*{.ts,.js}`],
  synchronize: false,
  migrationsRun: false,
  logging: ['error', 'warn', 'migration'] as ('error' | 'warn' | 'migration')[],
};

const options: DataSourceOptions = databaseUrl
  ? { ...commonOptions, url: databaseUrl }
  : {
      ...commonOptions,
      host: process.env.DB_HOST ?? 'localhost',
      port: Number.parseInt(process.env.DB_PORT ?? '5432', 10),
      username: process.env.DB_USER ?? 'postgres',
      password: process.env.DB_PASSWORD ?? '',
      database: process.env.DB_NAME ?? 'budget_db',
    };

export const AppDataSource = new DataSource(options);
