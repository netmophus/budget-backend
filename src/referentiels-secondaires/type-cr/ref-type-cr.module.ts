/**
 * Référentiel ref_type_cr : types de centre de responsabilité (cdc/cdp/cdr/autre).
 * Consommé par dim_centre_responsabilite.type_cr.
 */
import { Injectable, Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Entity, Index, PrimaryGeneratedColumn, Repository } from 'typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DimCentreResponsabilite } from '../../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import {
  BaseRefSecondaire,
  BaseRefSecondaireService,
  createRefSecondaireControllerClass,
} from '../common';

@Entity({ name: 'ref_type_cr' })
@Index('uq_ref_type_cr_code', ['code'], { unique: true })
@Index('ix_ref_type_cr_actif_ordre', ['estActif', 'ordre'])
@Index('ix_ref_type_cr_est_systeme', ['estSysteme'])
export class RefTypeCr extends BaseRefSecondaire {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;
}

@Injectable()
export class RefTypeCrService extends BaseRefSecondaireService<RefTypeCr> {
  constructor(
    @InjectRepository(RefTypeCr) repo: Repository<RefTypeCr>,
    @InjectRepository(DimCentreResponsabilite)
    private readonly crRepo: Repository<DimCentreResponsabilite>,
  ) {
    super(repo);
  }

  protected override get consumerLabel(): string {
    return 'par dim_centre_responsabilite.type_cr';
  }

  override async isReferenced(code: string): Promise<boolean> {
    const c = await this.crRepo.count({
      where: { typeCr: code, versionCourante: true } as never,
    });
    return c > 0;
  }
}

const RefTypeCrController = createRefSecondaireControllerClass<
  RefTypeCr,
  RefTypeCrService
>({ routePath: 'type-cr', entiteCible: 'ref_type_cr' }, RefTypeCrService);

@Module({
  imports: [
    TypeOrmModule.forFeature([RefTypeCr, DimCentreResponsabilite]),
    AuthModule,
  ],
  providers: [RefTypeCrService],
  controllers: [RefTypeCrController],
  exports: [RefTypeCrService],
})
export class RefTypeCrModule {}
