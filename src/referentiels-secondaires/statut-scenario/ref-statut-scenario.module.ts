/**
 * Référentiel ref_statut_scenario : actif / archive.
 * Consommé par dim_scenario.statut.
 */
import { Injectable, Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Entity, Index, PrimaryGeneratedColumn, Repository } from 'typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DimScenario } from '../../referentiels/scenario/entities/dim-scenario.entity';
import {
  BaseRefSecondaire,
  BaseRefSecondaireService,
  createRefSecondaireControllerClass,
} from '../common';

@Entity({ name: 'ref_statut_scenario' })
@Index('uq_ref_statut_scenario_code', ['code'], { unique: true })
@Index('ix_ref_statut_scenario_actif_ordre', ['estActif', 'ordre'])
@Index('ix_ref_statut_scenario_est_systeme', ['estSysteme'])
export class RefStatutScenario extends BaseRefSecondaire {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;
}

@Injectable()
export class RefStatutScenarioService extends BaseRefSecondaireService<RefStatutScenario> {
  constructor(
    @InjectRepository(RefStatutScenario)
    repo: Repository<RefStatutScenario>,
    @InjectRepository(DimScenario)
    private readonly scenarioRepo: Repository<DimScenario>,
  ) {
    super(repo);
  }

  protected override get consumerLabel(): string {
    return 'par dim_scenario.statut';
  }

  override async isReferenced(code: string): Promise<boolean> {
    const c = await this.scenarioRepo.count({
      where: { statut: code } as never,
    });
    return c > 0;
  }
}

const RefStatutScenarioController = createRefSecondaireControllerClass<
  RefStatutScenario,
  RefStatutScenarioService
>(
  { routePath: 'statut-scenario', entiteCible: 'ref_statut_scenario' },
  RefStatutScenarioService,
);

@Module({
  imports: [
    TypeOrmModule.forFeature([RefStatutScenario, DimScenario]),
    AuthModule,
  ],
  providers: [RefStatutScenarioService],
  controllers: [RefStatutScenarioController],
  exports: [RefStatutScenarioService],
})
export class RefStatutScenarioModule {}
