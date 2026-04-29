import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DimTemps } from './entities/dim-temps.entity';
import { TempsController } from './temps.controller';
import { TempsService } from './temps.service';

@Module({
  imports: [TypeOrmModule.forFeature([DimTemps]), AuthModule],
  controllers: [TempsController],
  providers: [TempsService],
  exports: [TempsService],
})
export class TempsModule {}
