/**
 * Référentiel ref_type_produit : credit, depot, service, marche, autre.
 * Consommé par dim_produit.type_produit.
 */
import { Injectable, Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Entity, Index, PrimaryGeneratedColumn, Repository } from 'typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DimProduit } from '../../referentiels/produit/entities/dim-produit.entity';
import {
  BaseRefSecondaire,
  BaseRefSecondaireService,
  createRefSecondaireControllerClass,
} from '../common';

@Entity({ name: 'ref_type_produit' })
@Index('uq_ref_type_produit_code', ['code'], { unique: true })
@Index('ix_ref_type_produit_actif_ordre', ['estActif', 'ordre'])
@Index('ix_ref_type_produit_est_systeme', ['estSysteme'])
export class RefTypeProduit extends BaseRefSecondaire {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;
}

@Injectable()
export class RefTypeProduitService extends BaseRefSecondaireService<RefTypeProduit> {
  constructor(
    @InjectRepository(RefTypeProduit) repo: Repository<RefTypeProduit>,
    @InjectRepository(DimProduit)
    private readonly produitRepo: Repository<DimProduit>,
  ) {
    super(repo);
  }

  protected override get consumerLabel(): string {
    return 'par dim_produit.type_produit';
  }

  override async isReferenced(code: string): Promise<boolean> {
    const c = await this.produitRepo.count({
      where: { typeProduit: code, versionCourante: true } as never,
    });
    return c > 0;
  }
}

const RefTypeProduitController = createRefSecondaireControllerClass<
  RefTypeProduit,
  RefTypeProduitService
>(
  { routePath: 'type-produit', entiteCible: 'ref_type_produit' },
  RefTypeProduitService,
);

@Module({
  imports: [TypeOrmModule.forFeature([RefTypeProduit, DimProduit]), AuthModule],
  providers: [RefTypeProduitService],
  controllers: [RefTypeProduitController],
  exports: [RefTypeProduitService],
})
export class RefTypeProduitModule {}
