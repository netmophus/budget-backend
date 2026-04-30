/**
 * Référentiel ref_categorie_segment : particulier, professionnel, pme,
 * grande_entreprise, institutionnel, secteur_public.
 * Consommé par dim_segment.categorie.
 */
import { Injectable, Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Entity, Index, PrimaryGeneratedColumn, Repository } from 'typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DimSegment } from '../../referentiels/segment/entities/dim-segment.entity';
import {
  BaseRefSecondaire,
  BaseRefSecondaireService,
  createRefSecondaireControllerClass,
} from '../common';

@Entity({ name: 'ref_categorie_segment' })
@Index('uq_ref_categorie_segment_code', ['code'], { unique: true })
@Index('ix_ref_categorie_segment_actif_ordre', ['estActif', 'ordre'])
@Index('ix_ref_categorie_segment_est_systeme', ['estSysteme'])
export class RefCategorieSegment extends BaseRefSecondaire {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;
}

@Injectable()
export class RefCategorieSegmentService extends BaseRefSecondaireService<RefCategorieSegment> {
  constructor(
    @InjectRepository(RefCategorieSegment)
    repo: Repository<RefCategorieSegment>,
    @InjectRepository(DimSegment)
    private readonly segmentRepo: Repository<DimSegment>,
  ) {
    super(repo);
  }

  protected override get consumerLabel(): string {
    return 'par dim_segment.categorie';
  }

  override async isReferenced(code: string): Promise<boolean> {
    const c = await this.segmentRepo.count({
      where: { categorie: code, versionCourante: true } as never,
    });
    return c > 0;
  }
}

const RefCategorieSegmentController = createRefSecondaireControllerClass<
  RefCategorieSegment,
  RefCategorieSegmentService
>(
  { routePath: 'categorie-segment', entiteCible: 'ref_categorie_segment' },
  RefCategorieSegmentService,
);

@Module({
  imports: [
    TypeOrmModule.forFeature([RefCategorieSegment, DimSegment]),
    AuthModule,
  ],
  providers: [RefCategorieSegmentService],
  controllers: [RefCategorieSegmentController],
  exports: [RefCategorieSegmentService],
})
export class RefCategorieSegmentModule {}
