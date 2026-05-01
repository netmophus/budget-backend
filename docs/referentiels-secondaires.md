# Référentiels secondaires (énumérations paramétrables)

> Document de référence du **Lot 2.5-bis** — architecture des 13 tables
> `ref_*` exposant les énumérations métier centralisées et
> paramétrables via l'UI Configuration.

## 1. Vue d'ensemble

Avant le Lot 2.5-bis, les énumérations métier (types de structure, sens
de compte, statuts de version, etc.) étaient **hardcodés** dans le code
TypeScript et matérialisés en base par des `CHECK` constraints SQL.
Cette approche imposait un redéploiement pour ajouter une seule valeur
(ex. nouveau type d'organisation chez un client banque), interdisait
toute traçabilité utilisateur sur le contenu, et concentrait la
décision métier dans la main du développeur.

Le Lot 2.5-bis transforme ces 13 énumérations en **tables paramétrables
en base** avec un module Configuration unifié côté UI. Bénéfices :

- **Extension sans redéploiement** : un admin ajoute `'succursale'` via
  l'UI, le drawer de structure le voit immédiatement.
- **Contrôle utilisateur** : verrouillage par permission
  `CONFIGURATION.GERER` distincte de `REFERENTIEL.GERER`.
- **Traçabilité** : chaque ajout / modification / suppression passe
  par `@Auditable` et finit dans `audit_log`.

## 2. Liste des 13 référentiels

| Catégorie | Nom UI | Table | Référencé par |
|---|---|---|---|
| Organisation | Type de structure | `ref_type_structure` | `dim_structure.type_structure` |
| Organisation | Pays UEMOA | `ref_pays` | `dim_structure.code_pays` |
| Organisation | Type de CR | `ref_type_cr` | `dim_centre_responsabilite.type_cr` |
| Plan comptable | Sens compte | `ref_sens_compte` | `dim_compte.sens` |
| Plan comptable | Classe compte | `ref_classe_compte` | `dim_compte.classe` |
| Métier | Type de produit | `ref_type_produit` | `dim_produit.type_produit` |
| Métier | Catégorie segment | `ref_categorie_segment` | `dim_segment.categorie` |
| Workflow budget | Type de version | `ref_type_version` | `dim_version.type_version` |
| Workflow budget | Statut version | `ref_statut_version` | `dim_version.statut` |
| Workflow budget | Type scénario | `ref_type_scenario` | `dim_scenario.type_scenario` |
| Workflow budget | Statut scénario | `ref_statut_scenario` | `dim_scenario.statut` |
| Workflow budget | Type taux | `ref_type_taux` | `ref_taux_change.type_taux` |
| Système | Type action audit | `ref_type_action_audit` | `audit_log.type_action` |

## 3. Schéma uniforme

Les 13 tables partagent **strictement** la même structure (cf.
`src/referentiels-secondaires/common/entities/base-ref-secondaire.entity.ts`) :

```typescript
abstract class BaseRefSecondaire {
  // id : @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  //      sur chaque concrétisation
  @Column({ type: 'varchar', length: 50 })  code!: string;
  @Column({ type: 'varchar', length: 200 }) libelle!: string;
  @Column({ type: 'text', nullable: true }) description!: string | null;
  @Column({ type: 'int', default: 0 })      ordre!: number;
  @Column({ name: 'est_actif',   default: true })  estActif!: boolean;
  @Column({ name: 'est_systeme', default: false }) estSysteme!: boolean;
  // + 4 colonnes audit applicatif (date_creation, utilisateur_creation,
  //   date_modification, utilisateur_modification)
}
```

Chaque table porte 3 index : `UNIQUE(code)`, `(est_actif, ordre)` (selects
UI), `est_systeme` (filtrage admin).

## 4. FK et règles d'intégrité

Depuis le Lot 2.5-bis-B, chaque colonne enum des dimensions est une
**FK** vers le champ `code` (varchar) du référentiel correspondant —
PAS vers `id`. Avantage : rétrocompat avec les imports CSV historiques
et lisibilité directe en SQL (`SELECT type_structure FROM dim_structure`
retourne `'agence'`, pas `42`).

Règles communes aux 13 FK :

- **`ON UPDATE CASCADE`** : renommer un code custom (ex. `'autre'` →
  `'AUTRE'`) propage le changement aux dimensions consommatrices. Pas
  applicable aux codes système (interdit côté service).
- **`ON DELETE RESTRICT`** : impossible de supprimer une valeur
  référencée → erreur 409 claire côté API. Double sécurité avec le
  hook applicatif `isReferenced()`.
- **Soft-delete via `est_actif=false`** : la valeur reste en base mais
  est masquée des selects UI (filtre `est_actif=true` côté hook).
- **`est_systeme=true`** : valeur livrée avec le produit, code
  immuable, suppression interdite. Distinction permet à un admin
  client de désactiver les valeurs métier custom (ex. `'agence'` chez
  une banque sans agences) sans toucher aux valeurs structurelles.

## 5. Endpoints API

7 routes uniformes par référentiel sous `/api/v1/configuration/<refKey>`
(13 × 7 = **91 endpoints**) :

| Méthode | Route | Permission | Audit |
|---|---|---|---|
| `GET` | `/` | `CONFIGURATION.LIRE` | — |
| `GET` | `/par-code/:code` | `CONFIGURATION.LIRE` | — |
| `GET` | `/:id` | `CONFIGURATION.LIRE` | — |
| `POST` | `/` | `CONFIGURATION.GERER` | `CREATE` |
| `PATCH` | `/:id` | `CONFIGURATION.GERER` | `UPDATE` |
| `POST` | `/:id/toggle-actif` | `CONFIGURATION.GERER` | `UPDATE` |
| `DELETE` | `/:id` | `CONFIGURATION.GERER` | `DELETE` |

Permissions seedées (cf. `auth-seed.ts`) :

| Rôle | `CONFIGURATION.LIRE` | `CONFIGURATION.GERER` |
|---|---|---|
| ADMIN | ✅ | ✅ |
| LECTEUR | ✅ | ❌ |

## 6. Page Configuration (UI)

Route unique `/configuration?ref=<refKey>`. Layout 2 panneaux :

- **Gauche (25 % sticky)** : navigation catégorisée (5 catégories
  organisationnelle, plan comptable, métier, workflow, système) avec
  les 13 référentiels regroupés. Chaque entrée affiche un badge
  count fetché en parallèle au mount (13 requêtes `limit=1`).
- **Droite (75 %)** : `RefSecondaireTable` du référentiel actif —
  filtres (recherche libellé, afficher inactives, système uniquement),
  colonnes Code / Libellé / Description / Ordre / Statut / Système /
  Actions, modale création / édition (`RefSecondaireFormDrawer`),
  modales toggle et suppression destructive (`ConfirmDialog`).

Mode lecture pour LECTEUR : la page reste accessible mais aucun bouton
d'action n'est visible.

## 7. Hook frontend `useRefSecondaireOptions`

Hook React générique pour les selects dynamiques alimentés par les
référentiels secondaires (`src/lib/hooks/useRefSecondaireOptions.ts`).

```typescript
const { options, loading, error, refresh } =
  useRefSecondaireOptions('type-structure');
```

Caractéristiques :

- Cache mémoire 60s par `refKey` (Map module-level), partagé entre les
  composants pour éviter le N+1 sur les pages avec plusieurs drawers.
- Filtre `est_actif=true` côté API ET côté UI (double sécurité contre
  le cache stale).
- Tri par `ordre` ASC puis `libelle` ASC.
- `refresh()` bypass le cache après une modification dans
  `/configuration` depuis un autre onglet.

Pattern d'usage à dupliquer dans les futurs FormDrawers (Lot 2.5B+).
La factorisation en composant `<RefSecondaireSelect>` est repoussée au
Lot 6 (règle « factoriser à 3 cas concrets »).

## 8. Décisions architecturales

- **FK vers `code` varchar et pas vers `id` bigint** (option B) :
  rétrocompat CSV historiques + lisibilité SQL. Le coût (légère
  redondance de stockage varchar vs bigint) est négligeable face au
  bénéfice.
- **13 tables séparées et pas 1 table polymorphique** : isolation des
  FK, lisibilité, pattern uniforme. Une table polymorphique
  (`ref_secondaire(table_name, code, libelle, …)`) aurait demandé des
  contraintes complexes pour empêcher les doublons cross-référentiel.
- **Page UI unique vs 13 entrées sidebar** : convention SAP / Oracle
  Customizing — un endroit central et identifiable pour la
  paramétrisation, sans surcharger la sidebar principale.
- **`dim_compte.classe` converti `int → varchar`** : cohérence avec
  `ref_classe_compte.code` (varchar 50). Migration spéciale 6 étapes
  documentée dans `1779100000050-AddFkDimCompteClasse.ts`.

Cf. ADR-04 dans `docs/architecture.md` §12.

## 9. Limitations connues

- **Cache cross-onglets non géré** : un admin qui crée une valeur dans
  un onglet ne voit pas le changement immédiatement dans un autre
  onglet (TTL 60s puis refresh manuel). Acceptable MVP. Lib externe
  (BroadcastChannel, react-query) écartée pour respecter la contrainte
  « aucune nouvelle dépendance ».
- **Libellés custom non résolus dans les cellules de tableau** : les
  helpers `libelleTypeStructure(code)` etc. s'appliquent dans
  `ColumnDef.cell` (hors composant React, hooks impossibles). Les
  valeurs créées via `/configuration` apparaissent en code brut dans
  les badges de tableau. Reconsidérer en Lot 6 si le besoin se
  matérialise.
- **Validation `ON UPDATE CASCADE` réelle Postgres** : non vérifiée
  en e2e Jest (pg-mem ne joue pas les migrations TypeORM, l'option A
  des entités sans `@ManyToOne` ne déclenche pas les FK via
  `synchronize`). À valider en recette psql.

## 10. Pour aller plus loin

- Code source : `src/referentiels-secondaires/` (13 modules + commun).
- Migrations : `src/migrations/1779000000010-…` à `1779100000130-…`
  (26 fichiers, helpers DRY dans `_helpers/`).
- Tests : `referentiels-secondaires.e2e.spec.ts` (38 tests e2e),
  `base-ref-secondaire.service.spec.ts` (20 tests unitaires socle).
- ADR-04 : `docs/architecture.md` §12.
