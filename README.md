# Module Budgétaire Bancaire UEMOA — MIZNAS

> Application web de pilotage budgétaire et de suivi de performance pour
> les établissements bancaires de la zone UEMOA, alignée sur le Plan
> Comptable Bancaire (PCB) UMOA et le dispositif prudentiel BCEAO/Bâle.

> **Note de portée** : ce README décrit l'ensemble du projet (backend +
> frontend). Il est hébergé dans le dépôt
> [`budget-backend`](https://github.com/netmophus/budget-backend) qui
> est le **dépôt structurant** : il porte le modèle de données
> (`docs/modele-donnees.md`), la documentation projet (`docs/`) et les
> conventions de code communes. Le frontend a son propre dépôt
> [`budget-frontend`](https://github.com/netmophus/budget-frontend) avec
> sa propre documentation technique React/Vite.

Version des spécifications : **V1.0 — avril 2026**

---

## 1. Objectif fonctionnel

MIZNAS couvre l'ensemble du cycle budgétaire d'une banque commerciale UEMOA :

- **Élaboration** du budget pluriannuel (1 an glissant + 2 ans projetés)
  par axes structure / produit / segment / devise.
- **Suivi mensuel** du réalisé comptable issu du PCB UMOA et calcul des
  écarts budget vs réalisé.
- **Reprévisions** infra-annuelles et gestion multi-versions / multi-scénarios.
- **Restitutions** : tableaux de bord, états prudentiels et reporting
  prudentiel BCEAO, exports analytiques.
- **Pilotage prudentiel** : ratios de solvabilité, liquidité (LCR/NSFR),
  division des risques, transformation.

Le périmètre détaillé est décrit dans les spécifications fonctionnelles
V1.0 (cf. `docs/`).

---

## 2. Stack technique

| Couche     | Technologie                                       |
|------------|---------------------------------------------------|
| Backend    | NestJS 11, TypeScript 5, TypeORM 0.3, Node 24     |
| Frontend   | React 19, Vite 7, TypeScript 5                    |
| Base       | PostgreSQL 18                                     |
| API        | REST JSON (OpenAPI), authentification stateless   |
| Tests      | Jest (back), Vitest/Jest + Testing Library        |

**Choix structurants :**
- **API-first** : tout le frontend consomme exclusivement l'API REST
  exposée par le backend.
- **Stateless** : aucune session serveur, jetons portés par le client.
- **Séparation stricte** des 5 couches fonctionnelles (cf.
  `docs/architecture.md`).

---

## 3. Prérequis

- **Node.js** ≥ 22 LTS (recommandé : 24)
- **npm** ≥ 10 (ou pnpm / yarn équivalent)
- **PostgreSQL** ≥ 14 (cible : 18) — plancher 14 pour les fonctionnalités
  JSONB et window functions utilisées par le module
- **Git** ≥ 2.40
- Système : Windows 10/11, Linux, macOS

Base de données par défaut en développement :

| Paramètre  | Valeur        |
|------------|---------------|
| host       | `localhost`   |
| port       | `5432`        |
| database   | `budget_db`   |
| user       | `postgres`    |
| password   | défini en `.env` (jamais en clair dans le dépôt) |

> Le port `5432` est la valeur PostgreSQL par défaut. À adapter via la
> variable `DB_PORT` du fichier `.env` si la machine héberge déjà une
> autre instance PostgreSQL.

---

## 4. Installation

### 4.1 Cloner les dépôts

Les deux dépôts sont **indépendants**. Cloner les deux côte à côte :

```bash
git clone https://github.com/netmophus/budget-backend.git  budjet-backend
git clone https://github.com/netmophus/budget-frontend.git budjet-frontend
```

Les commandes des sections suivantes supposent ce layout (`budjet-backend/`
et `budjet-frontend/` au même niveau).

### 4.2 Préparer la base PostgreSQL

```sql
CREATE DATABASE budget_db;
```

L'utilisateur `postgres` (superuser créé à l'installation de PostgreSQL)
est utilisé tel quel en développement — pas de rôle dédié à créer.

### 4.3 Installer le backend

```bash
cd budjet-backend       # à sauter si vous êtes déjà dedans
cp .env.example .env
npm install
```

Le fichier `.env.example` (versionné, sans secret) sert de modèle. Il
expose les variables suivantes :

```dotenv
# .env.example
PORT=3001
LOG_LEVEL=info                # debug | info | warn | error | silent

DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=change_me
DB_NAME=budget_db

# JWT_SECRET DOIT être généré aléatoirement (>= 64 octets) et NE JAMAIS être committé.
# Génération : node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=replace_with_random_64_byte_hex_secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
BCRYPT_ROUNDS=12

# Mot de passe initial du compte admin@miznas.local — À CHANGER DÈS LE 1er LOGIN.
SEED_ADMIN_PASSWORD=ChangeMe!2026
```

Chaque développeur copie ce fichier vers `.env` (non versionné) et
remplace `change_me` par le mot de passe local de l'utilisateur
`postgres` (défini à l'installation de PostgreSQL).

### 4.4 Installer le frontend

```bash
cd ../budjet-frontend
npm install
```

---

## 5. Lancement en développement

Trois services à démarrer en parallèle (ou en trois terminaux) :

### 5.1 Base PostgreSQL

```bash
# Linux/macOS
sudo systemctl start postgresql

# Windows (service)
net start postgresql-x64-18
```

### 5.2 Backend NestJS — port `3001`

```bash
cd budjet-backend
npm run start:dev
```

API disponible sur : <http://localhost:3001>

### 5.3 Frontend React/Vite — port `5173`

```bash
cd budjet-frontend
npm run dev
```

Application disponible sur : <http://localhost:5173>

### 5.4 Vérification rapide

```bash
curl http://localhost:3001/api/v1/health
```

Doit retourner un statut `200 OK`.

---

## 6. Structure du projet

> Ce README est hébergé dans `budjet-backend/` (dépôt structurant). La
> documentation `docs/` est versionnée à côté. Le frontend est un
> dépôt séparé qui ne contient que sa propre doc technique.

Layout typique d'une station de dev (les deux dépôts clonés côte à côte) :

```
projet-budget-banque/                ← dossier de travail local (pas un dépôt)
├── budjet-backend/                  ← dépôt git « budget-backend »
│   ├── README.md                    ← CE fichier
│   ├── src/
│   ├── test/
│   ├── docs/                        ← documentation projet
│   │   ├── roadmap-mvp.md           ← lots 1 à 6 du plan d'exécution
│   │   ├── modele-donnees.md        ← modèle dimensionnel cible
│   │   ├── architecture.md          ← 5 couches → modules NestJS
│   │   ├── conventions.md           ← nommage, Git, migrations
│   │   ├── glossaire.md             ← vocabulaire métier
│   │   ├── audit.md                 ← politique d'audit applicatif
│   │   └── scd2-pattern.md          ← pattern SCD2 + helpers
│   ├── package.json
│   └── tsconfig.json
└── budjet-frontend/                 ← dépôt git « budget-frontend »
    ├── README.md                    ← doc React/Vite spécifique
    ├── src/
    ├── public/
    ├── package.json
    └── vite.config.ts
```

**Deux dépôts indépendants** : `budjet-backend/` et `budjet-frontend/`
sont deux projets npm sans workspace ni outil de monorepo (Turborepo,
Nx, Lerna). Chaque projet se gère et se déploie indépendamment.

---

## 7. Documentation

| Document                                       | Contenu                                                                              |
|------------------------------------------------|--------------------------------------------------------------------------------------|
| [`docs/roadmap-mvp.md`](docs/roadmap-mvp.md)         | Plan d'exécution : lots 1 à 6, livrables, DoD                                  |
| [`docs/modele-donnees.md`](docs/modele-donnees.md)   | Modèle dimensionnel : dimensions, faits, SCD2                                  |
| [`docs/architecture.md`](docs/architecture.md)       | Cartographie des 5 couches → modules NestJS                                    |
| [`docs/conventions.md`](docs/conventions.md)         | Conventions de code, Git, migrations TypeORM                                   |
| [`docs/glossaire.md`](docs/glossaire.md)             | Vocabulaire métier UEMOA, comptable, prudentiel, technique. Enrichi au fil des lots. |
| [`docs/audit.md`](docs/audit.md)                     | Politique d'audit applicatif réglementaire (10 ans de rétention)               |
| [`docs/scd2-pattern.md`](docs/scd2-pattern.md)       | Pattern SCD2 (entité, helpers de migration, service générique)                 |

Sources de référence interne :
- `Specs_Module_Budgetaire_Bancaire_UEMOA.docx` — spécifications V1.0
- `Plan_Execution_Module_Budgetaire.docx` — plan d'exécution détaillé

---

## 8. Conformité réglementaire

L'application doit respecter en permanence :

- **PCB UMOA** : Plan Comptable Bancaire de l'Union Monétaire Ouest
  Africaine.
- **BCEAO** : référentiel des devises, taux pivots et reporting prudentiel.
- **Commission Bancaire de l'UMOA** : autorité de supervision des
  établissements assujettis.
- **Bâle II / III UMOA** : dispositif prudentiel (solvabilité, liquidité
  LCR/NSFR, division des risques, transformation).
- **Loi-cadre bancaire 2024** : cadre juridique de l'activité bancaire
  dans la zone UMOA.

Toute évolution fonctionnelle doit être tracée par rapport à ces référentiels.

---

## 9. Statut du projet

**Lot 2 en cours** — Sous-étapes 2.1 (socle SCD2) et 2.2
(`dim_temps`, `dim_devise`, frontend lecture) livrées. Prochaine
étape : 2.3 — premières dimensions SCD2 réelles (structure, CR).

| Élément                                 | Statut |
| --------------------------------------- | ------ |
| Backend NestJS sur :3001                | ✅      |
| Frontend React/Vite sur :5173           | ✅      |
| Base PostgreSQL `budget_db` connectée   | ✅      |
| Authentification JWT + refresh          | ✅      |
| Autorisation RBAC                       | ✅      |
| Audit applicatif réglementaire          | ✅      |
| Documentation de cadrage (Lot 0)        | ✅      |
| Lot 1 — Socle transverse                | ✅      |
| Lot 2 — Référentiels                    | 🟡 en cours (2.1 + 2.2 livrés) |
| Lot 3 — Élaboration budgétaire          | ⏳      |

Détail des étapes : voir `docs/roadmap-mvp.md`.

---

## 10. Licence et confidentialité

Projet interne — usage restreint. Toute diffusion externe (code,
spécifications, données) doit être validée par la direction projet.
