import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DimStructure } from './entities/dim-structure.entity';
import { StructureController } from './structure.controller';
import { StructureService } from './structure.service';

@Module({
  imports: [TypeOrmModule.forFeature([DimStructure]), AuthModule],
  controllers: [StructureController],
  providers: [StructureService],
  exports: [StructureService],
})
export class StructureModule {}
