/**
 * CampagnesModule (Lot 6.6 — E14).
 *
 * Wire le controller d'ouverture de campagne budgétaire. Pas de
 * service métier dédié : la logique (lookup version, validation
 * statut, calcul dates par défaut, émission événement) tient dans
 * le controller (3 conditions + 1 emit).
 *
 * Dépendances :
 *  - TypeOrmModule.forFeature([DimVersion]) pour vérifier l'existence
 *    et le statut de la version cible.
 *  - EventEmitterModule.forRoot() (déjà global dans AppModule) pour
 *    l'émission EVENT_CAMPAGNE_OUVERTE consommée par les listeners
 *    du NotificationsModule.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import { CampagnesController } from './campagnes.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DimVersion])],
  controllers: [CampagnesController],
})
export class CampagnesModule {}
