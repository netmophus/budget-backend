import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigurationBanqueController } from './configuration-banque.controller';
import { ConfigurationBanqueService } from './configuration-banque.service';
import { ConfigurationBanqueMembreComite } from './entities/configuration-banque-membre-comite.entity';
import { ConfigurationBanque } from './entities/configuration-banque.entity';

/**
 * ConfigurationBanqueModule (Lot B1) — socle de la configuration
 * institutionnelle externalisée (multi-banques). Exporte le service pour
 * que les modules de rendu (PDF/Excel/emails — Lots B2/B3) consomment la
 * config au lieu des valeurs hardcodées.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConfigurationBanque,
      ConfigurationBanqueMembreComite,
    ]),
    AuditModule,
    AuthModule,
  ],
  controllers: [ConfigurationBanqueController],
  providers: [ConfigurationBanqueService],
  exports: [ConfigurationBanqueService],
})
export class ConfigurationBanqueModule {}
