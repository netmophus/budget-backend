/**
 * Référentiel ref_pays : codes ISO 3 lettres UEMOA + 'autre'.
 * Consommé par dim_structure.code_pays.
 */
import { Injectable, Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Entity, Index, PrimaryGeneratedColumn, Repository } from 'typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DimStructure } from '../../referentiels/structure/entities/dim-structure.entity';
import {
  BaseRefSecondaire,
  BaseRefSecondaireService,
  createRefSecondaireControllerClass,
} from '../common';

@Entity({ name: 'ref_pays' })
@Index('uq_ref_pays_code', ['code'], { unique: true })
@Index('ix_ref_pays_actif_ordre', ['estActif', 'ordre'])
@Index('ix_ref_pays_est_systeme', ['estSysteme'])
export class RefPays extends BaseRefSecondaire {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;
}

@Injectable()
export class RefPaysService extends BaseRefSecondaireService<RefPays> {
  constructor(
    @InjectRepository(RefPays) repo: Repository<RefPays>,
    @InjectRepository(DimStructure)
    private readonly structureRepo: Repository<DimStructure>,
  ) {
    super(repo);
  }

  protected override get consumerLabel(): string {
    return 'par dim_structure.code_pays';
  }

  override async isReferenced(code: string): Promise<boolean> {
    const c = await this.structureRepo.count({
      where: { codePays: code, versionCourante: true } as never,
    });
    return c > 0;
  }
}

const RefPaysController = createRefSecondaireControllerClass<
  RefPays,
  RefPaysService
>({ routePath: 'pays', entiteCible: 'ref_pays' }, RefPaysService);

@Module({
  imports: [TypeOrmModule.forFeature([RefPays, DimStructure]), AuthModule],
  providers: [RefPaysService],
  controllers: [RefPaysController],
  exports: [RefPaysService],
})
export class RefPaysModule {}
