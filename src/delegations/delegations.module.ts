import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { EmailQueueModule } from '../notifications/email-queue.module';
import { EmailLog } from '../notifications/entities/email-log.entity';
import { UserPerimetre } from '../users/entities/user-perimetre.entity';
import { User } from '../users/entities/user.entity';
import { DelegationsController } from './delegations.controller';
import { DelegationsCronService } from './delegations-cron.service';
import { DelegationsRappelCronService } from './delegations-rappel-cron.service';
import { DelegationsRappelService } from './delegations-rappel.service';
import { DelegationsService } from './delegations.service';
import { Delegation } from './entities/delegation.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Delegation, UserPerimetre, User, EmailLog]),
    AuditModule,
    AuthModule,
    ScheduleModule.forRoot(),
    // Lot 4.3 — DelegationsService émet 3 events delegation.*
    EventEmitterModule.forRoot(),
    // Lot 6.5.B — publication des emails J-3 directement dans la
    // queue BullMQ (sans passer par NotificationsService pour éviter
    // de propager EmailWorker au scope DelegationsModule).
    EmailQueueModule,
  ],
  controllers: [DelegationsController],
  providers: [
    DelegationsService,
    DelegationsCronService,
    // Lot 6.5.B — rappel J-3 expiration délégation.
    DelegationsRappelService,
    DelegationsRappelCronService,
  ],
  exports: [DelegationsService],
})
export class DelegationsModule {}
