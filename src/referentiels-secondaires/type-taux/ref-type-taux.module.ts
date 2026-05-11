/**
 * Référentiel ref_type_taux : cloture / moyen_mensuel / fixe_budgetaire.
 * Consommé par ref_taux_change.type_taux ET fait_budget (via résolution
 * indirecte côté createFromBusinessKeys, mais ne pose pas de FK).
 */
import { Injectable, Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Entity, Index, PrimaryGeneratedColumn, Repository } from 'typeorm';

import { AuthModule } from '../../auth/auth.module';
import { RefTauxChange } from '../../referentiels/taux-change/entities/ref-taux-change.entity';
import {
  BaseRefSecondaire,
  BaseRefSecondaireService,
  createRefSecondaireControllerClass,
} from '../common';

@Entity({ name: 'ref_type_taux' })
@Index('uq_ref_type_taux_code', ['code'], { unique: true })
@Index('ix_ref_type_taux_actif_ordre', ['estActif', 'ordre'])
@Index('ix_ref_type_taux_est_systeme', ['estSysteme'])
export class RefTypeTaux extends BaseRefSecondaire {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;
}

@Injectable()
export class RefTypeTauxService extends BaseRefSecondaireService<RefTypeTaux> {
  constructor(
    @InjectRepository(RefTypeTaux) repo: Repository<RefTypeTaux>,
    @InjectRepository(RefTauxChange)
    private readonly tauxRepo: Repository<RefTauxChange>,
  ) {
    super(repo);
  }

  protected override get consumerLabel(): string {
    return 'par ref_taux_change.type_taux';
  }

  override async isReferenced(code: string): Promise<boolean> {
    const c = await this.tauxRepo.count({
      where: { typeTaux: code } as never,
    });
    return c > 0;
  }
}

const RefTypeTauxController = createRefSecondaireControllerClass<
  RefTypeTaux,
  RefTypeTauxService
>({ routePath: 'type-taux', entiteCible: 'ref_type_taux' }, RefTypeTauxService);

@Module({
  imports: [TypeOrmModule.forFeature([RefTypeTaux, RefTauxChange]), AuthModule],
  providers: [RefTypeTauxService],
  controllers: [RefTypeTauxController],
  exports: [RefTypeTauxService],
})
export class RefTypeTauxModule {}
