import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CompteImportService } from './compte-import.service';
import { CompteController } from './compte.controller';
import { CompteService } from './compte.service';
import { DimCompte } from './entities/dim-compte.entity';

/**
 * CompteModule — pas de `forwardRef` nécessaire : la stratégie A
 * sur `fk_compte_parent` est une **auto-référence** interne au
 * service (`CompteService.relinkAfterCompteRevision`), pas un cycle
 * inter-modules comme StructureModule ↔ CrModule (cf. 2.3B).
 *
 * `CsvImportService` (socle 2.1) est fourni localement ici comme
 * provider — il n'a pas de module parent dédié dans `common/`. Au
 * 2ᵉ usage (probablement Lot 2.4B import segment / produit), si
 * la duplication devient lourde, on créera un `CommonCsvModule`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([DimCompte]), AuthModule],
  controllers: [CompteController],
  providers: [CompteService, CompteImportService, CsvImportService],
  exports: [CompteService],
})
export class CompteModule {}
