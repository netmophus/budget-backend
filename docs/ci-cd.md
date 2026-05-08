# CI/CD MIZNAS — Lot 6.1

> Statut : **livré** (mai 2026, branche `lot-6/6.1-ci`).

Mise en place GitHub Actions sur les 2 repos
(`budget-backend` + `budget-frontend`) pour bloquer les PR sur
`main` qui régressent sur les tests, le build, le typecheck strict
ou le lint.

## 1. Workflows

Chaque repo possède son propre `.github/workflows/ci.yml`. Les
deux suivent la même architecture :

```
setup (npm ci + cache)
  ├── lint       (ESLint)
  ├── typecheck  (tsc --noEmit / tsc -b)
  ├── build      (nest build / vite build)
  ├── test       (Jest / Vitest)
  └── audit-codes-coherence  (backend uniquement)
```

Les jobs `lint / typecheck / build / test` s'exécutent **en
parallèle** une fois `setup` terminé, ce qui ramène le temps
total à ~max(jobs) ≈ 4–6 minutes.

### Triggers

| Événement | Action |
|-----------|--------|
| `pull_request` ciblant `main` | tous les jobs s'exécutent |
| `push` sur `main` | tous les jobs s'exécutent (filet de sécurité) |
| Push sur une autre branche | rien (économie de minutes Actions) |

### Concurrence

Chaque workflow définit `concurrency.cancel-in-progress: true` :
si un nouveau push arrive sur la même PR, le run en cours est
annulé pour économiser les minutes Actions et accélérer les
itérations.

## 2. Détail des jobs backend

### `setup`
Setup Node 22 + `npm ci` + cache automatique du dossier `~/.npm`
géré par `actions/setup-node`. Sortie : artefacts de npm
disponibles pour les jobs suivants.

### `lint`
Exécute ESLint en lecture seule (`npx eslint "{src,...}/**/*.ts"`,
sans `--fix` qui modifierait les sources). Le script
`npm run lint` du `package.json` active `--fix` ; on contourne
volontairement en CI pour ne pas masquer les régressions.

### `typecheck`
`npx tsc --noEmit`. Strict. Détecte les erreurs ignorées par
ts-jest et `nest build` (cf. dette §3).

### `build`
`npm run build` (= `nest build`). Vérifie que le bundle dist/
est produit sans erreur.

### `test`
`npm test -- --ci --runInBand`. `--runInBand` réduit le
parallélisme pour éviter les flakes pg-mem en environnement
contraint.

### `audit-codes-coherence`
Exécute `node scripts/check-audit-codes-coherence.js`. Vérifie
que tous les codes `ref_type_action_audit` insérés via les
migrations apparaissent dans le type union TypeAction de
`src/audit/entities/audit-log.entity.ts`. Empêche le bug
constaté au Lot Administration où un code audit était inséré
en base sans être déclaré dans le type TS (ts-jest et
`nest build` laissaient passer ce désalignement).

## 3. Détail des jobs frontend

Identique au backend, sauf :

- `typecheck` exécute `npx tsc -b --noEmit` (mode build avec
  refs de projets).
- `build` exécute `npx vite build` directement (le script
  `npm run build` enchaîne déjà `tsc -b && vite build` ; on
  appelle juste `vite build` pour avoir un signal séparé).
- Pas de job `audit-codes-coherence` côté frontend.

## 4. Dette typecheck héritée

Au premier run du Lot 6.1, les jobs `typecheck` échouent —
**c'est volontaire**. La CI rend visible une dette accumulée que
`ts-jest`, `nest build` et `vite build` ne signalaient pas.

### Backend (~20 erreurs réparties sur ~7 fichiers)

| Fichier | Type d'erreur | Cause / fix prévu |
|---|---|---|
| `test/integration/fk-ref-secondaire.spec.ts` (13 erreurs) | TS2307 modules introuvables | Le fichier référence des migrations renommées en Lot 2.5-bis-B (`AddFkDim*`). À supprimer ou réécrire — le test est déjà hors périmètre `jest src/`. |
| `src/auth/auth.service.spec.ts` | TS2322 mock incomplet | Type RolePermission non simulé dans le mock — réécrire le mock. |
| `src/auth/guards/permissions.guard.spec.ts` | TS2322 mock | idem. |
| `src/common/filters/all-exceptions.filter.spec.ts` (2 erreurs) | TS2741 propriétés manquantes | host mock obsolète — réécrire avec les nouveaux champs HttpArgumentsHost. |
| `src/common/services/scd2.service.spec.ts` | TS2322 mock | idem. |
| `src/referentiels/centre-responsabilite/centre-responsabilite.service.spec.ts` | TS2322 mock | idem. |
| `src/tableau-de-bord/services/analyse-ecarts.service.spec.ts` | TS2322 mock | idem. |

→ **Traitement Lot 6.6** : nettoyage en bloc, soit en supprimant
le test obsolète, soit en mettant à jour les mocks.

### Frontend (~67 erreurs réparties sur ~49 fichiers)

Principalement deux familles :

1. **`Cannot find namespace 'JSX'` (TS2503)** — ~57 fichiers.
   Cause : depuis React 19 + `@types/react@^19`, le namespace
   global `JSX` est masqué et il faut soit `import { JSX } from
   'react'`, soit migrer la signature en `React.JSX.Element` ou
   `ReactElement`.

   Fichiers impactés (extrait) :
   - `src/components/admin/AffectationsDialog.tsx`
   - `src/components/admin/users/CreerUserDialog.tsx`
   - `src/components/budget/BandeauDelegations.tsx`
   - `src/components/realise/*` (tous)
   - `src/components/reforecast/*` (tous, dont les nouveaux du
     Lot 5.3.B)
   - `src/components/tableau-bord/*`
   - `src/pages/Reforecast*Page.tsx`
   - `src/pages/TableauBord*.tsx`
   - `src/components/ui/tabs.tsx`
   - … total ~49 fichiers

2. **Mocks de tests obsolètes (TS2740 + TS6133)** — 2 fichiers.
   - `src/pages/VersionsPage.test.tsx` : 2 mocks `Version` ne
     contiennent plus tous les champs workflow ajoutés au Lot 3.5.
   - `src/pages/SaisieBudgetairePage.test.tsx` : variable
     `mockSaveGrille` déclarée mais non utilisée.

→ **Traitement Lot 6.6** :
   - Migration globale `JSX.Element` → `React.JSX.Element` via
     codemod (1 PR à fort impact mécanique, ~50 lignes modifiées).
   - Réécrire les 2 mocks obsolètes.

## 5. Lancer les checks en local (avant de pousser)

### Backend
```bash
cd budjet-backend
npx tsc --noEmit          # typecheck strict
npm run build             # nest build
npx eslint "src/**/*.ts"  # lint sans --fix
npm test -- --runInBand   # tests Jest
node scripts/check-audit-codes-coherence.js  # cohérence audit
```

### Frontend
```bash
cd budjet-frontend
npx tsc -b --noEmit       # typecheck strict
npx vite build            # build production
npm run lint              # ESLint
npm test                  # Vitest
```

## 6. Que faire si un job échoue ?

| Job | Symptôme | Diagnostic |
|---|---|---|
| `setup` | `npm ci` échoue | Lockfile non aligné avec `package.json`. Lancer `npm install` en local, commit le `package-lock.json` mis à jour. |
| `lint` | erreurs ESLint | Lancer `npm run lint` (avec `--fix`) en local, vérifier le diff avant commit. |
| `typecheck` | erreurs TS | Lancer `npx tsc --noEmit` localement. Si erreur dans un fichier hérité : voir §4 (dette Lot 6.6). Si erreur dans un fichier modifié par la PR : à corriger avant merge. |
| `build` | échec compilation | Souvent un import circulaire ou une dépendance manquante. Reproduire en local avec `npm run build`. |
| `test` | tests rouge | Run local : `npm test -- --runInBand`. Si flaky : ouvrir une issue Lot 6.6. |
| `audit-codes-coherence` | code audit orphelin | Ajouter le code au type `TypeAction` (audit-log.entity.ts) ; ou retirer la migration si introduite par erreur. |

## 7. Branch protection rules (à appliquer manuellement)

GitHub Actions ne peut pas créer les protection rules — c'est
une opération admin via l'UI. À appliquer une seule fois sur
chaque repo :

`Settings → Branches → Add branch protection rule` :

- **Branch name pattern** : `main`
- **Require a pull request before merging** : ✅
  - **Require approvals** : 1 (à ajuster selon l'équipe)
- **Require status checks to pass before merging** : ✅
  - **Require branches to be up to date before merging** : ✅
  - **Status checks required** :
    - `setup`
    - `lint`
    - `typecheck` *(à activer une fois la dette §4 apurée — cf. Lot 6.6)*
    - `build`
    - `test`
    - `audit-codes-coherence` *(backend uniquement)*
- **Restrict pushes that create matching branches** : ✅
- **Do not allow bypassing the above settings** : ✅

> Tant que la dette typecheck du §4 n'est pas apurée, NE PAS
> activer le statut `typecheck` comme bloquant — il échouera et
> bloquera tous les merges. Une fois le Lot 6.6 livré, basculer
> en bloquant.

## 8. Tag de release

Le Lot 6.1 marque la transition entre la livraison du MVP
fonctionnel (Lot 5 clos) et l'industrialisation (Lot 6).

```bash
# Sur les 2 repos après merge du Lot 6.1 sur main
git tag -a v0.5.0-mvp -m "MVP fonctionnel après Lot 5"
git push origin v0.5.0-mvp
```

La note de release GitHub est créée manuellement (cf. CHANGELOG
backend).

## 9. Évolutions possibles (dette Lot 6 / 7)

- **Couverture de code** : ajouter `npm run test:cov` + upload
  vers Codecov / SonarCloud (gratuit pour open-source ; à
  évaluer en termes de coût pour repo privé).
- **e2e tests** (sujet du Lot 6.2) : un job dédié qui spawn
  pg-mem ou un Postgres docker + supertest. Détectera les bugs
  de sérialisation `crIds[]` du type Lot 5.2-fix1/2.
- **Dependabot / Renovate** : automatiser les bumps de
  dépendances avec PR auto-créées (validées par la CI).
- **Build artifacts** : pousser le `dist/` backend ou le bundle
  frontend en artifact GitHub pour téléchargement, si
  déploiement manuel via copie.
- **CD vers staging** : workflow déclenché sur push `main` qui
  déploie vers un environnement de pré-prod.
