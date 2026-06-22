import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type TypeAction =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'REFRESH'
  | 'REFRESH_FORCED_REVOCATION'
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'VALIDATE'
  | 'FREEZE'
  | 'EXPORT'
  | 'IMPORT'
  | 'PERMISSION_DENIED'
  | 'LIRE_AUDIT'
  // Lot 3.2 — hook Q9 : création automatique de scénario
  | 'AUTO_CREATE_SCENARIO'
  // Lot 3.3 — saisie budgétaire en lot via grille
  | 'IMPORT_BUDGET'
  // Lot 3.5 — workflow de validation budgétaire (4 transitions)
  | 'SOUMETTRE_BUDGET'
  | 'VALIDER_BUDGET'
  | 'REJETER_BUDGET'
  | 'PUBLIER_BUDGET'
  // Lot 3.6 — refresh manuel de mv_indicateurs_budget
  | 'RECALCUL_INDICATEURS'
  // Lot 3.7 — import en masse depuis fichier CSV/XLSX
  | 'IMPORT_BUDGET_BULK'
  // Lot 4.1 — gestion des affectations multi-périmètres
  // Lot 4.1-fix2.B : renommés pour aligner sur le style verbe-sujet
  // (CREER_AFFECTATION / RETIRER_AFFECTATION) qui est cohérent avec
  // SOUMETTRE_BUDGET, VALIDER_BUDGET, etc.
  | 'CREER_AFFECTATION'
  | 'RETIRER_AFFECTATION'
  // Lot 4.2 (anticipation — codes seedés au Lot 4.1-fix2 pour éviter
  // une nouvelle migration au démarrage du 4.2)
  | 'CREER_DELEGATION'
  | 'REVOQUER_DELEGATION'
  | 'EXPIRER_DELEGATION'
  // Lot Administration — CRUD users + gestion des rôles depuis
  // l'UI admin. Codes ajoutés en base via migration 053
  // (1779200000140-AddRefTypeActionAdminUsers.ts).
  | 'CREER_USER'
  | 'MODIFIER_USER'
  | 'DESACTIVER_USER'
  | 'REACTIVER_USER'
  | 'RESET_PASSWORD_USER'
  | 'FORCER_DECONNEXION_USER'
  | 'ATTRIBUER_ROLE'
  | 'RETIRER_ROLE'
  // Lot 5.1 — Réalisé. Codes ajoutés en base via migration 054
  // (1779200000150-CreerFaitRealiseEtPermissions.ts).
  | 'IMPORTER_REALISE'
  | 'SAISIR_REALISE'
  | 'VALIDER_REALISE'
  | 'SUPPRIMER_REALISE'
  // Lot 5.3 — Reforecast trimestriel. Codes ajoutés en base via
  // migration 055 (1779200000160-AjoutReforecastTrimestriel.ts).
  | 'LANCER_REFORECAST'
  | 'SOUMETTRE_REFORECAST'
  | 'VALIDER_REFORECAST'
  | 'REJETER_REFORECAST'
  | 'PUBLIER_REFORECAST'
  | 'MARQUER_REFORECAST_OBSOLETE'
  // Lot 6.4 — Sécurisation des mots de passe. Codes en EN/UPPERCASE
  // pour cohérence avec les codes auth existants (LOGIN, LOGIN_FAILED,
  // RESET_PASSWORD_USER). Seedés via migration 1779200000190.
  | 'PASSWORD_CHANGED'
  | 'LOGIN_RATE_LIMITED'
  // Lot 6.5 — Notifications résiduelles. Codes en FR métier (cohérent
  // avec RESET_PASSWORD_USER admin du Lot Administration). Seedés via
  // migration 1779200000220.
  // 6.5.A — forgot password self-service.
  | 'DEMANDE_RESET_MDP_USER'
  | 'DEMANDE_RESET_MDP_INCONNU'
  | 'RESET_MDP_USER_VALIDE'
  | 'NETTOYAGE_RESET_TOKENS'
  // 6.5.B — rappel J-3 délégation.
  | 'DELEGATION_RAPPEL_J3'
  // Lot 7.6 — exports rapport R04 "Budget Publié BCEAO". Codes seedés
  // via migration 1779200000240 (AjouterCodesAuditExportR04).
  | 'EXPORT_R04_PDF'
  | 'EXPORT_R04_XLSX'
  // Lot 8.1.A — workflow signature documents officiels. Codes seedés
  // via migration 1779200000300 (AjouterPermissionsEtCodesAuditLot81A).
  | 'CREER_DOCUMENT'
  | 'EDITER_DOCUMENT'
  | 'SOUMETTRE_DOCUMENT_VISA'
  | 'VISER_DOCUMENT'
  | 'REJETER_DOCUMENT'
  | 'SIGNER_DOCUMENT'
  // Lot 8.5.E — alerte mensuelle écarts réalisé. Code seedé via
  // migration 1779200000410 (AjouterCodeAuditAlerteEcart). Cron du
  // 5 du mois à 06h00, 1 ligne par exécution (récap destinataires +
  // compteurs ATTENTION/CRITIQUE), `id_cible` = mois M-1 (YYYY-MM).
  | 'ALERTE_ECART_REALISE_ENVOYEE'
  // Lot 8.6.A — analyse MIZNAS AI du dashboard Budget vs Réalisé.
  // Code seedé via migration 1779200000420 (CreerPermissionAiEtCodeAudit).
  // 1 ligne par appel POST /tableau-de-bord/analyse-ai contenant
  // un récap (filtres, modèle, tokens, durée). Le prompt et la
  // réponse Claude ne sont PAS persistés (volatile côté client).
  // ATTENTION cf hotfix Lot 8.5.E, ne pas insérer de point-virgule
  // dans ce commentaire (regex CI fragile).
  | 'AI_ANALYSE_DEMANDEE'
  // Lot 8.6.B — export PDF du tableau de bord Budget vs Réalisé.
  // Code seedé via migration 1779200000430. 1 ligne par appel
  // POST /tableau-de-bord/export-pdf contenant codeVersion,
  // codeScenario, periode, nbLignesAnalysees, avecAnalyseIa,
  // modeleIa, tailleOctets, dureeMs. Le PDF est streamé directement
  // au client, jamais persisté côté serveur. Pas de point-virgule
  // dans ce commentaire (regex CI fragile cf hotfix Lot 8.5.E).
  | 'EXPORT_PDF_TABLEAU_BORD'
  // Lot 8.7.A — edition du referentiel calendrier (dim_temps). Codes
  // seedes via migration 1779200000450 (AjouterCodesAuditCalendrier).
  // MODIFIER_JOUR_CALENDRIER = PATCH d'un jour (id_cible = id du jour)
  // ETENDRE_CALENDRIER = POST d'extension d'annees (id_cible = null)
  // Pas de point-virgule dans ce commentaire (regex CI fragile)
  | 'MODIFIER_JOUR_CALENDRIER'
  | 'ETENDRE_CALENDRIER'
  // Lot workflow par CR — transitions CR + soumission au Comite
  // Codes seedes en base via migration 1779200000500
  | 'SOUMETTRE_CR'
  | 'VALIDER_CR'
  | 'REJETER_CR'
  | 'ROUVRIR_CR'
  | 'SOUMETTRE_COMITE'
  // Lot workflow par CR palier 3 — automation version + snapshot
  // Codes seedes en base via migration 1779200000510
  | 'PRE_VALIDER_VERSION'
  | 'REOUVRIR_VERSION'
  | 'INIT_SNAPSHOT_CR'
  | 'RETIRER_CR_SNAPSHOT'
  // Mini-PR transitions Comite — sortie du statut soumis_comite
  // Codes seedes en base via migration 1779200000530
  // APPROUVER_COMITE = soumis_comite -> valide (approbation Comite)
  // DEMANDER_REVISION_COMITE = soumis_comite -> ouvert + CR cible rouvert
  // Pas de point-virgule dans ce commentaire (regex CI fragile)
  | 'APPROUVER_COMITE'
  | 'DEMANDER_REVISION_COMITE'
  // Fix verrou import — tentative d import sur un CR SOUMIS/VALIDE refusee
  // Code seede en base via migration 1779200000540
  // Trace la liste des CR bloquants pour audit de securite metier
  // Pas de point-virgule dans ce commentaire (regex CI fragile)
  | 'IMPORT_BUDGET_BLOQUE_CR'
  // Durcissement snapshot CR — reintegration d un CR retire du snapshot
  // Code seede en base via migration 1779200000550
  // Action Coordinateur inverse de RETIRER_CR_SNAPSHOT (actif false vers true)
  // Pas de point-virgule dans ce commentaire (regex CI fragile)
  | 'CR_REINTEGRE_SNAPSHOT';

export type AuditStatut = 'success' | 'failure';

@Entity({ name: 'audit_log' })
@Index('ix_audit_log_date_action', ['dateAction'])
@Index('ix_audit_log_entite_id', ['entiteCible', 'idCible'])
@Index('ix_audit_log_utilisateur_date', ['utilisateur', 'dateAction'])
@Check('ck_audit_log_statut', `"statut" IN ('success','failure')`)
export class AuditLog {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({
    name: 'date_action',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  dateAction!: Date;

  @Column({ name: 'utilisateur', type: 'varchar', length: 255 })
  utilisateur!: string;

  @Column({ name: 'ip_source', type: 'varchar', length: 45, nullable: true })
  ipSource!: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 500, nullable: true })
  userAgent!: string | null;

  @Column({ name: 'type_action', type: 'varchar', length: 50 })
  typeAction!: TypeAction;

  @Column({ name: 'entite_cible', type: 'varchar', length: 100 })
  entiteCible!: string;

  @Column({ name: 'id_cible', type: 'varchar', nullable: true })
  idCible!: string | null;

  @Column({ name: 'payload_avant', type: 'jsonb', nullable: true })
  payloadAvant!: object | null;

  @Column({ name: 'payload_apres', type: 'jsonb', nullable: true })
  payloadApres!: object | null;

  @Column({ name: 'commentaire', type: 'text', nullable: true })
  commentaire!: string | null;

  @Column({ name: 'statut', type: 'varchar', length: 20 })
  statut!: AuditStatut;

  @Column({ name: 'duree_ms', type: 'int', nullable: true })
  dureeMs!: number | null;
}
