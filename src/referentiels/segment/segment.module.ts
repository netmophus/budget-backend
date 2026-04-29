import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DimSegment } from './entities/dim-segment.entity';
import { SegmentController } from './segment.controller';
import { SegmentService } from './segment.service';

/**
 * SegmentModule — pas de hiérarchie, donc pas de relink ni de
 * `forwardRef`. Pattern simplifié vs CompteModule / LigneMetierModule
 * / ProduitModule — cf. `SegmentService` pour la note de design.
 */
@Module({
  imports: [TypeOrmModule.forFeature([DimSegment]), AuthModule],
  controllers: [SegmentController],
  providers: [SegmentService],
  exports: [SegmentService],
})
export class SegmentModule {}
