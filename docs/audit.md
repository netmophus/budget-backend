# Audit applicatif — MIZNAS

Piste d'audit métier **réglementaire** du module budgétaire bancaire UEMOA.
À ne pas confondre avec les logs techniques Pino (HTTP, erreurs serveur,
debug — volatiles).

- Table : `audit_log` (cf. `docs/modele-donnees.md` §5.4)
- Conservation : **10 ans** (cf. §10.3 des spécifications V1.0)
- Endpoint de consultation : `GET /api/v1/audit-logs` (permission `AUDIT.LIRE`)
- Aucune route d'écriture exposée (POST/PATCH/DELETE).

---

## Table `type_action`

| Code | Quand est-il déclenché ? | Statut(s) | Payload typique |
|---|---|---|---|
| `LOGIN` | Après une authentification réussie. | success | `idCible = user.id`, IP + UA |
| `LOGIN_FAILED` | Mauvais mot de passe **ou** email inconnu (message générique côté client). | failure | `utilisateur` = email tenté ou `anonymous`, commentaire = motif générique |
| `LOGOUT` | À l'appel de `POST /api/v1/auth/logout`. | success | commentaire = `"Logout ciblé."` ou `"Logout global."` |
| `REFRESH` | Rotation réussie d'un refresh token. | success | `idCible = user.id` |
| `REFRESH_FORCED_REVOCATION` | Réutilisation détectée d'un refresh déjà révoqué → révocation forcée de **tous** les refresh actifs de l'utilisateur. | failure | commentaire détaillé (motif initial du refresh d'origine), `utilisateur = system` (l'attaquant n'est pas authentifié) |
| `PERMISSION_DENIED` | Refus du `PermissionsGuard` (permissions insuffisantes). | failure | commentaire = `"Requis: [...] (mode=any\|all). URL: METHOD /chemin."` |
| `CREATE` / `UPDATE` / `DELETE` | Endpoints décorés `@Auditable({ typeAction: ... })` — sur opérations métier. | success ou failure | body sanitisé, idCible si extracteur fourni |
| `VALIDATE` | Validation métier (ex. version budget). | success ou failure | (à venir aux Lots 3+) |
| `FREEZE` | Gel d'une version (irréversible). | success ou failure | (à venir au Lot 3) |
| `SOUMETTRE_BUDGET` | Préparateur soumet une version `dim_version` à validation (`statut: ouvert → soumis`). Permission `BUDGET.SOUMETTRE`. | success ou failure | `idCible = version.id`, commentaire de soumission (Lot 3.5) |
| `VALIDER_BUDGET` | Contrôleur valide une version soumise (`statut: soumis → valide`). Permission `BUDGET.VALIDER`. | success ou failure | `idCible = version.id`, commentaire (Lot 3.5) |
| `REJETER_BUDGET` | Contrôleur rejette une version soumise (`statut: soumis → ouvert`). Permission `BUDGET.VALIDER`. | success ou failure | `idCible = version.id`, motif obligatoire (Lot 3.5) |
| `PUBLIER_BUDGET` | Directeur publie/gèle une version validée (`statut: valide → gele`, alias DB : *geler*). Permission `BUDGET.PUBLIER`. **Action irréversible**. | success ou failure | `idCible = version.id`, conservation 10 ans BCEAO (Lot 3.5) |
| `AUTO_CREATE_SCENARIO` | Hook applicatif Q9 (Lot 3.2) : création automatique de `MEDIAN_<exercice>` déclenchée par la création d'une version pour un exercice fiscal sans scénario rattaché. Inséré dans la même transaction que la version. | success | `idCible = code_scenario` (ex. `MEDIAN_2027`), `payloadApres` contient `{ codeScenario, exerciceFiscal, declencheur: { type: 'creation_version', codeVersion } }`, `commentaire` détaille le déclencheur. |
| `EXPORT` / `IMPORT` | Transferts en masse (Excel, CSV). | success ou failure | `IMPORT` : première utilisation Lot 2.4A.2 sur `POST /referentiels/comptes/import` — `payloadApres` contient le rapport `ImportRapportDto` complet (totalLines, imported, updated, skipped, errors[]). Conservation 10 ans comme les autres types. `EXPORT` à venir Lots 5+. |
| `LIRE_AUDIT` | Méta-audit : un utilisateur (≠ `system`) consulte `/audit-logs`. | success | commentaire = filtres JSON appliqués |

---

## Sanitisation

Avant insertion, l'`AuditInterceptor` masque les valeurs des clés
suivantes par `***REDACTED***` (comparaison normalisée : minuscules
sans `_` ni `-`) :

`motdepasse`, `motdepassehash`, `password`, `passwordhash`, `accesstoken`,
`refreshtoken`, `token`, `jwt`, `secret`, `authorization`, `cookie`, `apikey`.

La fonction est récursive (objets imbriqués + tableaux).

Vérification SQL :

```sql
SELECT COUNT(*) FROM audit_log
WHERE payload_apres::text LIKE '%mot_de_passe%'
   OR payload_avant::text LIKE '%mot_de_passe%';
-- attendu : 0 ligne avec valeur en clair (uniquement '***REDACTED***')
```

---

## Pino vs `audit_log`

| Aspect | **Pino** (`nestjs-pino`) | **`audit_log`** |
|---|---|---|
| Nature | Logs **techniques** (HTTP, erreurs, perf, debug) | Piste d'audit **métier réglementaire** |
| Stockage | stdout / fichier — **volatile** | DB PostgreSQL — **persistée 10 ans** |
| Format | JSON en prod, pretty-print en dev | jsonb structuré + colonnes typées |
| Déclencheur | Toute requête HTTP (sauf `/health`) | Actions sensibles uniquement |
| Lecture | Par les outils d'observabilité ops | Par `GET /api/v1/audit-logs` (permission `AUDIT.LIRE`) |
| Modification | Écrase à la rotation des fichiers | **Inviolabilité attendue** (cf. infra) |

---

## Recommandation infra (avant production)

L'inviolabilité `audit_log` n'est pas garantie en dev (l'utilisateur
applicatif `postgres` est superuser et peut faire `UPDATE audit_log`).

**Avant la mise en production**, créer un rôle PostgreSQL dédié à
l'application avec des privilèges restreints sur `audit_log` :

```sql
-- Compte applicatif distinct du superuser
CREATE ROLE miznas_app LOGIN PASSWORD '<strong>';

-- Privilèges standards sur les autres tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO miznas_app;

-- Sur audit_log : INSERT uniquement, pas d'UPDATE ni de DELETE.
REVOKE UPDATE, DELETE ON audit_log FROM miznas_app;
GRANT INSERT, SELECT ON audit_log TO miznas_app;

-- Sur la séquence d'identité (PG génère un objet IDENTITY)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO miznas_app;
```

Ainsi, l'application ne peut qu'**ajouter** des lignes d'audit. La
purge des lignes >10 ans se fera via une procédure DBA distincte.

---

## Conservation et purge

- Politique : **10 ans** glissants à compter de `date_action`.
- Index `ix_audit_log_date_action` (DESC) supporte une purge périodique
  par tranche.
- Procédure de purge : à mettre en place lors du Lot 6 (stabilisation /
  industrialisation) — tâche cron sur un compte DBA distinct du compte
  applicatif.
