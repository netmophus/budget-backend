# Conventions — MIZNAS

> Conventions de code, de structure et de processus appliquées sur le
> projet. Tout exemple cité dans ce document est tiré du code réel
> du Lot 1 — pas de théorie sans contrepartie pratique.

Audience : tout développeur rejoignant l'équipe doit pouvoir lire ce
document seul et produire du code conforme dès son premier commit.

---

## Sommaire

1. [Nommage](#1-nommage)
2. [Structure type d'un module NestJS](#2-structure-type-dun-module-nestjs)
3. [DTO et validation](#3-dto-et-validation)
4. [Entités TypeORM](#4-entités-typeorm)
5. [Migrations TypeORM](#5-migrations-typeorm)
6. [Tests](#6-tests)
7. [Conventions frontend](#7-conventions-frontend)
8. [Imports et organisation des fichiers](#8-imports-et-organisation-des-fichiers)
9. [Stratégie de branches Git](#9-stratégie-de-branches-git)
10. [Messages de commit](#10-messages-de-commit)
11. [Revue de code et merge](#11-revue-de-code-et-merge)

---

## 1. Nommage

### 1.1 Base de données

Cf. `docs/modele-donnees.md` §8 pour le détail. Synthèse :

| Élément | Convention | Exemple |
|---|---|---|
| Tables | `snake_case`, singulier, jamais de pluriel | `user`, `ref_role`, `audit_log` |
| Préfixes | `dim_` / `fait_` / `ref_` / `bridge_` | `ref_permission`, `bridge_user_role` |
| Colonnes | `snake_case`, sans accent | `mot_de_passe_hash`, `date_creation` |
| PK | toujours `id` (`bigint generated always as identity`) | `user.id` |
| FK | `fk_<entité>` | `fk_user`, `fk_role` |
| Auto-référence | `fk_<entité>_parent` | (futur Lot 2 : `fk_compte_parent`) |
| Booléens | préfixe `est_` ou `a_` | `est_actif`, `est_porteur_interets` |
| Dates métier | suffixe explicite | `date_creation`, `date_debut_validite` |
| Enums | `varchar` + contrainte `CHECK`, **pas** de type ENUM PG | `motif_revocation` |
| Montants | `numeric(20, 4)` | (futur Lot 3) |

### 1.2 Classes TypeScript

| Élément | Convention | Exemple |
|---|---|---|
| Classes | `PascalCase` | `User`, `AuthService`, `JwtAuthGuard` |
| Propriétés d'entité | `camelCase` (mappé snake_case par `@Column({ name: '…' })`) | `motDePasseHash`, `dateCreation` |
| Méthodes | `camelCase`, verbe d'action | `validateUser`, `getCurrentUser`, `revokeAllActiveTokens` |
| Constantes module | `SCREAMING_SNAKE_CASE` | `IS_PUBLIC_KEY`, `PERMISSIONS_KEY`, `AUDITABLE_KEY` |
| Type / Interface | `PascalCase`, pas de préfixe `I` | `AuthUser`, `IssuedTokens`, `AuditLogEntry` |
| Type union string | en littéraux | `MotifRevocation = 'logout' \| 'rotation' \| 'forced'` |

### 1.3 Suffixes par rôle

| Rôle | Suffixe | Exemple |
|---|---|---|
| Module NestJS | `Module` | `AuthModule`, `UsersModule` |
| Service | `Service` | `AuthService`, `PermissionsService` |
| Controller | `Controller` | `AuthController`, `UsersController` |
| Guard | `Guard` | `JwtAuthGuard`, `PermissionsGuard` |
| Interceptor | `Interceptor` | `AuditInterceptor` |
| Filter | `Filter` | `AllExceptionsFilter` |
| Strategy | `Strategy` | `JwtStrategy` |
| DTO entrant (body) | `Dto` | `LoginDto`, `RefreshTokenDto`, `LogoutDto` |
| DTO entrant (query) | `QueryDto` | `ListUsersQueryDto`, `ListAuditLogsQueryDto` |
| DTO de réponse | `ResponseDto` | `UserResponseDto`, `AuditLogResponseDto` |
| DTO paginé | `PaginatedXxxDto` ou `PaginatedResponse<T>` | `PaginatedUsersDto`, `PaginatedAuditLogsDto` |
| Entité TypeORM | (sans suffixe — la classe `User` suffit) | `User`, `RefreshToken`, `AuditLog` |
| Decorator factory | `PascalCase` (utilisé `@Decorateur()`) | `@Public`, `@CurrentUser`, `@RequirePermissions`, `@Auditable` |

### 1.4 Fichiers

`kebab-case` partout côté backend, avec un suffixe qui indique le rôle :

| Type | Pattern | Exemple |
|---|---|---|
| Module | `<domain>.module.ts` | `auth.module.ts` |
| Service | `<domain>.service.ts` | `auth.service.ts` |
| Controller | `<domain>.controller.ts` | `auth.controller.ts` |
| Test | `<file>.spec.ts` (Jest) | `auth.service.spec.ts` |
| DTO | `<purpose>.dto.ts` | `login.dto.ts`, `list-users-query.dto.ts` |
| Entity | `<entity-name>.entity.ts` | `user.entity.ts`, `refresh-token.entity.ts` |
| Guard | `<purpose>.guard.ts` | `jwt-auth.guard.ts`, `permissions.guard.ts` |
| Interceptor | `<purpose>.interceptor.ts` | `audit.interceptor.ts` |
| Filter | `<purpose>.filter.ts` | `all-exceptions.filter.ts` |
| Strategy | `<purpose>.strategy.ts` | `jwt.strategy.ts` |
| Decorator | `<purpose>.decorator.ts` | `public.decorator.ts`, `require-permissions.decorator.ts` |
| Migration | `<timestamp>-<Name>.ts` (auto) | `1777384329141-InitAuthSchema.ts` |
| Seed | `<purpose>-seed.ts` | `auth-seed.ts` |

### 1.5 Permissions et codes métier

Format : `MODULE.VERBE` en `SCREAMING_SNAKE_CASE`, séparateur point.
Verbes : `LIRE`, `GERER`. (Pas `READ`/`WRITE` — vocabulaire métier
français, cohérent avec les libellés UI.)

Exemples actuels : `USER.LIRE`, `USER.GERER`, `ROLE.LIRE`, `ROLE.GERER`,
`AUDIT.LIRE`, `SYSTEM.ADMIN`. Verbes futurs prévisibles : `SAISIR`,
`VALIDER`, `GELER`, `EXPORTER`.

---

## 2. Structure type d'un module NestJS

Squelette à reproduire pour tout nouveau module métier, calé sur la
structure réelle de `auth/`, `users/`, `audit/` :

```
<domain>/
├── <domain>.module.ts            ← imports, providers, exports
├── <domain>.controller.ts        ← endpoints REST + Swagger
├── <domain>.service.ts           ← orchestration métier
├── <domain>.controller.spec.ts   ← tests delegation
├── <domain>.service.spec.ts      ← tests logique métier
├── dto/
│   ├── <action>.dto.ts           ← DTO d'entrée (body, query)
│   ├── <entity>-response.dto.ts  ← DTO de sortie
│   └── paginated-<entity>.dto.ts ← si pagination
├── entities/
│   └── <entity>.entity.ts
└── (optionnel)
    ├── decorators/<purpose>.decorator.ts
    ├── guards/<purpose>.guard.ts
    ├── interceptors/<purpose>.interceptor.ts
    ├── strategies/<purpose>.strategy.ts
    └── utils/<purpose>.ts
```

### 2.1 Règles d'écriture

**Service** : pas d'accès au request HTTP (`@Req()`, `@Res()`). Le
service prend des paramètres typés. Toute interaction multi-table
passe par `dataSource.transaction(...)` :

```typescript
// auth.service.ts — extrait
async login(email: string, motDePasse: string, ip: string | null, userAgent: string | null) {
  const user = await this.validateUser(email, motDePasse);
  if (!user) {
    await this.auditService.log({ ..., typeAction: 'LOGIN_FAILED', statut: 'failure' });
    throw new UnauthorizedException('Email ou mot de passe incorrect');
  }
  // ...
}
```

**Controller** : fin, délègue au service. Logique métier interdite
ici. Annotations Swagger systématiques (`@ApiTags`, `@ApiOperation`,
`@ApiOkResponse`, etc.) :

```typescript
// auth.controller.ts — extrait
@Post('login')
@HttpCode(HttpStatus.OK)
@Public()
@ApiOperation({ summary: 'Authentification par email + mot de passe.' })
async login(@Body() dto: LoginDto, @Req() req: Request): Promise<LoginResponse> {
  const ip = (req.ip ?? null) as string | null;
  const userAgent = (req.headers['user-agent'] ?? null) as string | null;
  const { tokens, user } = await this.authService.login(dto.email, dto.motDePasse, ip, userAgent);
  return { ...tokens, user: { id: user.id, email: user.email, nom: user.nom, prenom: user.prenom } };
}
```

**Module** : déclare ses imports / providers / exports. N'hésite pas à
exporter les services qui peuvent servir à d'autres modules (cf.
`AuthModule` exporte `AuthService` et `PermissionsService`). Pas de
provider global non documenté.

### 2.2 Cyclic deps

Si un module A a besoin d'un service B et inversement → c'est un signe
de mauvais découpage. **D'abord** essayer de remonter la responsabilité
commune dans un troisième module ou dans `common/`. Le `forwardRef` est
un dernier recours, à documenter en commentaire dans le code.

### 2.7 Dépendances circulaires entre modules (forwardRef en pratique)

Quand deux modules NestJS s'importent mutuellement (ex.
`StructureModule` ↔ `CentreResponsabiliteModule` pour le relink
stratégie A — cf. `scd2-pattern.md` §8), TypeScript et Nest signalent
généralement le cycle au boot. Pour le casser proprement :

1. Utiliser `forwardRef` **symétriquement** dans les 2 modules :
   - `imports`: `forwardRef(() => OtherModule)`
   - injection : `@Inject(forwardRef(() => OtherService))`
2. Si l'injection est optionnelle (le hook peut ne pas être appelé en
   isolation, ex. tests unitaires qui construisent le service à la
   main), ajouter `@Optional()` ET **ajouter un test e2e** qui vérifie
   que le hook s'exécute bien (par ex. `expect(crsRelinked).toBe(1)`).
   **Sans cette assertion**, une mauvaise configuration `forwardRef`
   se traduit en injection silencieuse à `undefined` : le hook ne
   s'exécute pas, aucune erreur, aucun warning. Bug masqué.
3. Documenter en commentaire dans le service consommateur pourquoi
   `@Optional()` est utilisé (par ex. « tests unitaires isolés »).

Validé en condition réelle au Lot 2.3B : le forwardRef asymétrique
côté `CentreResponsabiliteService.constructor` (oubli) avait laissé
`crService` à `undefined` dans `StructureService`, ce qui faisait
remonter `crsRelinked=0` au e2e — c'est ce test qui a permis
d'identifier le bug.

---

## 3. DTO et validation

### 3.1 DTO entrant

Tous les `@Body()` et `@Query()` passent par un DTO décoré
`class-validator` :

```typescript
// login.dto.ts
export class LoginDto {
  @ApiProperty({ example: 'admin@miznas.local' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'ChangeMe!2026', minLength: 8 })
  @IsString()
  @MinLength(8)
  motDePasse!: string;
}
```

Le `ValidationPipe` global (`whitelist: true, forbidNonWhitelisted:
true, transform: true`) garantit que toute propriété non décorée est
rejetée. Aucun `any` dans les body / query — même pour les payloads
souples, typer en `Record<string, unknown>` plutôt que `any`.

### 3.2 DTO sortant

Toute réponse HTTP doit passer par un DTO de sortie typé. Ne **jamais**
retourner une entité TypeORM brute :

```typescript
// users.service.ts — exemple correct
function toUserResponse(user: User): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    nom: user.nom,
    prenom: user.prenom,
    estActif: user.estActif,
    dateDerniereConnexion: user.dateDerniereConnexion,
    dateCreation: user.dateCreation,
    // ⚠️ jamais : motDePasseHash, utilisateur_creation, etc.
  };
}
```

Cette discipline garantit qu'aucune colonne sensible (`mot_de_passe_hash`,
`token_hash`, etc.) ne fuite par effet de bord.

### 3.3 Pagination

Format unifié pour toutes les listes :

```typescript
{
  items: T[];
  total: number;
  page: number;
  limit: number;
}
```

`limit` plafonné à 100 pour les usages courants, 200 pour `audit-logs`
(volumes plus élevés).

---

## 4. Entités TypeORM

### 4.1 Squelette type

```typescript
@Entity({ name: 'ref_role' })          // 1. nom snake_case explicite
export class Role {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })  // 2. PK identity bigint
  id!: string;                          // 3. typé string (bigint revient en string)

  @Index('uq_ref_role_code', { unique: true })
  @Column({ name: 'code_role', type: 'varchar', length: 50 })
  codeRole!: string;                    // 4. nom JS camelCase, colonne snake_case

  @Column({ name: 'libelle', type: 'varchar', length: 150 })
  libelle!: string;

  @Column({ name: 'date_creation', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  dateCreation!: Date;

  @OneToMany(() => RolePermission, (rp) => rp.role)
  rolePermissions!: RolePermission[];
}
```

### 4.2 Règles

- `@Entity({ name: '...' })` toujours explicite — ne jamais laisser
  TypeORM inférer le nom de la table.
- `@Column({ name: '...' })` explicite sur **chaque** colonne — la
  propriété TS reste `camelCase`, la colonne DB reste `snake_case`.
- PK : `@PrimaryGeneratedColumn('identity', { type: 'bigint' })` — la
  forme `{ type: 'bigint', generationStrategy: 'identity' }` rejette
  TypeScript.
- Type TS du `id` : `string` (PostgreSQL retourne les `bigint` en
  string, ne pas casser le contrat).
- Booléens : `@Column({ type: 'boolean', default: true })`.
- Dates créées en DB : `default: () => 'CURRENT_TIMESTAMP'`.
- Index unique nommé : préférer `@Index('uq_<table>_<col>', { unique:
  true })` au niveau colonne (lisible dans le diff de migration).
- Relations : `@ManyToOne` + `@JoinColumn({ name: 'fk_xxx' })` + colonne
  `@Column({ name: 'fk_xxx', type: 'bigint' })` séparée — permet de
  requêter par FK sans charger la relation.
- Bridges (`bridge_*`) : entités explicites, **pas** `@ManyToMany +
  @JoinTable`. Cf. ADR #3 dans `docs/architecture.md` §12.

### 4.3 Énumérations métier — FK `ref_*` paramétrables (Lot 2.5-bis)

> **Règle pour toute nouvelle dimension ou tout nouveau module**
> Tout nouveau champ avec un domaine de valeurs restreintes
> (énumération métier — type, statut, catégorie, sens, etc.) DOIT
> être stocké comme **FK vers un `ref_*` existant ou nouvellement
> créé**. Les `enum` TypeScript hardcodés et les `CHECK` constraints
> SQL ne sont **plus** la convention. Cf. ADR #17.

Pourquoi : extension sans redéploiement, contrôle utilisateur via
l'UI Configuration, traçabilité audit. Les 13 référentiels existants
(`ref_type_structure`, `ref_pays`, etc.) sont documentés dans
`docs/referentiels-secondaires.md`.

Pratique côté backend :
- Pour un nouveau référentiel, suivre le pattern de
  `src/referentiels-secondaires/<nom>/` (1 fichier compact qui hérite
  de `BaseRefSecondaire` / `BaseRefSecondaireService` /
  `createRefSecondaireControllerClass`).
- Migration : helper DRY `createRefSecondaireTable` dans
  `src/migrations/_helpers/`. Inclure les seeds initiaux dans la
  migration (cf. §5.4).
- FK vers `code` (varchar) **pas** `id` (bigint), `ON UPDATE CASCADE
  / ON DELETE RESTRICT`.

Pratique côté frontend :
- Selects dynamiques alimentés par `useRefSecondaireOptions(refKey)`
  (cache 60s, filtre `est_actif=true`). Cf. `src/lib/hooks/`.
- Helpers de format (`libelleX(code)`, `badgeClassX(code)`) restent
  acceptables dans `lib/labels/` pour la résolution rapide
  code → libellé/couleur dans les cellules de tableau (hors composant
  React, hooks impossibles).

---

## 5. Migrations TypeORM

### 5.1 Génération

```bash
npm run migration:generate -- src/migrations/<NomMigrationPascalCase>
```

Nommage : verbe d'action + objet, en `PascalCase` :
`InitAuthSchema`, `AddRefreshToken`, `AddAuditLog`. Pas d'espaces, pas
d'underscore. La timestamp est ajoutée automatiquement.

### 5.2 Ajustements manuels obligatoires

TypeORM n'est **pas** capable de générer parfaitement le schéma cible.
Trois ajustements quasi systématiques :

#### 5.2.1 `GENERATED BY DEFAULT` → `GENERATED ALWAYS`

TypeORM produit `GENERATED BY DEFAULT AS IDENTITY` par défaut. On
veut `ALWAYS` (cf. ADR #2). À ajouter dans le `up()` après chaque
`CREATE TABLE` concerné :

```typescript
await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "id" SET GENERATED ALWAYS`);
```

#### 5.2.2 Index uniques partiels

TypeORM ne sait pas inférer un `WHERE <cond>` depuis le metadata
d'entité. À ajouter manuellement et à **garder lors de chaque
re-génération** ultérieure (TypeORM voudra les supprimer) :

```typescript
await queryRunner.query(
  `CREATE UNIQUE INDEX "uq_bridge_user_role_global" ON "bridge_user_role" ("fk_user", "fk_role") WHERE "perimetre_id" IS NULL`
);
```

#### 5.2.3 Index DESC

TypeORM ignore l'ordre des colonnes d'index. Pour les index
chronologiques (`audit_log`), forcer le `DESC` :

```typescript
await queryRunner.query(`CREATE INDEX "ix_audit_log_date_action" ON "audit_log" ("date_action" DESC)`);
```

#### 5.2.4 Index unique partiel sur valeur boolean spécifique

Pour matérialiser un invariant métier du type « exactement une
ligne avec un flag à `true` » (cf. `dim_devise.est_devise_pivot`),
TypeORM ne sait pas générer la clause `WHERE`. À ajouter
manuellement dans le `up()` :

```typescript
await queryRunner.query(
  `CREATE UNIQUE INDEX "uq_dim_devise_pivot"
   ON "dim_devise" ("est_devise_pivot")
   WHERE "est_devise_pivot" = true`,
);
```

Cet invariant doit **aussi** être vérifié côté service
(`ConflictException` claire) avant l'`INSERT`, pour ne pas exposer
une erreur Postgres `23505` brute. L'index reste comme **2ᵉ ligne
de défense** contre les race conditions. Validé en condition réelle
au Lot 2.2B.

**Limitation pg-mem 3.x** : les index partiels sur boolean ne sont
pas créés par `synchronize:true`. Tests d'unicité côté service
uniquement, validation de l'index en intégration Postgres réelle
(Lot 6).

### 5.3 Réversibilité

Le `down()` doit être **complet** et **testé** :

1. Après écriture : `npm run migration:run`
2. Puis : `npm run migration:revert` (la migration doit s'annuler sans erreur)
3. Puis : `npm run migration:run` à nouveau (la base revient à l'état attendu)

Inverser l'ordre des opérations dans `down()` par rapport au `up()`
(supprimer les FK avant les tables, etc.). Toujours préférer `DROP
INDEX IF EXISTS` côté `down()` pour rester idempotent.

### 5.4 Données métier vs schéma

Les **migrations** ne contiennent que du DDL. Les **seeds** (insertions
de données métier idempotentes) restent dans `src/seeds/<purpose>-seed.ts`,
exécutables par `npm run seed:<purpose>`.

### 5.5 Vérification après merge

Toujours vérifier après un pull :

```bash
npm run migration:show       # liste les migrations exécutées vs en attente
npm run migration:run        # applique les nouvelles
```

---

## 6. Tests

### 6.1 Convention de fichier

- Backend : `<file>.spec.ts` à côté du fichier testé. Ex. `auth.service.ts`
  → `auth.service.spec.ts`. Jest les détecte via `testRegex:
  ".*\\.spec\\.ts$"` (configuré dans `package.json`).
- Frontend : `<file>.test.ts` à côté du fichier testé. Vitest les
  détecte par défaut.

### 6.2 Structure d'un test

```typescript
describe('AuthService', () => {
  let service: AuthService;
  let userRepo: jest.Mocked<...>;

  beforeEach(async () => {
    // Setup mocks + TestingModule
  });

  describe('login', () => {
    it('issues access + refresh tokens, audits LOGIN success', async () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

Un `describe` par classe testée, un sous-`describe` par méthode (quand
elle a > 1 test). Nom du test : phrase descriptive du comportement
attendu, en anglais (compatible CI logs internationaux).

### 6.3 Mocks

- Mocker au repository (`jest.fn()` sur `findOne`, `save`, etc.) plutôt
  qu'au DataSource — plus rapide et plus lisible.
- `getRepositoryToken(Entity)` pour injecter dans le TestingModule.
- Pour les services externes (`AuditService`, `JwtService`, etc.),
  mock minimal de l'interface utilisée.

### 6.4 Couverture cible

| Module | Cible Lot 1 | Atteinte |
|---|---|---|
| `auth/` | ≥ 75 % | 91.15 % |
| `audit/` | ≥ 80 % | 100 % (controller + service) |
| `users/` | ≥ 70 % | 100 % |
| `roles/` | ≥ 70 % | 100 % |
| Global | ≥ 85 % | 99 % |

Pour les Lots 2+ : maintenir global ≥ 85 %, services métier ≥ 80 %.
Les controllers minces (delegation pure) doivent quand même avoir un
spec de delegation (les chemins critiques + les 401/403/404 typiques).

---

## 7. Conventions frontend

### 7.1 Fichiers

| Type | Convention | Exemple |
|---|---|---|
| Composant React | `PascalCase.tsx` | `LoginPage.tsx`, `DataTable.tsx`, `AuthLayout.tsx` |
| Hook custom | `useXxx.ts` | (à venir) |
| Helper / lib | `kebab-case.ts` | `auth-store.ts`, `audit-logs.ts` |
| Test | `<file>.test.ts` | `permissions.test.ts`, `auth-store.test.ts` |
| Type | `types.ts` (ou colocalisé) | `lib/api/types.ts` |

### 7.2 Components shadcn-style

Sous `components/ui/` — primitives stylisées Tailwind v4, pas de
logique métier. Si on a besoin d'un composant métier composite :
`components/common/<Composant>.tsx` (cf. `Can`, `DataTable`,
`PageHeader`, `EmptyState`).

### 7.3 Store (Zustand)

- Un store par domaine fonctionnel (auth, futurs : referentiels-cache,
  filtres-globaux).
- État + actions dans le même store (pattern Zustand standard).
- Persistance `localStorage` uniquement pour les données de session
  cross-reload — **jamais** pour des permissions cachées (cf. ADR #12).
- `partialize` pour ne sérialiser que ce qui doit l'être.

### 7.4 Appels API

Tout appel passe par le client axios (`lib/api/client.ts`) ; pas de
`fetch` direct. Chaque ressource a son module typé :
`lib/api/<resource>.ts` qui exporte des fonctions retournant des
types stricts (cf. `lib/api/types.ts`).

### 7.5 Routing

- Routes définies en un seul endroit : `src/routes/AppRoutes.tsx`.
- `ProtectedRoute` pour l'authentification.
- `PermissionRoute` pour les permissions.
- Lazy loading : à activer au Lot 5 si le bundle dépasse 1 Mo gzip
  (actuellement 195 Ko gzip — pas urgent).

### 7.6 i18n

Hors périmètre Lot 1. Tous les libellés sont **en français en dur**.
Migration prévue : `react-i18next` au Lot 2 ou 3, dès qu'un libellé
métier devient ambigu (« Saisir » vs « Soumettre », par exemple).

---

## 8. Imports et organisation des fichiers

### 8.1 Ordre des imports (backend et frontend)

1. Imports Node natifs (`node:crypto`, `node:path`, …)
2. Packages tiers (`@nestjs/common`, `react`, `axios`, …)
3. Imports depuis l'alias `@/` (frontend) ou imports relatifs internes
4. `import type` séparés en bas

Séparer chaque groupe par une ligne vide. Tri alphabétique à
l'intérieur de chaque groupe.

### 8.2 Alias `@/` (frontend)

Configuré dans `vite.config.ts` + `tsconfig.app.json` (`paths: {"@/*":
["./src/*"]}`). Préférer `@/lib/api/auth` à `../../lib/api/auth` —
plus stable au refactoring de chemin.

### 8.3 Pas d'imports circulaires

Si TypeScript signale un cycle : remonter la responsabilité commune
dans un module tiers ou dans `common/`. Le `forwardRef` côté NestJS est
un dernier recours documenté.

---

## 9. Stratégie de branches Git

> Stratégie **proposée** pour le projet. À appliquer dès l'initialisation
> du dépôt mono-repo. Aujourd'hui (fin Lot 1), seuls `budjet-backend/`
> et `budjet-frontend/` ont chacun un dépôt local — un dépôt unifié est
> à mettre en place au début du Lot 2.

### 9.1 Branches permanentes

| Branche | Rôle |
|---|---|
| `main` | Production / dernier état stable. Protégée. Personne ne pousse directement. |
| `develop` | Intégration en cours. Toutes les feature branches sont mergées ici. CI verte obligatoire. |

### 9.2 Branches éphémères

| Préfixe | Usage | Exemple |
|---|---|---|
| `feat/` | Nouvelle fonctionnalité | `feat/lot2-dim-compte-pcb-umoa` |
| `fix/` | Correction de bug | `fix/refresh-rotation-race` |
| `refactor/` | Refacto sans changement fonctionnel | `refactor/extract-scd2-helpers` |
| `docs/` | Documentation seule | `docs/architecture-lot1` |
| `test/` | Tests seuls | `test/audit-interceptor-edge-cases` |
| `chore/` | Outillage, deps, CI | `chore/upgrade-typeorm-0.4` |
| `hotfix/` | Correctif urgent sur `main` | `hotfix/jwt-secret-rotation` |

### 9.3 Cycle de vie

1. Branche éphémère partant de `develop` (sauf `hotfix/` qui part de
   `main`).
2. Développement + commits suivant §10.
3. Push + ouverture d'une Pull Request vers `develop`.
4. Revue de code par au moins **un** autre développeur (cf. §11).
5. CI verte (lint + tests + build) ⇒ merge.
6. Suppression de la branche après merge.
7. `develop` → `main` par PR de release ; tag de version sur `main`.

### 9.4 Règles dures

- **Jamais** de force-push sur `main` ni `develop`.
- **Jamais** de commit direct sur `main`.
- Pas de merge avec une CI rouge.
- Une branche par périmètre fonctionnel — pas de fourre-tout.

---

## 10. Messages de commit

### 10.1 Format

Inspiré de [Conventional Commits](https://www.conventionalcommits.org/) :

```
<type>(<scope>): <description courte impérative>

[corps optionnel — pourquoi, pas le quoi]

[footer optionnel — refs issues, breaking changes]
```

### 10.2 Types

| Type | Usage |
|---|---|
| `feat` | Nouvelle fonctionnalité utilisateur |
| `fix` | Correction de bug |
| `refactor` | Réorganisation sans changement de comportement |
| `perf` | Amélioration de performance |
| `test` | Ajout / modification de tests |
| `docs` | Documentation seule |
| `build` | Build, deps, configuration |
| `ci` | Pipeline CI |
| `chore` | Tâches diverses (config IDE, scripts) |
| `style` | Formatage (rare ; le linter doit s'en charger) |

### 10.3 Scopes courants

`auth`, `audit`, `users`, `roles`, `health`, `migrations`, `seed`,
`frontend`, `docs`, `infra`. Pour le Lot 2 et au-delà : un scope par
axe (`dim-temps`, `dim-compte`, `budget`, etc.).

### 10.4 Description

- Verbe à l'**impératif présent** : `add`, `fix`, `extract`, `enforce`.
- Pas de point final.
- ≤ 72 caractères.
- En français — cohérent avec la documentation projet et le domaine métier (PCB UMOA, BCEAO, etc.). Les noms techniques restent en anglais dans la description quand ils correspondent à des identifiants de code (entités, modules, méthodes), exemple : `feat(auth): ajoute la rotation des refresh tokens avec détection de réutilisation`.

### 10.5 Exemples

```
feat(auth): ajoute la rotation des refresh tokens avec détection de réutilisation

Les tokens sont hachés en SHA-256 avant persistance. La réutilisation
d'un refresh token révoqué révoque tous les refresh tokens actifs de
l'utilisateur (motif=forced) et retourne 401, empêchant le vol de
session.

Refs: docs/architecture.md §12 ADR #7
```

```
fix(migrations): préserve les index uniques partiels lors de la régénération

Le générateur de diff TypeORM supprime les index partiels qu'il ne
peut pas reconstituer depuis les metadata. Le cycle down/up de
InitAuthSchema les détruisait.
```

```
docs(audit): documente la politique de conservation 10 ans et le hardening DBA
```

```
chore(deps): met à jour @nestjs/swagger en 11.4.2
```

### 10.6 Co-auteurs / IA

Si une partie significative du code provient d'un assistant IA, le
documenter en footer :

```
Co-Authored-By: Claude (Anthropic) <noreply@anthropic.com>
```

---

## 11. Revue de code et merge

### 11.1 Avant d'ouvrir une PR

- [ ] `npm run lint` propre
- [ ] `npm run test` vert (front + back)
- [ ] `npm run build` réussit
- [ ] Migrations testées en revert + run
- [ ] Pas de `console.log` ni de `TODO` non daté laissé
- [ ] Pas de secret en clair dans le diff
- [ ] Documentation impactée mise à jour (`docs/`, `README.md`)

### 11.2 Description de la PR

Template minimal :

```markdown
## Quoi
<2-3 lignes sur le périmètre fonctionnel>

## Pourquoi
<contexte métier / lien roadmap (ex. Lot 2.3)>

## Comment
<décisions techniques notables>

## Comment vérifier
<étapes manuelles ou commandes — minimum un scénario nominal>

## Notes
<dette laissée, TODOs, sujets à arbitrer>
```

### 11.3 Critères de revue

Le revueur vérifie :

1. **Conformité** : conventions de ce document, structure, nommage.
2. **Sécurité** : pas de fuite de secret, pas de SQL injection, RBAC
   correctement appliqué (`@RequirePermissions`), audit présent sur
   les actions sensibles.
3. **Tests** : couverture suffisante, scénarios d'erreur testés.
4. **Lisibilité** : noms parlants, commentaires uniquement quand le
   *pourquoi* n'est pas évident depuis le code.
5. **Réversibilité** : migrations, déploiements, feature flags si
   pertinents.

### 11.4 Merge

Stratégie : **squash merge** vers `develop` par défaut, pour garder
un historique linéaire et lisible. Le message de squash respecte §10.
Le merge n'est autorisé qu'après :

- 1 revue approuvée minimum
- CI verte
- Pas de conversation non résolue

Les PR de release `develop → main` se font en **merge commit** (pas
squash) pour préserver l'historique des features.
