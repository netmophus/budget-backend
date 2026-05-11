/**
 * Référentiel ref_type_version : budget_initial / reforecast_1 /
 * reforecast_2 / atterrissage. Consommé par dim_version.type_version.
 */
import { Injectable, Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Entity, Index, PrimaryGeneratedColumn, Repository } from 'typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import {
  BaseRefSecondaire,
  BaseRefSecondaireService,
  createRefSecondaireControllerClass,
} from '../common';

@Entity({ name: 'ref_type_version' })
@Index('uq_ref_type_version_code', ['code'], { unique: true })
@Index('ix_ref_type_version_actif_ordre', ['estActif', 'ordre'])
@Index('ix_ref_type_version_est_systeme', ['estSysteme'])
export class RefTypeVersion extends BaseRefSecondaire {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;
}

@Injectable()
export class RefTypeVersionService extends BaseRefSecondaireService<RefTypeVersion> {
  constructor(
    @InjectRepository(RefTypeVersion) repo: Repository<RefTypeVersion>,
    @InjectRepository(DimVersion)
    private readonly versionRepo: Repository<DimVersion>,
  ) {
    super(repo);
  }

  protected override get consumerLabel(): string {
    return 'par dim_version.type_version';
  }

  override async isReferenced(code: string): Promise<boolean> {
    const c = await this.versionRepo.count({
      where: { typeVersion: code } as never,
    });
    return c > 0;
  }
}

const RefTypeVersionController = createRefSecondaireControllerClass<
  RefTypeVersion,
  RefTypeVersionService
>(
  { routePath: 'type-version', entiteCible: 'ref_type_version' },
  RefTypeVersionService,
);

@Module({
  imports: [TypeOrmModule.forFeature([RefTypeVersion, DimVersion]), AuthModule],
  providers: [RefTypeVersionService],
  controllers: [RefTypeVersionController],
  exports: [RefTypeVersionService],
})
export class RefTypeVersionModule {}
