/**
 * Référentiel ref_type_action_audit : CREATE/UPDATE/DELETE/LOGIN/...
 * Consommé par audit_log.type_action.
 */
import { Injectable, Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Entity, Index, PrimaryGeneratedColumn, Repository } from 'typeorm';

import { AuditLog } from '../../audit/entities/audit-log.entity';
import { AuthModule } from '../../auth/auth.module';
import {
  BaseRefSecondaire,
  BaseRefSecondaireService,
  createRefSecondaireControllerClass,
} from '../common';

@Entity({ name: 'ref_type_action_audit' })
@Index('uq_ref_type_action_audit_code', ['code'], { unique: true })
@Index('ix_ref_type_action_audit_actif_ordre', ['estActif', 'ordre'])
@Index('ix_ref_type_action_audit_est_systeme', ['estSysteme'])
export class RefTypeActionAudit extends BaseRefSecondaire {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;
}

@Injectable()
export class RefTypeActionAuditService extends BaseRefSecondaireService<RefTypeActionAudit> {
  constructor(
    @InjectRepository(RefTypeActionAudit)
    repo: Repository<RefTypeActionAudit>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {
    super(repo);
  }

  protected override get consumerLabel(): string {
    return 'par audit_log.type_action';
  }

  override async isReferenced(code: string): Promise<boolean> {
    const c = await this.auditRepo.count({
      where: { typeAction: code } as never,
    });
    return c > 0;
  }
}

const RefTypeActionAuditController = createRefSecondaireControllerClass<
  RefTypeActionAudit,
  RefTypeActionAuditService
>(
  {
    routePath: 'type-action-audit',
    entiteCible: 'ref_type_action_audit',
  },
  RefTypeActionAuditService,
);

@Module({
  imports: [
    TypeOrmModule.forFeature([RefTypeActionAudit, AuditLog]),
    AuthModule,
  ],
  providers: [RefTypeActionAuditService],
  controllers: [RefTypeActionAuditController],
  exports: [RefTypeActionAuditService],
})
export class RefTypeActionAuditModule {}
