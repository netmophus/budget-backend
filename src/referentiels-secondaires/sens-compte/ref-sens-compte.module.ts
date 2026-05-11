/**
 * Référentiel ref_sens_compte : D / C / M.
 * Consommé par dim_compte.sens.
 */
import { Injectable, Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Entity, Index, PrimaryGeneratedColumn, Repository } from 'typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DimCompte } from '../../referentiels/compte/entities/dim-compte.entity';
import {
  BaseRefSecondaire,
  BaseRefSecondaireService,
  createRefSecondaireControllerClass,
} from '../common';

@Entity({ name: 'ref_sens_compte' })
@Index('uq_ref_sens_compte_code', ['code'], { unique: true })
@Index('ix_ref_sens_compte_actif_ordre', ['estActif', 'ordre'])
@Index('ix_ref_sens_compte_est_systeme', ['estSysteme'])
export class RefSensCompte extends BaseRefSecondaire {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;
}

@Injectable()
export class RefSensCompteService extends BaseRefSecondaireService<RefSensCompte> {
  constructor(
    @InjectRepository(RefSensCompte) repo: Repository<RefSensCompte>,
    @InjectRepository(DimCompte)
    private readonly compteRepo: Repository<DimCompte>,
  ) {
    super(repo);
  }

  protected override get consumerLabel(): string {
    return 'par dim_compte.sens';
  }

  override async isReferenced(code: string): Promise<boolean> {
    const c = await this.compteRepo.count({
      where: { sens: code, versionCourante: true } as never,
    });
    return c > 0;
  }
}

const RefSensCompteController = createRefSecondaireControllerClass<
  RefSensCompte,
  RefSensCompteService
>(
  { routePath: 'sens-compte', entiteCible: 'ref_sens_compte' },
  RefSensCompteService,
);

@Module({
  imports: [TypeOrmModule.forFeature([RefSensCompte, DimCompte]), AuthModule],
  providers: [RefSensCompteService],
  controllers: [RefSensCompteController],
  exports: [RefSensCompteService],
})
export class RefSensCompteModule {}
