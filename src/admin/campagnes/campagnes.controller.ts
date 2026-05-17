/**
 * CampagnesController (Lot 6.6 — E14) — endpoint admin pour déclencher
 * l'ouverture officielle de la phase de saisie budgétaire.
 *
 * Permission requise : `BUDGET.PUBLIER` (cohérent avec la sémantique
 * "annonce officielle aux saisisseurs", proche de la publication).
 *
 * Couplage faible : le controller émet l'événement
 * `EVENT_CAMPAGNE_OUVERTE` via EventEmitter2 puis oublie. Si
 * NotificationsModule est indisponible (test isolé, container Redis
 * down, etc.), l'appel API réussit quand même — c'est le pattern des
 * autres événements (cf. NotificationsListeners).
 *
 * Idempotence : l'endpoint N'EST PAS bloqué entre 2 appels successifs
 * sur la même version. Chaque appel ré-émet l'événement et déclenche
 * une nouvelle vague d'emails. Choix délibéré : le métier peut vouloir
 * relancer une campagne (changement de dates, ajout d'un commentaire
 * de relance, etc.) sans détour via un endpoint dédié.
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import {
  type CampagneOuverteEventPayload,
  EVENT_CAMPAGNE_OUVERTE,
} from '../../notifications/notifications.events';
import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import { OuvrirCampagneDto } from './dto/ouvrir-campagne.dto';

const DUREE_DEFAUT_MS = 90 * 24 * 60 * 60 * 1000; // 90 jours

interface OuvrirCampagneResponse {
  versionId: string;
  codeVersion: string;
  dateOuverture: string;
  dateFermeture: string;
}

@ApiTags('admin-campagnes')
@ApiBearerAuth()
@Controller('admin/campagnes')
export class CampagnesController {
  constructor(
    @InjectRepository(DimVersion)
    private readonly versionRepo: Repository<DimVersion>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Post(':versionId/ouvrir')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('BUDGET.PUBLIER')
  @ApiOperation({
    summary:
      'Ouvrir officiellement la phase de saisie pour une version budgétaire (BUDGET.PUBLIER). Émet EVENT_CAMPAGNE_OUVERTE — notifie saisisseurs + validateurs.',
  })
  @ApiOkResponse({
    description:
      'Événement émis. La résolution des destinataires + envoi est async via listener.',
  })
  async ouvrir(
    @Param('versionId') versionId: string,
    @Body() body: OuvrirCampagneDto,
    @CurrentUser() user: AuthUser,
  ): Promise<OuvrirCampagneResponse> {
    const version = await this.versionRepo.findOne({
      where: { id: versionId },
    });
    if (!version) {
      throw new NotFoundException(`Version ${versionId} introuvable.`);
    }
    if (version.statut !== 'ouvert') {
      throw new BadRequestException(
        `Impossible d'ouvrir une campagne sur la version ${version.codeVersion} : statut '${version.statut}' (attendu 'ouvert').`,
      );
    }

    const dateOuverture = body.dateOuverture
      ? new Date(body.dateOuverture)
      : new Date();
    const dateFermeture = body.dateFermeture
      ? new Date(body.dateFermeture)
      : new Date(dateOuverture.getTime() + DUREE_DEFAUT_MS);

    const payload: CampagneOuverteEventPayload = {
      versionId: version.id,
      codeVersion: version.codeVersion,
      auteurId: user.userId,
      auteurEmail: user.email,
      dateOuverture: dateOuverture.toISOString(),
      dateFermeture: dateFermeture.toISOString(),
      commentaire: body.commentaire ?? null,
    };

    this.eventEmitter.emit(EVENT_CAMPAGNE_OUVERTE, payload);

    return {
      versionId: version.id,
      codeVersion: version.codeVersion,
      dateOuverture: payload.dateOuverture,
      dateFermeture: payload.dateFermeture,
    };
  }
}
