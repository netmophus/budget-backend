/**
 * Référentiel ref_classe_compte : 1 à 9 (PCB UMOA Révisé).
 * Consommé par dim_compte.classe (int) — conversion code→number lors
 * de la vérification isReferenced.
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

@Entity({ name: 'ref_classe_compte' })
@Index('uq_ref_classe_compte_code', ['code'], { unique: true })
@Index('ix_ref_classe_compte_actif_ordre', ['estActif', 'ordre'])
@Index('ix_ref_classe_compte_est_systeme', ['estSysteme'])
export class RefClasseCompte extends BaseRefSecondaire {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;
}

@Injectable()
export class RefClasseCompteService extends BaseRefSecondaireService<RefClasseCompte> {
  constructor(
    @InjectRepository(RefClasseCompte) repo: Repository<RefClasseCompte>,
    @InjectRepository(DimCompte)
    private readonly compteRepo: Repository<DimCompte>,
  ) {
    super(repo);
  }

  protected override get consumerLabel(): string {
    return 'par dim_compte.classe';
  }

  override async isReferenced(code: string): Promise<boolean> {
    const classeNum = Number.parseInt(code, 10);
    if (!Number.isFinite(classeNum)) return false;
    const c = await this.compteRepo.count({
      where: { classe: classeNum, versionCourante: true } as never,
    });
    return c > 0;
  }
}

const RefClasseCompteController = createRefSecondaireControllerClass<
  RefClasseCompte,
  RefClasseCompteService
>(
  { routePath: 'classe-compte', entiteCible: 'ref_classe_compte' },
  RefClasseCompteService,
);

@Module({
  imports: [
    TypeOrmModule.forFeature([RefClasseCompte, DimCompte]),
    AuthModule,
  ],
  providers: [RefClasseCompteService],
  controllers: [RefClasseCompteController],
  exports: [RefClasseCompteService],
})
export class RefClasseCompteModule {}
