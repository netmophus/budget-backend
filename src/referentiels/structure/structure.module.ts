import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { CentreResponsabiliteModule } from '../centre-responsabilite/centre-responsabilite.module';
import { DimStructure } from './entities/dim-structure.entity';
import { StructureController } from './structure.controller';
import { StructureService } from './structure.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DimStructure]),
    AuthModule,
    // forwardRef pour casser la dépendance circulaire avec CrModule
    // (relink stratégie A — cf. scd2-pattern.md §8).
    forwardRef(() => CentreResponsabiliteModule),
  ],
  controllers: [StructureController],
  providers: [StructureService],
  exports: [StructureService],
})
export class StructureModule {}
