/**
 * Référentiel ref_type_scenario : central / optimiste / pessimiste / alternatif.
 * Consommé par dim_scenario.type_scenario.
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

@Entity({ name: 'ref_type_scenario' })
@Index('uq_ref_type_scenario_code', ['code'], { unique: true })
@Index('ix_ref_type_scenario_actif_ordre', ['estActif', 'ordre'])
@Index('ix_ref_type_scenario_est_systeme', ['estSysteme'])
export class RefTypeScenario extends BaseRefSecondaire {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;
}

@Injectable()
export class RefTypeScenarioService extends BaseRefSecondaireService<RefTypeScenario> {
  constructor(
    @InjectRepository(RefTypeScenario) repo: Repository<RefTypeScenario>,
    @InjectRepository(DimScenario)
    private readonly scenarioRepo: Repository<DimScenario>,
  ) {
    super(repo);
  }

  protected override get consumerLabel(): string {
    return 'par dim_scenario.type_scenario';
  }

  override async isReferenced(code: string): Promise<boolean> {
    const c = await this.scenarioRepo.count({
      where: { typeScenario: code } as never,
    });
    return c > 0;
  }
}

const RefTypeScenarioController = createRefSecondaireControllerClass<
  RefTypeScenario,
  RefTypeScenarioService
>(
  { routePath: 'type-scenario', entiteCible: 'ref_type_scenario' },
  RefTypeScenarioService,
);

@Module({
  imports: [
    TypeOrmModule.forFeature([RefTypeScenario, DimScenario]),
    AuthModule,
  ],
  providers: [RefTypeScenarioService],
  controllers: [RefTypeScenarioController],
  exports: [RefTypeScenarioService],
})
export class RefTypeScenarioModule {}
