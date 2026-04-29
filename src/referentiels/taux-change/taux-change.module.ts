import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DimDevise } from '../devise/entities/dim-devise.entity';
import { DimTemps } from '../temps/entities/dim-temps.entity';
import { RefTauxChange } from './entities/ref-taux-change.entity';
import { TauxChangeController } from './taux-change.controller';
import { TauxChangeService } from './taux-change.service';

/**
 * TauxChangeModule importe les entités DimDevise et DimTemps pour
 * résoudre les FK par codeIso/date — c'est ergonomique côté API mais
 * impose ce couplage léger. Pas de forwardRef car pas de cycle :
 * DeviseModule et TempsModule n'importent pas TauxChangeModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([RefTauxChange, DimDevise, DimTemps]),
    AuthModule,
  ],
  controllers: [TauxChangeController],
  providers: [TauxChangeService],
  exports: [TauxChangeService],
})
export class TauxChangeModule {}
