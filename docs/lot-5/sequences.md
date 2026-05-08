# Lot 5 — Diagrammes de séquence

> Compagnon visuel des 4 flux principaux du module **Exécution**.
> Tous les diagrammes sont en mermaid (rendus directement par
> GitHub).

## 1. Saisie + validation d'une ligne réalisé (Lot 5.1)

Cycle 2 statuts unidirectionnel `IMPORTE → VALIDE`.

```mermaid
sequenceDiagram
  autonumber
  actor SAI as Saisisseur (Amadou)
  actor VAL as Validateur (Aïcha)
  participant FR as RealiseController
  participant SVC as RealiseService
  participant PER as PerimetreService
  participant AUD as AuditService
  participant DB as Postgres

  SAI->>FR: POST /realise (montant, fk_compte, fk_temps, ...)
  FR->>PER: assertEcritureAutorisee(crId, userId)
  PER-->>FR: ok (CR dans périmètre)
  FR->>SVC: creer(dto, user)
  SVC->>DB: INSERT fait_realise (statut=IMPORTE, source=SAISIE)
  SVC->>AUD: log(SAISIR_REALISE, payload)
  SVC-->>SAI: 201 + ligne créée

  Note over VAL: plus tard...

  VAL->>FR: POST /realise/valider {ids:[42]}
  FR->>SVC: validerEnLot(ids, user)
  SVC->>DB: UPDATE fait_realise SET statut='VALIDE',<br/>valide_le=NOW(), fk_valide_par=$1<br/>WHERE id IN (...) AND statut='IMPORTE'
  SVC->>AUD: log(VALIDER_REALISE, {ids, count})
  SVC-->>VAL: 200 {nbValidees: 1}
```

**Points clés** :
- Filtrage périmètre **uniquement à l'écriture** (saisie + import) ;
  la lecture est transverse (cf. décision ADMIN.D).
- La validation n'est pas réversible (Q4 produit Lot 5.1) — pas de
  dévalidation, le seul moyen de corriger une ligne validée est de
  créer une nouvelle ligne avec `mode=CORRECTION`.

## 2. Import Excel/CSV de réalisé en lot (Lot 5.1.B)

```mermaid
sequenceDiagram
  autonumber
  actor SAI as Saisisseur
  participant FR as RealiseController
  participant IMP as RealiseImportService
  participant PAR as XlsxParser
  participant PER as PerimetreService
  participant AUD as AuditService
  participant DB as Postgres

  SAI->>FR: POST /realise/import (multipart .xlsx)
  FR->>IMP: importer(file, user)
  IMP->>PAR: parse(buffer)
  PAR-->>IMP: rows[] (50)
  loop pour chaque ligne
    IMP->>PER: assertEcritureAutorisee(crId, userId)
    alt CR autorisé
      IMP->>DB: INSERT fait_realise (source=IMPORT)
      IMP-->>IMP: rapport.nbCrees++
    else hors-périmètre / erreur DTO
      IMP-->>IMP: rapport.rejets.push({ligne, motif})
    end
  end
  IMP->>AUD: log(IMPORTER_REALISE, {nbCrees, nbRejets, fichier})
  IMP-->>SAI: 200 {rapport}
```

**Points clés** :
- 1 seule entrée audit par fichier (pas par ligne) — le rapport
  granulaire vit dans le payload.
- Les lignes invalides sont **ignorées** (pas de rollback global) ;
  l'utilisateur corrige et réimporte uniquement les rejetées.

## 3. Génération du tableau de bord budget vs réalisé (Lot 5.2)

```mermaid
sequenceDiagram
  autonumber
  actor CTRL as Contrôleur de gestion
  participant TBC as TableauBordController
  participant ANA as AnalyseEcartsService
  participant DB as Postgres
  participant XLSX as ExportExcelService

  CTRL->>TBC: GET /tableau-de-bord/budget-vs-realise<br/>?versionId=...&scenarioId=...&moisDebut=...
  TBC->>ANA: getBudgetVsRealise(filtres, user)
  ANA->>DB: 1 requête LEFT JOIN<br/>fait_budget × fait_realise (statut=VALIDE)
  DB-->>ANA: rows (12 mois × N grain)
  loop pour chaque row
    ANA-->>ANA: classeToNature(c.classe)<br/>+ niveauAlerteFor(ecart, seuils)<br/>+ sensEcartFor(nature, ecart)
  end
  ANA-->>TBC: {filtres, kpi, lignes[]}
  TBC-->>CTRL: 200 EcartsResponseDto

  Note over CTRL: si export demandé...

  CTRL->>TBC: GET .../export
  TBC->>ANA: getBudgetVsRealise(...)
  TBC->>XLSX: genererXlsx(ecarts, versionId)
  XLSX-->>XLSX: 3 onglets + couleurs<br/>conditionnelles colonne Niveau
  XLSX-->>TBC: Buffer .xlsx
  TBC-->>CTRL: 200 + Content-Disposition: attachment
```

**Points clés** :
- 1 seule passe SQL avec `LEFT JOIN` sur `fait_realise statut='VALIDE'`
  pour avoir les lignes `MANQUANT` (budget existe, pas de réalisé)
  sans 2e requête.
- Permission **double** `BUDGET.LIRE ∧ REALISE.LIRE` via
  `@RequirePermissions({ all: [...] })` (Lot 5.2-fix2).

## 4. Lancement reforecast trimestriel + workflow + écrasement (Lot 5.3)

```mermaid
sequenceDiagram
  autonumber
  actor CTRL as Contrôleur (BUDGET.REFORECAST_LANCER)
  actor VAL as Validateur
  actor PUB as Publicateur
  participant RFC as ReforecastController
  participant RFS as ReforecastService
  participant VWS as VersionWorkflowService
  participant AUD as AuditService
  participant DB as Postgres

  Note over CTRL,DB: Phase 1 — lancement (transaction unique)

  CTRL->>RFC: POST /reforecast/lancer (dto)
  RFC->>RFS: lancer(dto, user)
  RFS->>DB: SELECT version_source (gele ?)<br/>+ scenario actif ?<br/>+ ≥ 1 fait_realise VALIDE T<sub>cons</sub> ?
  RFS->>DB: SELECT reforecast ACTIVE même clé ?
  alt reforecast existant
    RFS->>DB: UPDATE dim_version SET statut_publication='OBSOLETE'<br/>WHERE id=$old
    RFS->>AUD: log(MARQUER_REFORECAST_OBSOLETE)
  end
  RFS->>DB: INSERT dim_version (type=reforecast, statut=ouvert,<br/>statut_publication=ACTIVE)
  RFS->>DB: INSERT fait_budget × N (extrapolation selon méthode)
  RFS->>AUD: log(LANCER_REFORECAST, {nbLignes, reforecastObsolete})
  RFS-->>CTRL: 201 ReforecastResponseDto

  Note over CTRL,DB: Phase 2 — workflow (codes audit *_REFORECAST polymorphes)

  CTRL->>RFC: POST /reforecast/:id/soumettre
  RFC->>VWS: soumettre(id, dto, user)
  VWS->>DB: UPDATE statut='soumis'
  VWS->>AUD: log(SOUMETTRE_REFORECAST)
  VWS-->>CTRL: 200

  VAL->>RFC: POST /reforecast/:id/valider
  RFC->>VWS: valider(id, dto, user)
  VWS->>AUD: log(VALIDER_REFORECAST)

  PUB->>RFC: POST /reforecast/:id/publier
  RFC->>VWS: publier(id, dto, user)
  VWS->>DB: UPDATE statut='gele', date_gel=NOW()
  VWS->>AUD: log(PUBLIER_REFORECAST)
```

**Points clés** :
- **Décision Q1 (écrasement)** : pas de chaînage de versions.
  L'ancien reforecast ACTIVE est marqué OBSOLETE de manière
  définitive ; aucune transition workflow n'est possible après.
- **Décision Q2 (réutilisation)** : pas de table `fait_reforecast`,
  on réutilise `dim_version type='reforecast'` + `fait_budget`.
- **Codes audit polymorphes** : `VersionWorkflowService` détecte
  `type_version='reforecast'` et émet `*_REFORECAST` à la place de
  `*_BUDGET` (1 service partagé, 0 duplication).

## 5. Origine d'une ligne fait_budget reforecast

Synthèse côté UI : la grille affiche un badge sur chaque cellule.

```mermaid
flowchart LR
  Cell[Cellule reforecast<br/>mois M, compte C, CR R] --> Q{trimestre M<br/>≤ trimestre_consolide ?}
  Q -- oui --> RE["Origine = REALISE<br/><i>montant repris du fait_realise<br/>statut=VALIDE</i>"]
  Q -- non --> M{methode_extrapolation}
  M -- MOYENNE_TRIMESTRE --> EX1["Origine = EXTRAPOLATION<br/><i>moyenne T<sub>cons</sub> par<br/>(CR, compte, ligne_metier, devise)</i>"]
  M -- BUDGET_INITIAL --> EX2["Origine = EXTRAPOLATION<br/><i>copie montant_fcfa source</i>"]
  M -- MANUELLE --> MA["Origine = MANUEL<br/><i>0 — à saisir</i>"]
```
