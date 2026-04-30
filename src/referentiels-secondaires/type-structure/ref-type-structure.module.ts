/**
 * Référentiel ref_type_structure : énumération des types de structure
 * organisationnelle (entité juridique, branche, direction, département,
 * agence). Consommée par dim_structure.type_structure.
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

@Entity({ name: 'ref_type_structure' })
@Index('uq_ref_type_structure_code', ['code'], { unique: true })
@Index('ix_ref_type_structure_actif_ordre', ['estActif', 'ordre'])
@Index('ix_ref_type_structure_est_systeme', ['estSysteme'])
export class RefTypeStructure extends BaseRefSecondaire {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;
}

@Injectable()
export class RefTypeStructureService extends BaseRefSecondaireService<RefTypeStructure> {
  constructor(
    @InjectRepository(RefTypeStructure)
    repo: Repository<RefTypeStructure>,
    @InjectRepository(DimStructure)
    private readonly structureRepo: Repository<DimStructure>,
  ) {
    super(repo);
  }

  protected override get consumerLabel(): string {
    return 'par dim_structure.type_structure';
  }

  override async isReferenced(code: string): Promise<boolean> {
    const c = await this.structureRepo.count({
      where: { typeStructure: code, versionCourante: true } as never,
    });
    return c > 0;
  }
}

const RefTypeStructureController = createRefSecondaireControllerClass<
  RefTypeStructure,
  RefTypeStructureService
>(
  { routePath: 'type-structure', entiteCible: 'ref_type_structure' },
  RefTypeStructureService,
);

@Module({
  imports: [
    TypeOrmModule.forFeature([RefTypeStructure, DimStructure]),
    AuthModule,
  ],
  providers: [RefTypeStructureService],
  controllers: [RefTypeStructureController],
  exports: [RefTypeStructureService],
})
export class RefTypeStructureModule {}
