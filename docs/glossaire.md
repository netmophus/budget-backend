# Glossaire — MIZNAS

> Glossaire vivant. Enrichi au fil des lots du MVP. Toute entrée
> doit citer une référence vérifiable (specs, code, docs internes).
> Pas de définition inventée.

---

## Référentiels réglementaires

| Terme | Définition | Référence |
|---|---|---|
| Bâle II/III UMOA | Dispositif prudentiel régional appliqué aux établissements UMOA, transposé par la Décision n°013/24/06/2016 de la BCEAO. | `roadmap-mvp.md` §Lot 5 |
| BCEAO | Banque Centrale des États de l'Afrique de l'Ouest. Émettrice du FCFA, autorité monétaire et superviseur prudentiel. | `architecture.md` §1.4 |
| Commission Bancaire de l'UMOA | Autorité régionale de supervision des établissements bancaires assujettis. | `architecture.md` §1.4 |
| FCFA / XOF | Franc CFA BCEAO. Devise pivot du module pour la consolidation. Code ISO 4217 : `XOF`. | `modele-donnees.md` §3.8 |
| PCB UMOA | Plan Comptable Bancaire de l'Union Monétaire Ouest-Africaine. Nomenclature comptable des banques de la zone. | `modele-donnees.md` §3.4 |
| UEMOA | Union Économique et Monétaire Ouest-Africaine, regroupant 8 États (Bénin, Burkina, Côte d'Ivoire, Guinée-Bissau, Mali, Niger, Sénégal, Togo). | `README.md` §1 |
| UMOA | Union Monétaire Ouest-Africaine. Sous-ensemble de l'UEMOA partageant le FCFA et la BCEAO. | `modele-donnees.md` |

## Modèle dimensionnel

| Terme | Définition | Référence |
|---|---|---|
| Business key | Code stable inter-versions d'une dimension (ex. `code_compte`, `code_structure`). Sert de jointure logique. | `modele-donnees.md` §6.4 |
| Écrasement intra-jour | Modification SCD2 d'une dimension dans la même journée que la version courante actuelle ; le service met à jour la ligne du jour en place plutôt que de créer une nouvelle version (évite l'intervalle 0-day). `audit_log` capte `modeMaj='ecrasement_intra_jour'`. | `scd2-pattern.md` §7 |
| Index partiel | Index PostgreSQL avec clause `WHERE` (ex. `uq_dim_devise_pivot WHERE est_devise_pivot = true`). Non inférable par TypeORM, à ajouter manuellement. | `conventions.md` §5.2.2 |
| Ligne sentinelle "NA" | Ligne fixe `id=0` ou `id=-1` insérée dans une dimension pour gérer les FK obligatoires côté `fait_*` quand l'attribut n'est pas renseigné. | `architecture.md` §12 ADR |
| PCB UMOA Révisé | Version révisée du Plan Comptable Bancaire UMOA, transposition régionale IFRS appliquée depuis 2018. Nomenclature et hiérarchie utilisées par `dim_compte`. À ne pas confondre avec le PCB UMOA originel (avant 2018). | `modele-donnees.md` §3.4 |
| SCD2 | Slowly Changing Dimension type 2 — historisation des attributs structurants : nouvelle ligne pour chaque changement, intervalles `[date_debut, date_fin)` disjoints et contigus. | `modele-donnees.md` §6, `scd2-pattern.md` |
| SCD2 hiérarchique auto-référencée | Dimension SCD2 dont une colonne FK pointe vers la même table (ex. `fk_structure_parent` dans `dim_structure`). Validation applicative anti-cycle requise (cf. `validateNoCycle`). | `modele-donnees.md` §3.2, `scd2-pattern.md` |
| SCD2 plat | Dimension SCD2 sans hiérarchie : pas de FK auto-référente, pas de niveau, pas de relink. Pattern simplifié appliqué à `dim_segment` au MVP (Option A retenue). Si une hiérarchie devient nécessaire en V2, ajout non cassant via `fk_segment_parent` + `niveau`. | `modele-donnees.md` §3.7, `scd2-pattern.md` |
| Star schema | Modèle dimensionnel en étoile : faits centraux entourés de dimensions reliées par FK. | `modele-donnees.md` §1 |
| Stratégie A pour FK SCD2-vers-SCD2 | La FK pointe vers la version courante de la dimension cible et est mise à jour automatiquement quand la dimension cible reçoit une nouvelle version SCD2 — lien « vivant ». Implémentée via hook applicatif (cf. `relinkAfterStructureRevision`), pas via trigger. | `scd2-pattern.md` §8 |
| Surrogate key | Identifiant technique (`id bigint generated always`). Change à chaque nouvelle version SCD2 ; à ne pas utiliser comme jointure logique. | `modele-donnees.md` §6.4 |

## Comptable et budgétaire

| Terme | Définition | Référence |
|---|---|---|
| CDC | Centre de coût. Type de CR pour les fonctions support sans génération de chiffre d'affaires (ex. Fonctions Branche). | `modele-donnees.md` §3.3 |
| CDP | Centre de profit. Type de CR pour les unités opérationnelles produisant du chiffre d'affaires (ex. agences, directions retail/corporate). | `modele-donnees.md` §3.3 |
| CDR | Centre de revenu. Type de CR pour les unités génératrices de revenu sans charges substantielles. Distinction CDC/CDP/CDR à formaliser au Lot 4 avec le contrôle de gestion. | `modele-donnees.md` §3.3 |
| Centre de responsabilité (CR) | Maille de saisie budgétaire principale rattachée à la structure organisationnelle. | `modele-donnees.md` §3.3 |
| Code poste budgétaire | Tag analytique libre porté par `dim_compte.code_poste_budgetaire` permettant de regrouper plusieurs comptes PCB sous un même poste budgétaire (ex. `MASSE_SALARIALE` agrège les comptes 611100, 611200, 611300). Chaîne libre au Lot 2 ; à figer en énumération validée au Lot 4 avec le contrôle de gestion. | `modele-donnees.md` §3.4 |
| Compte collectif vs compte de mouvement | Distinction fonctionnelle PCB : un **compte collectif** (`est_compte_collectif = true`) regroupe ses enfants comptablement (sommes de soldes) — typiquement les niveaux 1-3. Un **compte de mouvement** (`est_compte_collectif = false`) est une feuille où portent les écritures réelles — typiquement le niveau 4. Sert à filtrer la saisie budgétaire et le reporting. | `modele-donnees.md` §3.4 |
| Compte porteur d'intérêts | Compte (PCB) ou produit dont la flag `est_porteur_interets = true`. Sert d'inclusion automatique dans les calculs MNI (Marge Nette d'Intérêt) et TIE (Taux d'Intérêt Effectif) au Lot 4. Présent à la fois sur `dim_compte` (côté comptable) et sur `dim_produit` (côté commercial). | `modele-donnees.md` §3.4, §3.6 |
| Devise pivot | Devise de consolidation du module. XOF par convention régionale. Exactement une ligne pivot dans `dim_devise`. | `modele-donnees.md` §3.8 |
| Exercice fiscal | Année comptable de rattachement. UEMOA = exercice civil (1er janvier — 31 décembre). | `modele-donnees.md` §3.1 |
| Jour ouvré | Jour bancaire hors week-ends et hors 4 fériés régionaux UEMOA fixes (1er janvier, 1er mai, 1er août, 25 décembre). | `modele-donnees.md` §3.1 |
| Ligne métier | Axe d'activité bancaire : retail, corporate, treasury, marchés. | `modele-donnees.md` §3.5 |
| Segment | Axe clientèle : particulier, professionnel, PME, grande entreprise, institutionnel, secteur public. | `modele-donnees.md` §3.7 |

## Indicateurs financiers

> Section à enrichir aux Lots 4-5 quand les modules PNB / Charges /
> Reporting seront codés. Les définitions précises (TIE, MNI, etc.)
> seront figées avec le référent contrôle de gestion à ce moment.

| Terme | Définition (provisoire) | Référence |
|---|---|---|
| Coefficient d'exploitation | Ratio charges / PNB. Indicateur de productivité. À formaliser au Lot 4. | `roadmap-mvp.md` §Lot 4 |
| Encours moyen | Moyenne des encours sur la période, base de calcul de la MNI. À formaliser au Lot 4. | `roadmap-mvp.md` §Lot 4 |
| MNI | Marge Nette d'Intérêt. Produits d'intérêts − charges d'intérêts par produit / segment. À formaliser au Lot 4. | `roadmap-mvp.md` §Lot 4 |
| PNB | Produit Net Bancaire. Bloc majeur du compte de résultat. À formaliser au Lot 4. | `roadmap-mvp.md` §Lot 4 |
| RBE | Résultat Brut d'Exploitation. À formaliser au Lot 4. | `roadmap-mvp.md` §Lot 4 |
| RNE | Résultat Net d'Exploitation. À formaliser au Lot 4. | `roadmap-mvp.md` §Lot 4 |
| TIE | Taux d'Intérêt Effectif sur encours porteurs. Définition exacte à figer dès J+1 du Lot 4 avec le métier. | `roadmap-mvp.md` §Lot 4 |

## Prudentiel

> Section à enrichir au Lot V2 (module G — Capital Planning, hors
> MVP). Les calculs réglementaires précis seront documentés alors.

| Terme | Définition (provisoire) | Référence |
|---|---|---|
| CET1 | Common Equity Tier 1. Fonds propres de meilleure qualité. À formaliser en V2. | `roadmap-mvp.md` §Modules différés |
| LCR | Liquidity Coverage Ratio. Ratio de liquidité court terme (30 jours) calculé en projection. | `roadmap-mvp.md` §Lot 5 |
| NSFR | Net Stable Funding Ratio. Ratio de financement stable (1 an) calculé en projection. | `roadmap-mvp.md` §Lot 5 |
| RWA | Risk-Weighted Assets. Encours pondérés par les risques, base du ratio de solvabilité. | `roadmap-mvp.md` §Modules différés |

## Sécurité applicative

| Terme | Définition | Référence |
|---|---|---|
| @Auditable | Décorateur Nest méthode/classe portant `{ typeAction, entiteCible, extractIdCible? }`. Déclenche `AuditInterceptor` qui pose une ligne `audit_log` (statut success/failure). | `audit.md` |
| JWT | JSON Web Token. Access token signé HMAC porté par le client en `Authorization: Bearer …`. Stateless. | `architecture.md` §12 ADR |
| Méta-audit `LIRE_AUDIT` | Toute consultation du journal d'audit par un utilisateur réel produit elle-même une ligne `audit_log` de type `LIRE_AUDIT`. | `audit.md` |
| Périmètre RBAC | Couple `(perimetre_type, perimetre_id)` porté par `bridge_user_role`. Permet de restreindre un rôle à une entité juridique ou un CR (anticipation Lot 2+). | `architecture.md` §12 ADR |
| RBAC | Role-Based Access Control. Modèle utilisateurs → rôles → permissions, contrôlé par `PermissionsGuard` global. | `architecture.md` §4.3 |
| Refresh token rotation | À chaque usage du refresh token, un nouveau couple est émis et l'ancien est révoqué. La réutilisation d'un refresh révoqué entraîne la révocation forcée de tous les refresh actifs de l'utilisateur. | `architecture.md` §12 ADR |
