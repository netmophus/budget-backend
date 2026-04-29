import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DimProduit } from './entities/dim-produit.entity';
import { ProduitController } from './produit.controller';
import { ProduitService } from './produit.service';

/**
 * ProduitModule — pas de `forwardRef` (auto-référence interne au
 * service via `relinkAfterProduitRevision`). Pattern jumeau de
 * `CompteModule` et `LigneMetierModule`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([DimProduit]), AuthModule],
  controllers: [ProduitController],
  providers: [ProduitService],
  exports: [ProduitService],
})
export class ProduitModule {}
