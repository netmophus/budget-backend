import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DimVersion } from './entities/dim-version.entity';
import { VersionController } from './version.controller';
import { VersionService } from './version.service';

@Module({
  imports: [TypeOrmModule.forFeature([DimVersion]), AuthModule],
  controllers: [VersionController],
  providers: [VersionService],
  exports: [VersionService],
})
export class VersionModule {}
