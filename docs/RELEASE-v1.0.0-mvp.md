# Release v1.0.0-mvp — MIZNAS

> **Statut** : tag posé en clôture du **Lot 6.8** (recette finale + doc
> release). Le périmètre MVP du module Budgétaire Bancaire UEMOA est
> intégralement livré.
>
> Document de référence pour la **mise en production** par la banque
> pilote BSIC. Couvre les 8 sections requises pour une release :
> features, stack, déploiement, comptes seed, endpoints, dette tracée,
> procédure de tag.
>
> Date de publication : 2026-05-13 — derniers commits main :
> backend `8a51ed7` + frontend `edc46e1` (avant Lot 6.8).

---

## Table des matières

- [1. Vue d'ensemble](#1-vue-densemble)
- [2. Fonctionnalités MVP livrées](#2-fonctionnalités-mvp-livrées)
- [3. Stack technique](#3-stack-technique)
- [4. Procédure de déploiement](#4-procédure-de-déploiement)
- [5. Comptes seed BSIC](#5-comptes-seed-bsic)
- [6. Endpoints principaux](#6-endpoints-principaux)
- [7. Limitations connues et dette tracée Lot 7+](#7-limitations-connues-et-dette-tracée-lot-7)
- [8. Procédure de release](#8-procédure-de-release)
- [Références](#références)

---

## 1. Vue d'ensemble

MIZNAS — Module Budgétaire Bancaire UEMOA — couvre le cycle budgétaire
complet d'une banque commerciale de la zone UMOA, aligné PCB UMOA et
dispositif prudentiel BCEAO :

- **Élaboration** : versions, scénarios, saisie multi-axes
  (CR × compte × ligne_metier × produit × segment × temps × devise),
  workflow 4 statuts, indicateurs PNB/MNI/Coef d'exploitation, import
  en masse Excel/CSV.
- **Exécution** : saisie/import du réalisé mensuel, tableau de bord
  budget vs réalisé avec 4 niveaux d'alerte, reforecast trimestriel avec
  3 méthodes d'extrapolation et workflow polymorphe.
- **Transverse** : multi-périmètres (STRUCTURE / CR / CR_SET),
  délégations temporaires avec **anti-chaînage strict BCEAO**, 8
  événements email avec queue BullMQ + Redis, sécurisation mot de passe
  (policy 12+complexité, expiration 90j, rate limiting, forgot password
  self-service, reset admin async).
- **Administration** : CRUD users, attribution / retrait de rôles, audit
  réglementaire `audit_log` rétention 10 ans BCEAO.

### Chiffres clés au tag `v1.0.0-mvp`

| Indicateur | Valeur |
|------------|-------:|
| Lots livrés | 1 + 2 + 2.5 + 2.5-bis + 3 + Administration + 4 + 5 + 6.1 → 6.7 |
| Migrations TypeORM en base | **61** (de `1777800000000-CreateDimTemps` à `1779200000220-AjouterCodesAuditLot65`) |
| Dimensions seedées | 8 (`dim_temps`, `dim_devise`, `dim_structure`, `dim_centre_responsabilite`, `dim_compte`, `dim_ligne_metier`, `dim_produit`, `dim_segment`) |
| Référentiels secondaires paramétrables | 13 tables `ref_*` |
| Personas seedés | 8 (1 ADMIN + 1 LECTEUR + 6 personas BSIC métier) |
| Tests backend (Jest + pg-mem) | **1157 verts** |
| Tests frontend (Vitest + Testing Library) | **579 verts** |
| **Tests automatisés cumulés** | **1736 verts**, 0 régression cumulée depuis Lot 1 |
| Tests e2e backend (SuperTest + testcontainers Postgres + Redis) | 31+ (skipped en PR, lancés sur push main) |
| Tests Playwright frontend | 9 (local, CI reportée Lot 7+) |
| Codes audit `TypeAction` recensés | ≥ 40 (cf. `src/audit/entities/audit-log.entity.ts`) |
| Branch protection sur les 2 mains | ✅ ESLint + tsc strict + build + tests Required |

---

## 2. Fonctionnalités MVP livrées

### 2.1 Vue par lot

| Lot | Périmètre | Livré |
|-----|-----------|-------|
| **Lot 1** | Socle transverse — JWT + refresh rotation, RBAC global+périmétré, `audit_log` 10 ans BCEAO, Swagger `/api/docs`, healthcheck `/api/v1/health`, CORS strict, frontend (Login/Dashboard/Profile/Users/AuditLogs) | ✅ |
| **Lot 2** | Référentiels SCD2 — 8 dimensions seedées (temps, devise, structure, CR, compte PCB UMOA Révisé, ligne_metier, produit, segment) | ✅ |
| **Lot 2.5** | CRUD UI 6 dimensions métier (Structure, Segment, Produit, Ligne métier, Compte avec import CSV, CR) + factorisation `<RefSecondaireSelect>` + `useScd2EditDiff` | ✅ |
| **Lot 2.5-bis** | 13 référentiels secondaires paramétrables `ref_*` + UI `/configuration` unifiée + hook `useRefSecondaireOptions` | ✅ |
| **Lot 3** | Élaboration budgétaire — `fait_budget` mode dual MONTANT/ENCOURS_TIE, versions, scénarios (auto-création MEDIAN), workflow 4 statuts (Brouillon/Soumis/Validé/Publié), grille saisie custom HTML, `mv_indicateurs_budget` (PNB/MNI/Coef), import bulk Excel/CSV avec rollback > 10 % erreurs | ✅ |
| **Lot Administration** | CRUD users, 6 rôles existants, garde-fous (auto-désactivation interdite, ≥ 1 rôle obligatoire, mdp ≥ 12 chars, mdp en clair jamais persisté) | ✅ |
| **Lot 4** | Multi-périmètres (`user_perimetres` flexibles STRUCTURE/CR/CR_SET) + délégations temporaires avec **anti-chaînage strict BCEAO D2** + notifications email (8 templates Handlebars, dry-run, opt-out user, retry sync) | ✅ |
| **Lot 5** | Module Exécution — `fait_realise` workflow 2 statuts IMPORTE→VALIDE, tableau de bord budget vs réalisé avec 4 niveaux d'alerte + export Excel 3 onglets, reforecast trimestriel avec 3 méthodes (MOYENNE_TRIMESTRE / BUDGET_INITIAL / MANUELLE) et écrasement OBSOLETE en cascade | ✅ |
| **Lot 6.1** | CI/CD GitHub Actions (setup / lint / typecheck strict / build / test / audit-codes-coherence) sur les 2 repos | ✅ |
| **Lot 6.2.A** | e2e backend SuperTest (29 tests, Postgres 18 testcontainer, skipped en PR / lancé sur push main) | ✅ |
| **Lot 6.2.B** | 9 smoke tests Playwright frontend Chromium (local, CI reportée — cf. §7.3) | ✅ |
| **Lot 6.3** | Queue BullMQ + Redis 7 pour emails async, retries exponentiels 2s/4s/8s, endpoint admin queue stats, healthcheck `degraded` si Redis down (app reste utilisable) | ✅ |
| **Lot 6.4** | Sécurisation mot de passe — policy ≥ 12 + 1maj + 1min + 1chiffre + 1spécial, expiration 90j, `PasswordExpiredGuard` global, rate limiting login 2 fenêtres (IP 5/60s + email 5/15min), reset admin async via queue (mdp jamais persisté), force-changement-mdp pour cas compromission, `ForceChangePasswordPage` | ✅ |
| **Lot 6.5** | Notifications résiduelles — forgot password self-service anti-énumération avec tokens SHA-256 + rate limit forgot 3/15min/IP + cleanup cron `0 3 * * *`, rappel J-3 délégation via cron `0 6 * * *` avec idempotence + respect opt-out | ✅ |
| **Lot 6.6** | Nettoyage codebase — ESLint 0 problems + tsc strict 0 erreurs sur les 2 repos + branch protection activée (Required checks bloquants) | ✅ |
| **Lot 6.7** | UX résiduel — `BandeauMdpExpire` J-7 (alerte préventive non-bloquante), tooltips délégation Z1 (4 permissions) + Z2 (4 rôles métier), découvrabilité édition reforecast inline (bouton renommé + bandeau contexte) | ✅ |
| **Lot 6.8** | Recette finale (`RECETTE-MVP.md` 15 scénarios R1-R15) + ce document release + tag `v1.0.0-mvp` | ✅ |

### 2.2 Modules opérationnels au tag v1.0.0-mvp

| Module | Capacités | Doc détail |
|--------|-----------|-----------|
| **Élaboration budgétaire** | Saisie grille mensuelle, versions/scénarios avec auto-MEDIAN, workflow Brouillon→Soumis→Validé→Publié, indicateurs consolidés PNB/MNI/Coef, import bulk Excel/CSV avec rapport KO | [`docs/lot-3*/`](.) |
| **Multi-périmètres + délégations + notifications** | Affectations flexibles (STRUCTURE/CR/CR_SET), délégations temporaires anti-chaînage strict, 8 templates email événementiels, cron expiration `0 2 * * *` + cron rappel J-3 `0 6 * * *` | [`docs/lot-4/README.md`](lot-4/README.md) |
| **Administration** | CRUD users, attribution/retrait rôles, reset password admin async, force déconnexion, historique connexion | [`docs/lot-administration.md`](lot-administration.md) |
| **Exécution** | Saisie/import réalisé, tableau de bord budget vs réalisé (KPI + export Excel), reforecast trimestriel (3 méthodes d'extrapolation, écrasement OBSOLETE) | [`docs/lot-5/README.md`](lot-5/README.md) |
| **Sécurité & Industrialisation** | CI/CD bloquante, e2e backend testcontainers, smoke Playwright, BullMQ + Redis, policy mdp + expiration + rate limit, forgot password self-service | [`docs/lot-6/`](lot-6/) |

### 2.3 Référentiels seedés

**8 dimensions structurantes** (cf. README backend §9 et
`docs/modele-donnees.md`) :

| Dimension | Volumétrie seed BSIC | Pattern |
|-----------|---------------------|---------|
| `dim_temps` | ~3 653 lignes (10 ans glissants + fériés UEMOA) | Pas SCD2 |
| `dim_devise` | 7 devises (XOF pivot + 6 convertibles BCEAO) | Pas SCD2 |
| `dim_structure` | 9 structures multi-pays UEMOA | SCD2 hiérarchique |
| `dim_centre_responsabilite` | 6 CR seed + import CSV | SCD2 + FK SCD2 stratégie A |
| `dim_compte` | 104 comptes PCB UMOA Révisé pédagogique + import CSV opérationnel | SCD2 hiérarchique auto-référencée |
| `dim_ligne_metier` | 12 lignes (retail/corporate/treasury/support) | SCD2 hiérarchique auto-référencée |
| `dim_produit` | 26 produits (crédits/dépôts/services/marchés) + sentinelle `PRODUIT_TRANSVERSE` | SCD2 hiérarchique auto-référencée |
| `dim_segment` | 6 segments (catégories UEMOA) | SCD2 plat |

**13 référentiels secondaires `ref_*`** paramétrables via
`/configuration` (types structure, pays UEMOA, statuts version, sens
compte, classes compte, etc.) — cf. `docs/referentiels-secondaires.md`.

**8 personas seedés** — cf. [§5 Comptes seed BSIC](#5-comptes-seed-bsic).

### 2.4 Modules différés (post-MVP)

Trois modules sont volontairement exclus du MVP — cf.
`docs/roadmap-mvp.md` §Modules différés :

| Module | Nom | Release cible |
|--------|-----|---------------|
| **G** | Capital planning (RWA, CET1, ratio de solvabilité projetés) | V2 |
| **J** | Scénarios / Stress tests (chocs macro + moteur simulation) | V2 |
| **K** | Allocation analytique (clés d'allocation, refacturation interne) | V3 |

---

## 3. Stack technique

### 3.1 Vue d'ensemble

| Couche | Technologie | Version | Source |
|--------|-------------|---------|--------|
| **Backend runtime** | Node.js | ≥ 22 LTS (recommandé 24) | `package.json` `engines` implicite, CI `setup-node@v4 node-version:22` |
| **Backend framework** | NestJS | 11 | `package.json` `@nestjs/core ^11.0.1` |
| **Backend ORM** | TypeORM | 0.3.28 | `package.json` `typeorm ^0.3.28` |
| **Backend lang** | TypeScript | 5.7 strict | `package.json` `typescript ^5.7.3` |
| **Queue** | BullMQ + ioredis | 5.76 / 5.10 | `package.json` `bullmq ^5.76.6`, `ioredis ^5.10.1` |
| **Auth** | JWT + bcrypt | passport-jwt 4 / bcrypt 6 | `passport-jwt ^4.0.1`, `bcrypt ^6.0.0` |
| **Validation** | class-validator + class-transformer + Zod | 0.15 / 0.5 / 4.3 | `package.json` |
| **Excel/CSV** | ExcelJS + csv-parse | 4.4 / 6.2 | `package.json` |
| **SMTP** | Nodemailer + Handlebars | 8.0 / 4.7 | `package.json` |
| **Schedule** | `@nestjs/schedule` cron | 6.1 | `package.json` |
| **Frontend runtime** | Vite | 8 | `package.json` `vite ^8.0.10` |
| **Frontend framework** | React | 19.2 | `package.json` `react ^19.2.5` |
| **Frontend router** | React Router | 7 | `package.json` `react-router-dom ^7.14.2` |
| **Frontend store** | Zustand (persist) | 5.0 | `package.json` |
| **Frontend UI primitives** | shadcn-style + Radix UI + Tailwind 4 | — | `@radix-ui/*`, `tailwindcss ^4.2.4` |
| **Frontend table** | TanStack Table | 8.21 | `package.json` |
| **Frontend forms** | React Hook Form + Zod resolvers | 7.74 / 5.2 | `package.json` |
| **Frontend tests** | Vitest + Testing Library | 4.1 / 16.3 | `package.json` |
| **Frontend e2e** | Playwright Chromium | 1.59 | `package.json` |
| **Base de données** | PostgreSQL | ≥ 14 (cible 18) | README backend §3, CI testcontainers Postgres 18 |
| **Cache / Queue** | Redis | 7-alpine | `docker-compose.dev.yml` |
| **Logger** | Pino + pino-http + nestjs-pino | 10 / 11 / 4.6 | `package.json` |
| **OpenAPI** | `@nestjs/swagger` + swagger-ui-express | 11.4 / 5.0 | `package.json` |

### 3.2 Architecture en 5 couches

Détaillée dans [`docs/architecture.md`](architecture.md) §2 :

1. **Présentation** — pages React + composants UI shadcn-style
2. **API & Sécurité** — Controllers NestJS + Guards (JWT, Permissions,
   PasswordExpired, RateLimit) + Interceptors (Audit) + ValidationPipe
3. **Application métier** — Services NestJS + EventEmitter2 listeners
4. **Domaine & Données** — entités TypeORM + migrations versionnées
   (SCD2 pattern pour dimensions structurantes)
5. **Plateforme & Observabilité** — Pino logs, `audit_log` 10 ans, Redis
   queue, health endpoint, Swagger

### 3.3 Principes structurants

(Cf. `docs/architecture.md` §1)

- **API-first** : un seul `/api/v1`, exposé via Swagger (`/api/docs`)
- **Stateless** : aucune session HTTP serveur, JWT bearer + refresh
  rotation
- **Séparation stricte couches** : aucune dépendance remontante
- **Audit applicatif ≠ logs techniques** : `audit_log` Postgres 10 ans
  BCEAO vs Pino observabilité
- **Migrations versionnées** : `synchronize: false`, toute évolution
  schema = migration TypeORM réversible (`up()` + `down()`)

---

## 4. Procédure de déploiement

> ⚠️ **Cette procédure documente le déploiement local + une option de
> référence (Docker Compose) pour un environnement BSIC pilote. Les
> choix d'infrastructure définitifs — orchestrateur cible (Docker Swarm
> / Kubernetes / bare-metal), reverse proxy (Nginx / Traefik / AWS ALB),
> hébergement Postgres et Redis (managés cloud / self-hosted), CDN
> frontend (Nginx statique / Vercel / CloudFront), backup et monitoring —
> sont à valider par l'équipe ops BSIC sur la base des contraintes
> infrastructure et conformité internes.**

### 4.1 Prérequis infrastructure

| Composant | Version | Notes |
|-----------|---------|-------|
| **PostgreSQL** | ≥ 14 (cible **18**) | Plancher 14 pour JSONB + window functions. CI testée Postgres 18 testcontainers. Volume `~50 GB` recommandé pilote BSIC (10 ans audit + grille saisie pluriannuelle). |
| **Redis** | ≥ 7 (cible 7-alpine) | Persistance AOF activée (`--appendonly yes`). Queue BullMQ `emails` (Lot 6.3). |
| **Node.js** | ≥ 22 LTS (recommandé 24) | CI testée Node 22. |
| **SMTP** | Institutionnel BSIC | STARTTLS recommandé en prod. Mailhog `localhost:1025` en dev/test. |
| **Disque backend** | ≥ 2 GB libres | `node_modules` ~600 MB + logs Pino rotatifs. |
| **Disque frontend (build)** | ~50 MB | Bundle Vite production statique. |
| **CPU/RAM** | min 2 vCPU / 4 GB | Backend NestJS + worker BullMQ in-process (Lot 6.3 — isolation prévue Lot 7+). |

### 4.2 Variables d'environnement obligatoires

Le fichier référence est [`budjet-backend/.env.example`](../.env.example).
À copier vers `.env` (non versionné, jamais commité).

#### 4.2.1 Variables critiques en production

| Variable | Exemple | Notes sécurité |
|----------|---------|---------------|
| `NODE_ENV` | `production` | Active `assertProductionPasswordPolicy` côté seed (interdit le fallback mdp public). |
| `PORT` | `3001` | Port d'écoute NestJS. |
| `CORS_ORIGIN` | `https://miznas.bsic.local` | URL exacte du frontend prod. Aucune autre origine acceptée. |
| `LOG_LEVEL` | `info` | `debug` en troubleshooting, `silent` interdit en prod. |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | — | Compte Postgres dédié recommandé (pas `postgres` superuser). |
| `JWT_SECRET` | hex 64 octets aléatoire | **OBLIGATOIRE**. Génération : `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`. Rotation tous les 6-12 mois recommandée. |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | Refresh rotation à chaque utilisation (cf. Lot 1). |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Réutilisation déclenche révocation forcée tous refresh. |
| `BCRYPT_ROUNDS` | `12` | Lot Administration. Coût 12 = ~250 ms par hash. |
| `SEED_ADMIN_PASSWORD` | mdp policy-conforme ≥ 12 + complexité | **OBLIGATOIRE en prod** sinon le seed jette une erreur (`assertProductionPasswordPolicy` dans `src/seeds/auth-seed.ts`). |
| `SEED_LECTEUR_PASSWORD` | idem | Optionnel — désactiver / supprimer le compte lecteur en prod si non utilisé. |
| `SMTP_HOST` / `SMTP_PORT` | `smtp.bsic.local` / `587` | STARTTLS recommandé. |
| `SMTP_USER` / `SMTP_PASS` | — | Si auth SMTP requise. |
| `SMTP_FROM` | `miznas@bsic.local` | Boîte expéditrice institutionnelle. |
| `EMAIL_DRY_RUN` | `false` | Doit être `false` en prod (sinon aucun email envoyé). |
| `APP_BASE_URL` | `https://miznas.bsic.local` | URL absolue dans les liens email (forgot password, délégations). |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | — | Fallback `localhost:6379` sans password en dev. En prod : Redis managé ou self-hosted avec password obligatoire. |
| `LOGIN_RATE_LIMIT_DISABLED` | `false` | **NE JAMAIS activer en prod**. Désactive le rate limiting login Lot 6.4.B. |
| `MDP_DUREE_VALIDITE_JOURS` | `90` | Lot 6.4.A. Expiration mdp utilisateurs (en jours). |

#### 4.2.2 Variable frontend

| Variable | Exemple | Notes |
|----------|---------|-------|
| `VITE_API_BASE_URL` | `https://miznas.bsic.local/api/v1` | URL absolue du backend, injectée à la build. Référence : `budjet-frontend/.env.example`. |

### 4.3 Étapes installation backend (Docker Compose recommandé)

**Référence** : option Docker Compose pour démarrage rapide. Les ops
BSIC peuvent adapter à leur orchestrateur cible (cf. §4.5).

#### 4.3.1 Cloner et préparer

```bash
git clone https://github.com/netmophus/budget-backend.git budjet-backend
cd budjet-backend
git checkout v1.0.0-mvp
cp .env.example .env
# Éditer .env : remplir les variables §4.2.1, JAMAIS de fallback en prod
```

#### 4.3.2 Démarrer Postgres + Redis

Pour dev/pilote uniquement (utiliser des instances managées en prod) :

```bash
docker compose -f docker-compose.dev.yml up -d
# Lance Redis 7-alpine (container 'miznas-redis-dev', port 6379)
# Postgres : à provisionner séparément (pas dans docker-compose.dev.yml)
```

Provisionner Postgres séparément :

```bash
docker run -d --name miznas-postgres-pilot \
  -e POSTGRES_PASSWORD="$DB_PASSWORD" \
  -e POSTGRES_DB="$DB_NAME" \
  -p 5432:5432 \
  postgres:18-alpine
```

#### 4.3.3 Installer les dépendances

```bash
npm ci
```

(`npm ci` plutôt que `npm install` en CI/prod : respecte exactement
`package-lock.json`.)

#### 4.3.4 Appliquer les migrations

```bash
npm run migration:run
# Sous le capot : typeorm-ts-node-commonjs -d src/data-source.ts migration:run
# 61 migrations à appliquer (de 1777800000000-CreateDimTemps à
# 1779200000220-AjouterCodesAuditLot65)
```

Vérification :

```bash
npm run migration:show
# Doit afficher [X] devant chaque migration appliquée
```

#### 4.3.5 Exécuter les seeds dans l'ordre

⚠️ **L'ordre est strict** (dépendances FK SCD2) :

```bash
# 1. Authentification (admin + lecteur globaux + rôles ADMIN/LECTEUR)
npm run seed:auth

# 2. Calendrier (dim_temps, ~3653 lignes, fériés UEMOA)
npm run seed:temps

# 3. Devises (XOF + 6 convertibles BCEAO)
npm run seed:devises

# 4. Structures (9 structures multi-pays UEMOA, SCD2 hiérarchique)
npm run seed:structures

# 5. Centres de responsabilité (FK vers dim_structure)
npm run seed:cr

# 6. Comptes PCB UMOA Révisé (104 comptes, hiérarchie 4 niveaux)
npm run seed:comptes

# 7. Lignes métier
npm run seed:lignes-metier

# 8. Produits (sentinelle PRODUIT_TRANSVERSE incluse)
npm run seed:produits

# 9. Segments clientèle UEMOA
npm run seed:segments

# 10. Versions budgétaires de cadrage
npm run seed:versions

# 11. Scénarios (auto-création MEDIAN via hook Lot 3.2)
npm run seed:scenarios

# 12. Taux de change BCEAO historiques + prévisionnels
npm run seed:taux-change
```

> **Note BSIC** : les 6 personas métier (Fatima, Amadou, Ibrahim, Aïcha,
> Moussa, Salif) sont seedés par la **migration**
> `1779200000090-AjouterPersonasBSIC.ts` lors du `migration:run`, pas
> par un script seed. Ils sont disponibles directement après §4.3.4.

#### 4.3.6 Démarrer le backend en production

```bash
# Build
npm run build
# Produit dist/main.js

# Démarrer
npm run start:prod
# Sous le capot : node dist/main
```

En production, utiliser un gestionnaire de process (PM2, systemd,
Docker) pour le redémarrage automatique + capture stdout/stderr.

### 4.4 Étapes installation frontend

#### 4.4.1 Cloner et préparer

```bash
git clone https://github.com/netmophus/budget-frontend.git budjet-frontend
cd budjet-frontend
git checkout v1.0.0-mvp
cp .env.example .env
# Éditer .env : VITE_API_BASE_URL=https://miznas.bsic.local/api/v1
```

#### 4.4.2 Installer et builder

```bash
npm ci
npm run build
# Sous le capot : tsc -b && vite build
# Produit dist/ (bundle statique)
```

#### 4.4.3 Servir le bundle statique

**Option recommandée** : Nginx servant `dist/` avec fallback SPA :

```nginx
server {
    listen 443 ssl http2;
    server_name miznas.bsic.local;

    root /var/www/miznas/dist;
    index index.html;

    # Fallback SPA pour React Router
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API vers backend NestJS
    location /api/ {
        proxy_pass http://backend.miznas.internal:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    ssl_certificate     /etc/ssl/miznas.crt;
    ssl_certificate_key /etc/ssl/miznas.key;
}
```

Alternative : `npm run preview` (Vite preview, dev/staging uniquement,
**pas pour la prod**).

### 4.5 Options de déploiement prod

**Option recommandée (référence)** : Docker Compose orchestrant backend
+ Postgres + Redis sur 1 hôte, frontend statique servi via Nginx
séparé. Cohérent avec le `docker-compose.dev.yml` existant Lot 6.3.

Autres options possibles (à valider avec ops BSIC) :

- **Kubernetes** : 1 Deployment backend (+ HPA), Postgres managé cloud,
  Redis managé, frontend en `ConfigMap` ou bucket S3 + CDN.
- **Bare-metal Node + PM2 + systemd** : backend NestJS sous PM2, Nginx
  reverse proxy + statique frontend, Postgres + Redis sur instances
  dédiées.
- **Hébergement statique frontend** : Vercel / Netlify / S3 + CloudFront
  pour le bundle Vite, backend séparé sur VM/conteneur.

Le choix dépend des contraintes BSIC (réglementaires données UEMOA, SLA
internes, équipe ops disponible). Le code applicatif est compatible
avec les 4 options.

### 4.6 Vérifications post-déploiement

1. **Healthcheck nominal** :
   ```bash
   curl https://miznas.bsic.local/api/v1/health
   # Attendu : {"status":"ok","redis":{"status":"up"},"db":{"status":"up"}}
   ```

2. **Login admin** (vérifie auth + JWT + DB) :
   ```bash
   curl -X POST https://miznas.bsic.local/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@miznas.local","password":"<SEED_ADMIN_PASSWORD>"}'
   # Attendu : 200 + JSON { accessToken, refreshToken, user, mdpExpire, doitChangerMdp, mdpExpireProchainement }
   ```

3. **Audit_log peuplé** :
   ```sql
   SELECT type_action, COUNT(*) FROM audit_log
    WHERE date_action > NOW() - INTERVAL '5 minutes'
    GROUP BY type_action;
   -- Attendu : au moins 1 ligne LOGIN après l'étape 2
   ```

4. **Personas BSIC seedés** :
   ```sql
   SELECT email, prenom, nom, est_actif FROM "user"
    WHERE email LIKE '%@miznas.local' ORDER BY email;
   -- Attendu : 8 lignes (admin, lecteur, 6 personas BSIC actifs)
   ```

5. **Migrations toutes appliquées** :
   ```bash
   npm run migration:show
   # Attendu : 61 lignes toutes préfixées [X]
   ```

6. **Queue Redis up** (admin token requis) :
   ```bash
   curl -H "Authorization: Bearer <TOKEN_ADMIN>" \
     https://miznas.bsic.local/api/v1/admin/email-log/queue/stats
   # Attendu : { "waiting": N, "active": N, "completed": N, "failed": N, "delayed": N }
   ```

7. **Frontend chargé** : naviguer vers `https://miznas.bsic.local/login`
   → page LoginPage rendue, console navigateur sans erreur, requêtes
   `/api/v1/*` répondent 200.

8. **Branch protection vérifiée** sur GitHub (cf. §8.2) — Required
   checks ESLint + tsc + build + tests actifs sur les 2 mains.

### 4.7 Procédure rollback

**Palier (a) — Rollback code uniquement** (cas le plus fréquent : bug
applicatif non critique post-déploiement) :

```bash
# Backend
cd budjet-backend
git fetch --tags
git checkout v0.5.0-mvp  # ou tag précédent stable
npm ci
npm run build
# Redémarrer le process backend (PM2 / systemd / docker restart)

# Frontend idem
cd ../budjet-frontend
git checkout v0.5.0-mvp
npm ci
npm run build
# Re-déployer le bundle dist/ via Nginx / CDN
```

Le code revient à l'état antérieur. **Les migrations restent
appliquées** (le code v0.5.0-mvp tolère le schéma actuel — sauf cas
breaking, à vérifier).

**Palier (b) — Rollback migrations BDD** (cas critique : migration
v1.0.0-mvp introduit un bug schéma) :

```bash
cd budjet-backend
# Identifier les N migrations Lot 6.5+ à revert (les plus récentes
# d'abord, ordre décroissant timestamp)
npm run migration:revert
# Répéter pour chaque migration à annuler
```

⚠️ **Test obligatoire en pré-prod avant** : la méthode `down()` de
chaque migration doit être validée. Toute migration Lot 6.x doit
fournir un `down()` réversible (convention projet).

**Palier (c) — Rollback complet (catastrophe)** : restauration backup
Postgres pré-déploiement + checkout code tag précédent + restart. La
procédure exacte dépend du provisionnement Postgres BSIC (snapshot
managé / `pg_dump` self-hosted). À documenter par l'équipe ops BSIC
avant la mise en production.

> **Pré-déploiement v1.0.0-mvp** : prendre un snapshot Postgres + tag
> git précédent (`v0.5.0-mvp`) pour disposer d'un point de retour
> propre.

---

## 5. Comptes seed BSIC

8 comptes seedés par les migrations + script `seed:auth` après
exécution de §4.3 :

### 5.1 Tableau exhaustif

| Email | Prénom | Rôle | Mot de passe seed | Périmètre métier |
|-------|--------|------|-------------------|------------------|
| `admin@miznas.local` | Admin MIZNAS | **ADMIN** (global) | `$SEED_ADMIN_PASSWORD` (fallback dev `ChangeMe!2026`) | Toutes permissions, tous périmètres |
| `lecteur@miznas.local` | Lecteur Test | **LECTEUR** (global) | `$SEED_LECTEUR_PASSWORD` (fallback dev `Lecteur!2026`) | `USER.LIRE`, `ROLE.LIRE`, `AUDIT.LIRE` |
| `adj.retail@miznas.local` | Fatima | **SAISISSEUR** | `MiznasTest!2026` | Retail (`STRUCTURE_RETAIL`), permissions BUDGET.LIRE/SAISIR/SOUMETTRE, REALISE.LIRE/SAISIR/IMPORTER |
| `dir.retail@miznas.local` | Amadou | **VALIDATEUR** | `MiznasTest!2026` | Retail, permissions BUDGET.LIRE/SAISIR/SOUMETTRE/VALIDER/REJETER, REALISE.LIRE/VALIDER |
| `dir.corporate@miznas.local` | Ibrahim | **VALIDATEUR** | `MiznasTest!2026` | Corporate, mêmes permissions que Amadou sur périmètre corporate |
| `controleur.gestion@miznas.local` | Aïcha | **VALIDATEUR** | `MiznasTest!2026` | Transverse (vue cross-périmètre), `BUDGET.REFORECAST_LANCER` |
| `auditeur@miznas.local` | Moussa | **AUDITEUR** | `MiznasTest!2026` | Lecture transverse (aucun périmètre — accès cross-module en lecture seule) |
| `dga.exploitation@miznas.local` | Salif | **PUBLICATEUR** | `MiznasTest!2026` | Manager senior, `BUDGET.PUBLIER` |

### 5.2 Permissions par rôle (6 rôles existants)

Référence : `src/migrations/1779200000110-CreerRolesMetierEtBasculePersonasBSIC.ts`
+ `docs/lot-administration.md` §1 (D1).

- **ADMIN** : toutes permissions (cumul de toutes les autres + USER.GERER + DELEGATION.GERER + CONFIGURATION.GERER).
- **LECTEUR** : `USER.LIRE`, `ROLE.LIRE`, `AUDIT.LIRE`, `REFERENTIEL.LIRE`, `CONFIGURATION.LIRE`.
- **SAISISSEUR** : `BUDGET.LIRE/SAISIR/SOUMETTRE`, `REALISE.LIRE/SAISIR/IMPORTER`, `REFERENTIEL.LIRE`, `CONFIGURATION.LIRE`, `USER.LIRE`, `ROLE.LIRE`, `DELEGATION.LIRE`.
- **VALIDATEUR** : `BUDGET.LIRE/SAISIR/SOUMETTRE/VALIDER/REJETER/REFORECAST_LANCER`, `REALISE.LIRE/VALIDER`, `REFERENTIEL.LIRE`, `CONFIGURATION.LIRE`, `USER.LIRE`, `ROLE.LIRE`, `DELEGATION.LIRE`.
- **PUBLICATEUR** : `BUDGET.LIRE/PUBLIER`, `REALISE.LIRE`, `REFERENTIEL.LIRE`, `CONFIGURATION.LIRE`, `USER.LIRE`, `ROLE.LIRE`, `DELEGATION.LIRE`.
- **AUDITEUR** : `AUDIT.LIRE`, `BUDGET.LIRE`, `CONFIGURATION.LIRE`, `DELEGATION.LIRE`, `REALISE.LIRE`, `REFERENTIEL.LIRE`, `ROLE.LIRE`, `USER.LIRE`.

**Cumul de rôles autorisé** (décision D2 Lot Administration) : un user
peut avoir N rôles simultanés, ses permissions effectives sont l'union.

### 5.3 Sécurité au 1er déploiement (CHECKLIST OBLIGATOIRE BSIC)

- [ ] **Changer `SEED_ADMIN_PASSWORD`** dans `.env` avant le 1er
  `seed:auth` (ne JAMAIS utiliser le fallback `ChangeMe!2026` en prod).
- [ ] **Désactiver ou changer le mot de passe** des **6 personas BSIC**
  (`MiznasTest!2026` est public dans le code source — comptes de smoke
  test, pas de comptes prod). Procédure :
  ```sql
  -- Option A : désactiver les personas BSIC en prod
  UPDATE "user" SET est_actif=false
   WHERE email IN ('adj.retail@miznas.local','dir.retail@miznas.local',
                   'dir.corporate@miznas.local',
                   'controleur.gestion@miznas.local',
                   'auditeur@miznas.local',
                   'dga.exploitation@miznas.local');
  ```
  ```bash
  # Option B : forcer un changement de mot de passe via l'admin UI
  # /admin/users/:id → "Forcer changement de mot de passe" (Lot 6.4.C.3)
  ```
- [ ] **Vérifier `NODE_ENV=production`** pour activer
  `assertProductionPasswordPolicy` (refuse les fallbacks publics).
- [ ] **Activer la rotation** `JWT_SECRET` tous les 6-12 mois (procédure
  ops à documenter — déconnecte tous les users actifs).
- [ ] **Vérifier `LOGIN_RATE_LIMIT_DISABLED=false`** (rate limit actif
  en prod — cf. `.env.example` ligne 47 « NE JAMAIS activer en prod »).

---

## 6. Endpoints principaux

### 6.1 Documentation Swagger autoritative

L'API REST est exposée sous le préfixe `/api/v1` (cf.
`src/main.ts:11`). La **documentation exhaustive** est générée
automatiquement et accessible en environnement non-production :

```
http://localhost:3001/api/docs       (dev/staging)
```

> En `NODE_ENV=production`, Swagger UI est **désactivé** par défaut
> (`src/main.ts:29-31`). Pour l'exposer en prod : retirer la condition
> ou utiliser un proxy authentifié.

Swagger reste la source de vérité exhaustive pour les schémas DTO, les
permissions requises (`@RequirePermissions`) et les codes de réponse.

### 6.2 Endpoints clés (référencés dans la recette MVP)

| Méthode | Endpoint | Permission | Référence |
|---------|----------|------------|-----------|
| GET | `/api/v1/health` | publique | Healthcheck DB + Redis (Lot 6.3) |
| POST | `/api/v1/auth/login` | publique | Émet JWT + refresh, rate-limité (Lot 6.4.B) |
| POST | `/api/v1/auth/refresh` | publique | Refresh token rotation |
| POST | `/api/v1/auth/logout` | auth | Révoque les refresh tokens |
| GET | `/api/v1/auth/me` | auth | User courant + permissions effectives |
| POST | `/api/v1/auth/forgot-password` | publique (rate-limité IP) | Lot 6.5.A — anti-énumération |
| POST | `/api/v1/auth/reset-password` | publique (token) | Lot 6.5.A |
| PATCH | `/api/v1/me/password` | auth | Lot 6.4.A — changement mdp policy-conforme |
| POST | `/api/v1/admin/users` | USER.GERER | Création user |
| POST | `/api/v1/admin/users/:id/reset-password` | USER.GERER | Lot 6.4.C.1 — async via queue, mdp jamais persisté |
| POST | `/api/v1/admin/users/:id/forcer-changement-mdp` | USER.GERER | Lot 6.4.C.3 — pose flag sans toucher au hash |
| GET | `/api/v1/admin/email-log/queue/stats` | USER.GERER | Lot 6.3 — monitoring BullMQ |
| POST | `/api/v1/admin/affectations` | USER.GERER | Lot 4.1 — affectations multi-périmètres |
| POST | `/api/v1/delegations` | DELEGATION.LIRE | Lot 4.2 — création délégation temporaire (anti-chaînage strict) |
| POST | `/api/v1/budget/grille` | BUDGET.LIRE | Lot 3.4 — récupère la grille de saisie |
| POST | `/api/v1/budget/import` | BUDGET.SAISIR | Lot 3.7 — import bulk Excel/CSV |
| POST | `/api/v1/budget/versions/:id/soumettre` | BUDGET.SOUMETTRE | Lot 3.5 — workflow |
| POST | `/api/v1/budget/versions/:id/valider` | BUDGET.VALIDER | Lot 3.5 |
| POST | `/api/v1/budget/versions/:id/publier` | BUDGET.PUBLIER | Lot 3.5 |
| POST | `/api/v1/realise/saisie` | REALISE.SAISIR | Lot 5.1 |
| POST | `/api/v1/realise/import` | REALISE.IMPORTER | Lot 5.1.B |
| POST | `/api/v1/realise/valider` | REALISE.VALIDER | Lot 5.1 — validation en lot |
| GET | `/api/v1/tableau-de-bord/budget-vs-realise` | BUDGET.LIRE ∧ REALISE.LIRE | Lot 5.2 — RBAC double permission |
| POST | `/api/v1/reforecast/lancer` | BUDGET.REFORECAST_LANCER | Lot 5.3 — 3 méthodes d'extrapolation |

### 6.3 Authentification

- **Schéma** : JWT Bearer dans header `Authorization: Bearer <accessToken>`.
- **Access token** : durée 15 min (configurable `JWT_ACCESS_EXPIRES_IN`).
- **Refresh token** : durée 7 jours (configurable `JWT_REFRESH_EXPIRES_IN`),
  rotation à chaque utilisation, réutilisation = révocation forcée de
  tous les refresh actifs (cf. `audit_log type_action='REFRESH_FORCED_REVOCATION'`).
- **CORS** : `CORS_ORIGIN` strict (1 seule origine), méthodes
  `GET/POST/PUT/PATCH/DELETE/OPTIONS`, credentials autorisés (cf.
  `src/main.ts:13-18`).

### 6.4 Permissions et RBAC

- Décorateur `@RequirePermissions({ all: [...] })` ou `{ any: [...] }`
  sur chaque endpoint sensible.
- Permission **double** combinable (ex : `/tableau-de-bord/budget-vs-realise`
  exige `BUDGET.LIRE` ET `REALISE.LIRE` simultanément, Lot 5.2).
- Filtrage périmètre appliqué côté service (`PerimetreService`) : un
  user voit / écrit uniquement sur les CR de ses affectations
  `user_perimetres` actives.
- Cumul de rôles : permissions effectives = UNION (cf.
  `PermissionsService.getEffectivePermissions`).
- Détail complet : `docs/lot-administration.md` + `docs/audit.md`.

---

## 7. Limitations connues et dette tracée Lot 7+

### 7.1 Dette backend

| Sujet | Description | Sévérité | Effort estimé |
|-------|-------------|----------|---------------|
| **Worker BullMQ in-process** | Le `@Processor('emails')` tourne dans le process NestJS principal (Lot 6.3). À isoler en process dédié pour scale horizontal. | Moyenne (scale) | 1-2j |
| **Storage rate limit in-memory** | `LoginRateLimiterService` stocke les compteurs en RAM (Lot 6.4.B). OK V1 mono-instance, à migrer vers Redis en V2 multi-instances. | Moyenne (scale) | 0.5-1j |
| **Optimistic locking absent** | Ni `fait_budget` ni `fait_realise` n'ont de version/timestamp pour gérer la concurrence. Dernier `save()` écrase. OK pour pilote BSIC, à revisiter sur retours utilisateurs. | Faible (MVP pilote) | 1-2j |
| **Seeds prod en raw SQL** | Les 12 scripts `seed:*` utilisent du SQL brut. Approche fixture-based typée à évaluer pour cohérence avec migrations. | Faible | 1-2j |
| **`SEED_LECTEUR_PASSWORD` absent de `.env.example`** | La var est lue par `auth-seed.ts:59` avec fallback `Lecteur!2026` mais non documentée dans `.env.example` (incohérence détectée Lot 6.8). | Mineure (doc) | 5 min |
| **`docs/architecture.md` §1.2 obsolète** | Mentionne « pas de Redis » alors que Lot 6.3 a introduit Redis pour BullMQ (queue, pas session — la sémantique stateless reste valable mais à reformuler). | Mineure (doc) | 15 min |
| **108 `no-unnecessary-type-assertion` silencés** | Override ESLint scope tests/spec/migrations/seeds (Lot 6.6). Typage strict possible sans gain métier immédiat. | Mineure | 1j |
| **`noUncheckedIndexedAccess: false`** | Lot 6.6.B retire 28+11 `!` non-null sur array index. Activer cette option strict TS demanderait guards explicites partout. | Mineure | 2-3j |

### 7.2 Dette frontend

| Sujet | Description | Sévérité | Effort estimé |
|-------|-------------|----------|---------------|
| **Pattern 1 hydratation (~30 cas)** | `useEffect(() => setX(props.X), [props])` → migration vers `<Component key={props.id} />` + `useState(() => initFromProps)`. | Faible | 2-3j |
| **Pattern 2 fetch+loading (~35 cas)** | `useEffect(() => { setLoading(true); fetch(...) }, [])` → migration vers Suspense + `use(promise)` ou react-query. | Faible | 3-5j |
| **`JSX.Element` → `React.ReactElement` (59 occurrences)** | Shim global `src/types/jsx.d.ts` à retirer (Lot 6.6). React 19 a déprécié le namespace JSX global. | Faible | 1j |
| **Chunks > 500 kB** | Warning `vite build` non bloquant. Code-splitting + lazy routes à mettre en place. | Faible (perfs) | 0.5-1j |
| **DataTable `@tanstack/react-table v8` non React Compiler compatible** | Disable `react-hooks/incompatible-library` dans `DataTable.tsx` (Lot 6.6). Upgrade v9 ou alternative à évaluer. | Faible | 1-2j |
| **Refresh token en localStorage** | Mentionné dans README frontend §Notes de sécurité comme TODO. Migration vers cookie `httpOnly + Secure` + suppression de la persistance localStorage. | **Moyenne (sécurité)** | 1-2j |
| **README frontend obsolète** | Mentionne uniquement les pages Lot 1 (LoginPage / DashboardPage / Users / AuditLogs). À actualiser avec les pages Lot 2 → 6 livrées. | Mineure (doc) | 30 min |
| **`SaisiePanel` factorisé budget + reforecast** | Extraction `SaisieBudgetairePage` + `useGrilleSaisie` en composant réutilisable depuis `ReforecastDetailPage` (sub-onglet « Saisie »). Permet vraie édition inline reforecast sans duplication. | Faible | 3-4h |
| **Origine REALISE/MANUEL mensongère reforecast** | Bug latent : le badge Origine reste « REALISE » à tort après édition manuelle d'une cellule T1 consolidée. Fix : ajouter `est_edite_manuellement` dans `fait_budget` OU bloquer l'édition des mois consolidés. | Faible (cosmétique) | 1j |
| **Drift `TypeVersion` `VersionsPage`/`VersionFormDrawer`** | Affichages génériques pour les reforecasts (badges/libellés default via fallback). Corrigé partiellement en Lot 6.7.3. | Faible | 0.5j |

### 7.3 CI Playwright non orchestrée

**Statut** : reportée Lot 7+ à l'issue du Lot 6.2.B et confirmée Lot
6.8. Justification : effort 1-2j d'orchestration (testcontainers
Postgres + Redis + backend lancé + seeds + frontend build/preview +
Chromium) pour un ROI faible en MVP (la branch protection Lot 6.6
bloque déjà ESLint + tsc + build + tests + audit-codes sur les 2
mains).

**Pattern préféré à implémenter Lot 7+** :

Un nouveau job `playwright-e2e` dans
`budjet-frontend/.github/workflows/ci.yml` :

```yaml
playwright-e2e:
  name: Playwright e2e
  if: github.event_name == 'push'   # skipped en PR, lancé sur push main
  needs: [setup, build]
  runs-on: ubuntu-latest
  timeout-minutes: 20
  services:
    postgres:
      image: postgres:18-alpine
      env:
        POSTGRES_PASSWORD: ci
        POSTGRES_DB: budget_db
      options: >-
        --health-cmd "pg_isready" --health-interval 5s
      ports: [5432:5432]
    redis:
      image: redis:7-alpine
      options: >-
        --health-cmd "redis-cli ping" --health-interval 5s
      ports: [6379:6379]
  steps:
    - uses: actions/checkout@v4
      with: { path: frontend }
    - uses: actions/checkout@v4
      with: { repository: netmophus/budget-backend, ref: main, path: backend }
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: npm }
    # Démarrer backend
    - run: cd backend && npm ci && npm run migration:run && npm run seed:auth && npm run start:dev &
    - run: npx wait-on http://localhost:3001/api/v1/health
    # Démarrer frontend (preview, plus rapide que dev)
    - run: cd frontend && npm ci && npm run build && npm run preview &
    - run: npx wait-on http://localhost:4173
    # Lancer Playwright
    - run: cd frontend && npx playwright install chromium
    - run: cd frontend && npx playwright test
```

Architecture cible : skipped sur PR (économie de minutes Actions),
lancé uniquement sur push `main` comme le job `test-e2e` backend Lot
6.2.A. ~12-15 min CI estimés.

### 7.4 Modules différés post-MVP

Cf. `docs/roadmap-mvp.md` §Modules différés :

- **Module G — Capital planning** (RWA, CET1, ratio solvabilité
  projetés) — release V2, dépend d'un référentiel risque mature.
- **Module J — Scénarios / Stress tests** (chocs macro + moteur
  simulation) — release V2, dépend stabilité Lots 3-4-5.
- **Module K — Allocation analytique** (clés d'allocation, refacturation
  interne) — release V3, à co-construire avec contrôle de gestion sur
  usage réel MVP.

### 7.5 Bugs latents identifiés (à corriger Lot 7+)

- **Hash mdp prédictible des 6 personas BSIC** : tous les personas
  partagent le même hash bcrypt fixe `$2b$10$Dw2zNbyjcGJPToE9V...` issu
  du mdp public `MiznasTest!2026`. Action ops BSIC obligatoire avant
  prod : désactiver / changer les mdp (cf. §5.3).
- **Cleanup tokens reset password** : cron `0 3 * * *` purge les tokens
  > 30j. Si la machine est éteinte la nuit, le rattrapage
  `OnApplicationBootstrap` traite les retards (cf. Lot 6.5.A). Vérifier
  comportement après ≥ 1 mois d'usage prod.
- **Cleanup audit_log 10 ans** : procédure de purge BCEAO **non
  implémentée** (cf. `docs/architecture.md` note §1.4 « Procédure de
  purge à mettre en place au Lot 6 (industrialisation) »). Dette Lot 7+
  car non bloquante en pilote 1 an.

---

## 8. Procédure de release

### 8.1 Convention de versionnage

SemVer informel par lot (cf. `CHANGELOG.md` backend en-tête) :

- `vMAJOR.MINOR.PATCH-<tag>` où `<tag>` matérialise la phase projet
  (`mvp`, `pilote`, `prod`, etc.).
- **v0.5.0-mvp** : MVP fonctionnel (Lots 1 → 5, tag mai 2026).
- **v1.0.0-mvp** : MVP industrialisé (Lots 1 → 6.7 + recette R1-R15
  documentaire + doc release, ce tag).
- Versions futures : `v1.1.0-mvp` (Lot 7+ premières dettes traitées) /
  `v2.0.0` (modules G+J post-MVP).

### 8.2 Branch protection (vérifier avant tag)

Actives sur les 2 mains depuis Lot 6.6 (cf. mémoire interne projet) —
Required status checks bloquants sur **toute PR vers main** :

**Backend `netmophus/budget-backend`** :
- Install + cache
- ESLint
- tsc strict (--noEmit)
- nest build
- Jest
- Cohérence codes audit / TypeAction

**Frontend `netmophus/budget-frontend`** :
- Install + cache
- ESLint
- tsc -b strict (--noEmit)
- vite build
- Vitest

Aucune PR ne peut être mergée si un de ces checks échoue. Aucun bypass
(`--no-verify`, désactivation Required) tolerée.

### 8.3 Critères pré-tag (CHECKLIST)

Avant de poser le tag `v1.0.0-mvp` sur les 2 mains :

- [ ] **CI verte sur main** des 2 repos (dernier run GitHub Actions
  `success`).
- [ ] **Tests automatisés ≥ baseline** : backend ≥ 1157 Jest verts,
  frontend ≥ 579 Vitest verts (état post Lot 6.7).
- [ ] **ESLint 0 problems** sur les 2 repos.
- [ ] **tsc strict 0 erreurs** sur les 2 repos.
- [ ] **Build prod VERT** : `npm run build` succès sur les 2 repos.
- [ ] **Recette `RECETTE-MVP.md` à jour** (15 scénarios R1-R15
  documentés — cf. Lot 6.8 commit 1).
- [ ] **Ce document `RELEASE-v1.0.0-mvp.md` à jour** (Lot 6.8 commit 2).
- [ ] **CHANGELOG backend** : entrée `[v1.0.0-mvp] — 2026-05-13` ajoutée
  (Lot 6.8 commit 3).
- [ ] **CHANGELOG frontend** : entrée `[v1.0.0-mvp]` ajoutée pointant
  vers ce doc (Lot 6.8 commit 4).
- [ ] **Aucun bug bloquant ouvert** dans le tracker BSIC.

### 8.4 Création du tag

Sur les 2 repos, après merge des PRs Lot 6.8 :

```bash
# Backend
cd budjet-backend
git checkout main
git pull
git tag -a v1.0.0-mvp -m "Release MIZNAS v1.0.0-mvp — MVP industrialisé

Lots 1 → 6.7 livrés. Recette R1-R15 documentaire.
Voir docs/RELEASE-v1.0.0-mvp.md pour le détail."
git push --tags

# Frontend
cd ../budjet-frontend
git checkout main
git pull
git tag -a v1.0.0-mvp -m "Release MIZNAS v1.0.0-mvp — frontend.

Voir budget-backend/docs/RELEASE-v1.0.0-mvp.md pour le détail."
git push --tags
```

### 8.5 Checklist post-tag

- [ ] Tag `v1.0.0-mvp` visible sur GitHub Releases des 2 repos.
- [ ] CHANGELOG des 2 repos à jour avec entrée `[v1.0.0-mvp]`.
- [ ] Communication BSIC : envoyer un mail avec lien vers ce
  `docs/RELEASE-v1.0.0-mvp.md` + la recette `docs/RECETTE-MVP.md`.
- [ ] Préparer le déploiement pré-prod BSIC (cf. §4).
- [ ] Snapshot Postgres + tag `v0.5.0-mvp` retenus comme point de
  rollback (cf. §4.7).

---

## Références

### Documentation projet (backend `docs/`)

- [`README.md`](../README.md) — Vue d'ensemble + installation dev
- [`CHANGELOG.md`](../CHANGELOG.md) — Historique versionné Lots 1 → 6.7
- [`docs/RECETTE-MVP.md`](RECETTE-MVP.md) — 15 scénarios R1-R15 exécutables
- [`docs/roadmap-mvp.md`](roadmap-mvp.md) — Plan d'exécution + modules différés
- [`docs/architecture.md`](architecture.md) — 5 couches NestJS + React
- [`docs/conventions.md`](conventions.md) — Code, Git, migrations
- [`docs/audit.md`](audit.md) — Politique audit 10 ans BCEAO
- [`docs/modele-donnees.md`](modele-donnees.md) — Modèle dimensionnel
- [`docs/scd2-pattern.md`](scd2-pattern.md) — Pattern SCD2
- [`docs/ci-cd.md`](ci-cd.md) — CI GitHub Actions
- [`docs/lot-administration.md`](lot-administration.md) — RBAC + CRUD users
- [`docs/lot-4/README.md`](lot-4/README.md) — Multi-périmètres + délégations + emails
- [`docs/lot-5/README.md`](lot-5/README.md) — Module Exécution
- [`docs/lot-6/6.3-bullmq-redis.md`](lot-6/6.3-bullmq-redis.md) — Queue BullMQ
- [`docs/lot-6/6.4-securite-mots-de-passe.md`](lot-6/6.4-securite-mots-de-passe.md) — Sécurité mdp
- [`docs/lot-6/6.5-notifications-residuelles.md`](lot-6/6.5-notifications-residuelles.md) — Forgot password + J-3
- [`docs/lot-6/6.6-nettoyage-codebase.md`](lot-6/6.6-nettoyage-codebase.md) — ESLint + tsc strict
- [`docs/lot-6/6.7-ux-residuel.md`](lot-6/6.7-ux-residuel.md) — UX résiduel

### Frontend (`budjet-frontend/`)

- `README.md` — installation + scripts (note : doc obsolète, à
  actualiser Lot 7+ cf. §7.2)
- `CHANGELOG.md` — historique frontend

### Migrations TypeORM (`src/migrations/`)

61 migrations entre `1777800000000-CreateDimTemps.ts` et
`1779200000220-AjouterCodesAuditLot65.ts`. Toutes idempotentes,
toutes avec `down()` réversible (convention projet).

### GitHub

- Backend : <https://github.com/netmophus/budget-backend>
- Frontend : <https://github.com/netmophus/budget-frontend>
- Tag `v1.0.0-mvp` : voir GitHub Releases des 2 repos après pose.
- Branch protection : Settings → Rules → main des 2 repos.

### Conformité réglementaire

L'application respecte en permanence :
- **PCB UMOA** — Plan Comptable Bancaire de l'Union Monétaire Ouest Africaine
- **BCEAO** — référentiel devises, taux pivots, reporting prudentiel
- **Commission Bancaire de l'UMOA** — autorité de supervision
- **Bâle II/III UMOA** — dispositif prudentiel (solvabilité, liquidité, division des risques)
- **Loi-cadre bancaire 2024** — cadre juridique zone UMOA

Conservation `audit_log` : **10 ans** (cf. `docs/audit.md` § Conservation
et purge).
