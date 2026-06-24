import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ParametreSysteme } from './entities/parametre-systeme.entity';
import { ParametreSystemeService } from './parametre-systeme.service';
import { RealiseConfigController } from './realise-config.controller';

/**
 * ParametreSystemeModule — paramétrage global clé-valeur + endpoints de
 * configuration du mode de saisie du réalisé. Exporte le service pour
 * que RealiseModule puisse gater la saisie manuelle selon le mode.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ParametreSysteme]),
    AuditModule,
    AuthModule,
  ],
  controllers: [RealiseConfigController],
  providers: [ParametreSystemeService],
  exports: [ParametreSystemeService],
})
export class ParametreSystemeModule {}
