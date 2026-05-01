# Smoke test — Lot 2.5-bis (Référentiels secondaires paramétrables)

> Checklist de validation manuelle bout-en-bout à exécuter après chaque
> déploiement du Lot 2.5-bis. Tous les chemins critiques de la
> paramétrisation des 13 référentiels y sont couverts.

## Pré-requis

- Backend lancé sur `:3001`, frontend sur `:5173`.
- Base PostgreSQL fraîche avec les **41 migrations** appliquées
  (`npm run migration:show` doit afficher 41 lignes en green).
- Seeds exécutés (au minimum `seed:auth` + les seeds initiaux Lot 2).
- Comptes de démo : `admin@miznas.local` / `ChangeMe!2026` et
  `lecteur@miznas.local` / `Lecteur!2026`.

## Checklist (13 points)

- [ ] **Login admin** réussi sur `http://localhost:5173/login`.
- [ ] **Sidebar** affiche la section CONFIGURATION (icône Settings)
      sous BUDGET, avec l'entrée « Configuration ».
- [ ] `/configuration?ref=type-structure` : navigation latérale
      affiche les 5 catégories ; le tableau de droite liste
      **5 valeurs** (entite_juridique, branche, direction, departement,
      agence) toutes en badge **Système** sauf agence.
- [ ] `/configuration?ref=pays` : tableau liste les **9 valeurs**
      (BEN, BFA, CIV, GNB, MLI, NER, SEN, TGO + autre).
- [ ] **Création** d'une valeur custom (ex. code `succursale`, libellé
      `Succursale`, ordre 60) sur `ref_type_structure` : toast vert
      « valeur créée », ligne ajoutée dans le tableau, count en
      sidebar passe à 6.
- [ ] **Édition** d'une valeur système (ex. `entite_juridique`) :
      drawer ouvert, bandeau bleu « Valeur système — code immuable »
      visible, champ Code grisé, modification du libellé possible →
      toast succès.
- [ ] **DELETE valeur référencée** (ex. `agence` qui a au moins une
      `dim_structure` rattachée) : modale confirmation, click
      Supprimer → toast erreur **409** clair (« Valeur référencée par
      X dimensions »).
- [ ] **Toggle désactivation** d'une valeur active (ex. la nouvelle
      `succursale`) : modale confirmation, click Désactiver → toast
      succès, ligne grisée avec badge **Inactif**.
- [ ] **Toggle réactivation** : click Réactiver sur la même ligne →
      toast succès, ligne redevient **Actif**.
- [ ] **DELETE valeur custom non référencée** (la nouvelle
      `succursale` désactivée) : modale, confirmation → toast succès,
      ligne disparaît, count repasse à 5.
- [ ] **Sélecteur dynamique** : créer à nouveau `succursale` puis
      ouvrir `/referentiels/structures` → bouton « + Nouvelle
      structure » → le select **Type** affiche `succursale` (peut
      nécessiter un F5 si dans la fenêtre TTL cache 60s).
- [ ] **Bandeau valeur désactivée** : depuis `/configuration`,
      désactiver `agence` → revenir éditer une `dim_structure` de
      type `agence` → bandeau jaune **« ⚠ La valeur 'agence' a été
      désactivée dans Configuration »** visible dans le drawer.
- [ ] **LECTEUR** : déconnexion admin, reconnexion `lecteur` → la
      page `/configuration` reste accessible mais **aucun bouton
      d'action** (Nouvelle valeur / Modifier / Toggle / Supprimer)
      n'est visible. La nav latérale et les filtres restent
      utilisables.

## Cleanup

Si la checklist crée des valeurs custom de test (ex. `succursale`),
les supprimer en fin de validation pour ne pas polluer la base.

## En cas d'échec

Si une case ne passe pas, ne pas patcher en local : ouvrir un ticket
en référence à ce document, en notant le numéro de la case et le
message d'erreur exact (incluant le code HTTP si toast 4xx/5xx).
