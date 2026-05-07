import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UserPerimetre } from '../users/entities/user-perimetre.entity';
import { User } from '../users/entities/user.entity';
import { DelegationsController } from './delegations.controller';
import { DelegationsCronService } from './delegations-cron.service';
import { DelegationsService } from './delegations.service';
import { Delegation } from './entities/delegation.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Delegation, UserPerimetre, User]),
    AuditModule,
    AuthModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [DelegationsController],
  providers: [DelegationsService, DelegationsCronService],
  exports: [DelegationsService],
})
export class DelegationsModule {}
