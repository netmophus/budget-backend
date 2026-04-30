/**
 * Référentiel ref_statut_version : ouvert / soumis / valide / gele.
 * Consommé par dim_version.statut.
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

@Entity({ name: 'ref_statut_version' })
@Index('uq_ref_statut_version_code', ['code'], { unique: true })
@Index('ix_ref_statut_version_actif_ordre', ['estActif', 'ordre'])
@Index('ix_ref_statut_version_est_systeme', ['estSysteme'])
export class RefStatutVersion extends BaseRefSecondaire {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;
}

@Injectable()
export class RefStatutVersionService extends BaseRefSecondaireService<RefStatutVersion> {
  constructor(
    @InjectRepository(RefStatutVersion)
    repo: Repository<RefStatutVersion>,
    @InjectRepository(DimVersion)
    private readonly versionRepo: Repository<DimVersion>,
  ) {
    super(repo);
  }

  protected override get consumerLabel(): string {
    return 'par dim_version.statut';
  }

  override async isReferenced(code: string): Promise<boolean> {
    const c = await this.versionRepo.count({
      where: { statut: code } as never,
    });
    return c > 0;
  }
}

const RefStatutVersionController = createRefSecondaireControllerClass<
  RefStatutVersion,
  RefStatutVersionService
>(
  { routePath: 'statut-version', entiteCible: 'ref_statut_version' },
  RefStatutVersionService,
);

@Module({
  imports: [
    TypeOrmModule.forFeature([RefStatutVersion, DimVersion]),
    AuthModule,
  ],
  providers: [RefStatutVersionService],
  controllers: [RefStatutVersionController],
  exports: [RefStatutVersionService],
})
export class RefStatutVersionModule {}
