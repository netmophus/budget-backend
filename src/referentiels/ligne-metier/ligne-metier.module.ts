import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DimLigneMetier } from './entities/dim-ligne-metier.entity';
import { LigneMetierController } from './ligne-metier.controller';
import { LigneMetierService } from './ligne-metier.service';

/**
 * LigneMetierModule — pas de `forwardRef` nécessaire : la stratégie A
 * sur `fk_ligne_metier_parent` est une **auto-référence** interne au
 * service (`LigneMetierService.relinkAfterLigneMetierRevision`), pas
 * un cycle inter-modules.
 *
 * Pattern jumeau de `CompteModule` (Lot 2.4A).
 */
@Module({
  imports: [TypeOrmModule.forFeature([DimLigneMetier]), AuthModule],
  controllers: [LigneMetierController],
  providers: [LigneMetierService],
  exports: [LigneMetierService],
})
export class LigneMetierModule {}
