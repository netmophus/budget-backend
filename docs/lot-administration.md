# Lot Administration — CRUD utilisateurs + rôles + dettes RBAC

> Statut : **livré** (mai 2026) — branche `lot-administration`
>
> Lot intercalaire entre Lot 4 (multi-périmètres / délégations /
> emails) et Lot 5 (exécution réalisé). Ferme la dette
> d'administration utilisateurs accumulée pendant le Lot 4 :
> avant ce lot, créer un user nécessitait une migration manuelle.

## 1. Décisions produit (NON-NÉGOCIABLES)

| ID | Décision | Justification |
|----|----------|---------------|
| **D1** | Pas de création de rôles personnalisés. L'admin attribue/retire des rôles parmi les **6 existants** (ADMIN, LECTEUR, SAISISSEUR, VALIDATEUR, PUBLICATEUR, AUDITEUR). | RBAC simple, audit BCEAO clair. La création de rôles ad-hoc viendrait avec son propre lot dédié si un jour le besoin émerge. |
| **D2** | **Cumul de rôles autorisé**. Permissions = UNION. | Cas réels banque : un dir.retail peut être à la fois VALIDATEUR sur ses CR et SAISISSEUR sur un autre périmètre suite à un changement de poste. |
| **D3** | Ergonomie : attribution depuis la **fiche user** (multi-select), pas depuis la fiche rôle. | Workflow naturel admin : "je gère ce user, je lui colle ses rôles". Évite le va-et-vient entre listes. |

## 2. Endpoints ajoutés

### 2.1 CRUD utilisateurs (`/admin/users`, USER.GERER)

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/admin/users` | Créer un user (email unique, mot de passe ≥ 12, ≥ 1 rôle) |
| PATCH | `/admin/users/:id` | Modifier nom/prenom/email |
| POST | `/admin/users/:id/desactiver` | est_actif=false. Auto-désactivation interdite. |
| POST | `/admin/users/:id/reactiver` | est_actif=true |
| POST | `/admin/users/:id/reset-password` | Génère mot de passe temporaire (14 chars). Mot de passe en clair retourné UNE SEULE FOIS dans la réponse. |
| POST | `/admin/users/:id/forcer-deconnexion` | Révoque tous les refresh_token actifs |
| GET | `/admin/users/:id/historique-connexion` | 50 dernières lignes audit_log LOGIN/LOGIN_FAILED/LOGOUT |

### 2.2 Gestion des rôles (`/admin/users/:id/roles`, USER.GERER)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/admin/users/:id/roles` | Lister les rôles actifs |
| POST | `/admin/users/:id/roles` | Attribuer un rôle (idempotent + réactive si inactif) |
| DELETE | `/admin/users/:id/roles/:fkRole` | Retirer (garde-fou ≥ 1 rôle obligatoire) |

### 2.3 Recherche serveur (`/users/recherche`, auth)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/users/recherche?q=...&limit=10` | ILIKE sur email/nom/prenom OR, est_actif=true, limite 1..50, tri alphabétique sur email |

## 3. Politique des mots de passe

- **Minimum 12 caractères** à la création (validation `class-validator`
  `@MinLength(12)` + double-check applicatif).
- Hash **bcrypt cost 10** (cohérent avec `BCRYPT_ROUNDS` configuré
  côté .env).
- **Reset administrateur** : génère un mot de passe **14 caractères**
  aléatoires depuis `crypto.randomBytes` sur l'alphabet
  `A-Z` + `a-z` + `2-9` + `!@#$%&*?` (les caractères
  `0/O/1/l/I` sont exclus pour faciliter la communication orale).
- **Sécurité absolue** : le mot de passe en clair n'est **JAMAIS**
  persisté, ni dans `audit_log`, ni dans les logs serveur. Il
  n'apparaît qu'une seule fois dans le corps HTTP de la réponse à
  l'admin qui a déclenché le reset, charge à lui de le communiquer
  au user de manière sécurisée.

## 4. Cumul de rôles (D2)

Un user peut avoir N rôles actifs simultanés via N lignes
`bridge_user_role` avec `est_actif=true`. La méthode
`PermissionsService.getEffectivePermissions` aplatit toutes les
permissions de tous les rôles → **UNION**.

Exemple validé par test :
```
SAISISSEUR (BUDGET.SAISIR, BUDGET.LIRE)
  +
VALIDATEUR (BUDGET.SOUMETTRE, BUDGET.VALIDER, BUDGET.LIRE)
  =
{ BUDGET.SAISIR, BUDGET.SOUMETTRE, BUDGET.VALIDER, BUDGET.LIRE }
```

Le user peut donc à la fois saisir ET valider une version (sur les
CR de son périmètre).

## 5. Garde-fous obligatoires

| # | Garde-fou | Implémentation |
|---|-----------|----------------|
| 1 | **Auto-désactivation interdite** | `desactiver()` lève `ForbiddenException` si `id === currentUser.userId` |
| 2 | **Au moins 1 rôle actif** | `retirerRole()` lève `BadRequestException` si la cible est le dernier rôle actif. Message : "Un utilisateur doit toujours avoir au moins un rôle actif. Attribuez un autre rôle avant de retirer celui-ci." |
| 3 | **Mot de passe ≥ 12 caractères** | DTO `@MinLength(12)` à la création. Reset produit toujours 14 chars. |
| 4 | **Mot de passe en clair JAMAIS dans audit_log** | Le `payload_apres` du `RESET_PASSWORD_USER` ne contient que `email` + `longueurMotDePasseGenere`. Le mot de passe n'apparaît que dans le corps HTTP de réponse. |
| 5 | **Email unique** | Index unique `uq_user_email` côté DB + check applicatif côté `creer()`/`modifier()` (409 Conflict si collision). |

## 6. Codes audit ajoutés (migration 053)

`1779200000140-AddRefTypeActionAdminUsers.ts` ajoute 8 codes à
`ref_type_action_audit` (idempotent — `ON CONFLICT (code) DO NOTHING`) :

| Code | Émetteur |
|------|----------|
| `CREER_USER` | UsersAdminService.creer |
| `MODIFIER_USER` | UsersAdminService.modifier |
| `DESACTIVER_USER` | UsersAdminService.desactiver |
| `REACTIVER_USER` | UsersAdminService.reactiver |
| `RESET_PASSWORD_USER` | UsersAdminService.resetPassword |
| `FORCER_DECONNEXION_USER` | UsersAdminService.forcerDeconnexion |
| `ATTRIBUER_ROLE` | UsersAdminService.attribuerRole |
| `RETIRER_ROLE` | UsersAdminService.retirerRole |

## 7. UI — page `/users` enrichie

> La page existait au Lot 1 en lecture seule. Elle est désormais
> opérationnelle avec toutes les actions admin. (Le mandat parlait
> de `/admin/utilisateurs` mais la route existante `/users` a été
> conservée pour ne pas casser les liens et la sidebar.)

### Capture (description du rendu — pas de browser dans la session)

Page `/users` (admin authentifié) :

```
┌──────────────────────────────────────────────────────────────────┐
│ Utilisateurs                                [+ Nouvel utilisateur]│
│ Création, modification, désactivation et gestion des rôles.      │
├──────────────────────────────────────────────────────────────────┤
│ Filtre email : [admin________]                                   │
│                                                                  │
│ ┌──────────┬────────┬─────────┬────────┬───────────────┬────────┐│
│ │ Email    │ Nom    │ Prénom  │ Statut │ Dern. connex. │Actions ││
│ ├──────────┼────────┼─────────┼────────┼───────────────┼────────┤│
│ │ admin@…  │ Admin  │ MIZNAS  │ Actif  │ 07/05/26 10:32│  ⋮     ││
│ │ adj.…@…  │ Diallo │ Amadou  │ Actif  │ 06/05/26 14:18│  ⋮     ││
│ │ dir.…@…  │ Sow    │ Aïcha   │ Actif  │ —             │  ⋮     ││
│ │ …                                                              ││
│ └──────────┴────────┴─────────┴────────┴───────────────┴────────┘│
└──────────────────────────────────────────────────────────────────┘

Menu ⋮ par ligne :
  • Modifier
  • Gérer les rôles
  • Réinitialiser le mot de passe
  • Forcer la déconnexion
  • Voir l'historique de connexion
  ──────────────────────
  • Désactiver  (grisé pour son propre compte → "(interdit pour soi-même)")
  • Réactiver   (à la place de Désactiver si user inactif)
```

### Dialogues

- **« Nouvel utilisateur »** : email + prénom/nom + mot de passe
  initial (≥ 12 chars) + multi-select des 6 rôles. Bouton « Créer »
  désactivé tant que la validation ne passe pas.
- **« Modifier »** : édition des champs principaux. Mot de passe
  géré séparément.
- **« Réinitialiser le mot de passe »** : 2 étapes — confirmation
  puis modal avec le mot de passe généré + bouton Copier + message
  "Communiquez ce mot de passe à l'utilisateur de manière
  sécurisée. **Il ne sera plus affiché.**"
- **« Forcer la déconnexion »** : confirmation `window.confirm`
  puis appel API.
- **« Rôles de … »** : modale avec liste des rôles actifs en
  badges (X par badge pour retirer + window.confirm), dropdown
  « Ajouter un rôle » filtrant les déjà-attribués, bouton Ajouter.
- **« Historique de connexion »** : modale large avec tableau des
  50 dernières lignes audit (date / type / statut / IP /
  user-agent).

## 8. Composant `UserAutocomplete` réutilisable

`src/components/common/UserAutocomplete.tsx` (frontend) — recherche
serveur avec debounce 300 ms, dropdown ≤ 10 résultats, exclusion
paramétrable (`excludeUserIds`), badge sélectionné avec bouton
« Changer ».

Migration appliquée : `CreerDelegationDialog` (Lot 4.2) utilisait
une liste fixe `listUsers({limit:100})` (Lot 4.2-fix3). Remplacée
par `<UserAutocomplete excludeUserIds={[currentUserId]} />` →
scale > 100 users actifs.

## 9. Dette RBAC consolidée (ADMIN.D)

| # | Dette héritée Lot 4 | Statut | Détail |
|---|--------------------|--------|--------|
| 1 | RBAC grille saisie : VALIDATEUR sans BUDGET.SAISIR ne pouvait pas consulter | ✅ DÉJÀ CORRECT | `GET /budget/grille` est sous `BUDGET.LIRE` (cf. `budget-grille.controller.ts:40`). Commentaire ajouté pour documenter le choix. |
| 2 | Rafraîchissement zone "Affectations actuelles" après création | ✅ DÉJÀ CORRECT | `AffectationsDialog.handleAjouter` refetch via `listerPerimetresUser` après succès. Commentaire ajouté. |
| 3 | Bouton "Ajouter" reste actif après échec API | ✅ DÉJÀ CORRECT | `disabled={!peutAjouter || submitting}` + `setSubmitting(false)` dans `finally`. Comportement attendu (réessai possible après échec). Commentaire ajouté. |
| 4 | Cumul de rôles non testé | ✅ TESTS AJOUTÉS | Test backend `permissions.service.spec.ts > cumul rôles : 2 bridge_user_role actifs → permissions = UNION` + tests UI cumul SAISISSEUR + VALIDATEUR dans `CreerUserDialog.test.tsx`. |

## 10. Tests

| Périmètre | Avant | Lot Admin | Total |
|-----------|-------|-----------|-------|
| Backend | 931 | +35 (CRUD 20 + Controller 10 + recherche 4 + cumul 1) | **966** ≥ 961 ✓ |
| Frontend | 414 | +18 (Autocomplete 4 + CreerUser 5 + ResetPwd 3 + GererRoles 3 + UsersPage 3) | **432** ≥ 432 ✓ |
| **Cumulé** | 1345 | +53 | **1398** verts, 0 régression |

## 11. Risques résiduels / dette ajoutée

- **Pas d'email automatique sur reset password** — l'admin doit
  communiquer le mot de passe temporaire manuellement (mandat
  acceptait l'implémentation minimale "juste l'audit"). Ajout
  possible du template `user.password_reset` quand l'usage le
  prouve.
- **Pas d'expiration forcée des mots de passe temporaires** —
  techniquement le user peut continuer à utiliser le mot de passe
  temporaire indéfiniment. À terme : flag `mot_de_passe_temporaire`
  + écran de changement obligatoire à la première connexion (Lot
  Sécurité dédié).
- **Pas d'IP rate-limit sur l'endpoint recherche** — `/users/recherche`
  est ouvert à tout user authentifié, sans cap à la minute. Risque
  faible (résultats limités à 10) mais pourrait être ajouté si
  besoin.
- **Page `/users` historique côté UI** : route inchangée (le
  mandat parlait de `/admin/utilisateurs` mais la route existante
  est conservée pour ne pas casser les liens internes/sidebar).
  Renommage cosmétique possible plus tard.
- **Pas de page de détail user dédiée** — toutes les actions
  passent par le menu kebab + modales. Si on veut une fiche
  `/admin/users/:id` complète (perm effectives + historique 6
  mois + tableau de bord activité), c'est un lot UX dédié.
