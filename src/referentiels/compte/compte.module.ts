import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { CompteController } from './compte.controller';
import { CompteService } from './compte.service';
import { DimCompte } from './entities/dim-compte.entity';

/**
 * CompteModule — pas de `forwardRef` nécessaire : la stratégie A
 * sur `fk_compte_parent` est une **auto-référence** interne au
 * service (`CompteService.relinkAfterCompteRevision`), pas un cycle
 * inter-modules comme StructureModule ↔ CrModule (cf. 2.3B).
 */
@Module({
  imports: [TypeOrmModule.forFeature([DimCompte]), AuthModule],
  controllers: [CompteController],
  providers: [CompteService],
  exports: [CompteService],
})
export class CompteModule {}
