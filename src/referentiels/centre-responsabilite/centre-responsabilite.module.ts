import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { StructureModule } from '../structure/structure.module';
import { CentreResponsabiliteController } from './centre-responsabilite.controller';
import { CentreResponsabiliteService } from './centre-responsabilite.service';
import { DimCentreResponsabilite } from './entities/dim-centre-responsabilite.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DimCentreResponsabilite]),
    AuthModule,
    // forwardRef pour casser la dépendance circulaire
    // CrModule ↔ StructureModule (relink stratégie A —
    // cf. scd2-pattern.md §8).
    forwardRef(() => StructureModule),
  ],
  controllers: [CentreResponsabiliteController],
  providers: [CentreResponsabiliteService],
  exports: [CentreResponsabiliteService],
})
export class CentreResponsabiliteModule {}
