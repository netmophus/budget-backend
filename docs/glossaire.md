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
| Index partiel | Index PostgreSQL avec clause `WHERE` (ex. `uq_dim_devise_pivot WHERE est_devise_pivot = true`). Non inférable par TypeORM, à ajouter manuellement. | `conventions.md` §5.2.2 |
| Ligne sentinelle "NA" | Ligne fixe `id=0` ou `id=-1` insérée dans une dimension pour gérer les FK obligatoires côté `fait_*` quand l'attribut n'est pas renseigné. | `architecture.md` §12 ADR |
| SCD2 | Slowly Changing Dimension type 2 — historisation des attributs structurants : nouvelle ligne pour chaque changement, intervalles `[date_debut, date_fin)` disjoints et contigus. | `modele-donnees.md` §6, `scd2-pattern.md` |
| Star schema | Modèle dimensionnel en étoile : faits centraux entourés de dimensions reliées par FK. | `modele-donnees.md` §1 |
| Surrogate key | Identifiant technique (`id bigint generated always`). Change à chaque nouvelle version SCD2 ; à ne pas utiliser comme jointure logique. | `modele-donnees.md` §6.4 |

## Comptable et budgétaire

| Terme | Définition | Référence |
|---|---|---|
| Centre de responsabilité (CR) | Maille de saisie budgétaire principale rattachée à la structure organisationnelle. | `modele-donnees.md` §3.3 |
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
