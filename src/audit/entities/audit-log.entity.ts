import {
  Check,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

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
  | 'IMPORT_BUDGET_BULK';

export type AuditStatut = 'success' | 'failure';

@Entity({ name: 'audit_log' })
@Index('ix_audit_log_date_action', ['dateAction'])
@Index('ix_audit_log_entite_id', ['entiteCible', 'idCible'])
@Index('ix_audit_log_utilisateur_date', ['utilisateur', 'dateAction'])
@Check(
  'ck_audit_log_statut',
  `"statut" IN ('success','failure')`,
)
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
