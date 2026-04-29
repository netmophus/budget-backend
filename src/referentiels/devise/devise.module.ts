import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { DeviseController } from './devise.controller';
import { DeviseService } from './devise.service';
import { DimDevise } from './entities/dim-devise.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DimDevise]), AuthModule],
  controllers: [DeviseController],
  providers: [DeviseService],
  exports: [DeviseService],
})
export class DeviseModule {}
