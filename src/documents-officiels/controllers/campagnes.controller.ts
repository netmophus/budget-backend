/**
 * CampagnesController (Lot 8.1.C) — 5 endpoints REST pour la gestion
 * des campagnes budgétaires + Comité visa.
 *
 *   POST   /api/v1/campagnes              CAMPAGNE.GERER   creer
 *   GET    /api/v1/campagnes              DOCUMENT.LIRE    lister
 *   GET    /api/v1/campagnes/:id          DOCUMENT.LIRE    detail
 *   POST   /api/v1/campagnes/:id/membres  CAMPAGNE.GERER   ajouter membre
 *   POST   /api/v1/campagnes/:id/lancer   CAMPAGNE.GERER   transition
 *
 * Pattern aligné sur `ReportingController` (Lot 7.6) — guards globaux
 * (`JwtAuthGuard` + `PermissionsGuard` dans app.module), DTO
 * class-validator validés par le pipe global, `@RequirePermissions`
 * appliqué par méthode.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { AjouterComiteMembreDto } from '../dto/ajouter-comite-membre.dto';
import { CreerCampagneDto } from '../dto/creer-campagne.dto';
import { CampagneService } from '../services/campagne.service';

@ApiTags('campagnes-budgetaires')
@ApiBearerAuth()
@Controller('campagnes')
export class CampagnesController {
  constructor(private readonly campagneService: CampagneService) {}

  // ─── 1. POST / — creer ───────────────────────────────────────────

  @Post()
  @RequirePermissions('CAMPAGNE.GERER')
  @ApiOperation({
    summary:
      'Crée une nouvelle campagne budgétaire en statut PARAMETRAGE. Le Comité est nominé via POST /:id/membres avant le lancement.',
  })
  @ApiCreatedResponse({ description: 'Campagne créée.' })
  @ApiConflictResponse({
    description: 'Exercice fiscal déjà associé à une campagne.',
  })
  @ApiNotFoundResponse({
    description: 'Signataire (fkUserSignataireDefaut) introuvable.',
  })
  async creer(@Body() dto: CreerCampagneDto, @CurrentUser() user: AuthUser) {
    return this.campagneService.creerCampagne(dto, user.email);
  }

  // ─── 2. GET / — lister ───────────────────────────────────────────

  @Get()
  @RequirePermissions('DOCUMENT.LIRE')
  @ApiOperation({
    summary:
      'Liste les campagnes (tri exercice DESC). Pas de pagination — volumétrie attendue < 10.',
  })
  @ApiOkResponse({ description: 'Liste des campagnes.' })
  async lister() {
    return this.campagneService.listerCampagnes();
  }

  // ─── 3. GET /:id — detail ────────────────────────────────────────

  @Get(':id')
  @RequirePermissions('DOCUMENT.LIRE')
  @ApiOperation({
    summary: "Détail d'une campagne avec ses membres comité ordonnés.",
  })
  @ApiOkResponse({ description: 'Campagne + comité.' })
  @ApiNotFoundResponse({ description: 'Campagne introuvable.' })
  async detail(@Param('id', ParseUUIDPipe) campagneId: string) {
    return this.campagneService.detailCampagne(campagneId);
  }

  // ─── 4. POST /:id/membres — ajouter membre comité ────────────────

  @Post(':id/membres')
  @RequirePermissions('CAMPAGNE.GERER')
  @ApiOperation({
    summary:
      'Ajoute un membre au Comité de la campagne (statut PARAMETRAGE only). Ordre auto-incrémenté.',
  })
  @ApiCreatedResponse({ description: 'Membre ajouté.' })
  @ApiNotFoundResponse({ description: 'Campagne introuvable.' })
  @ApiConflictResponse({
    description:
      'Campagne pas en PARAMETRAGE, ou user déjà membre (uq_camp_user).',
  })
  async ajouterMembre(
    @Param('id', ParseUUIDPipe) campagneId: string,
    @Body() dto: AjouterComiteMembreDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.campagneService.ajouterMembreComite(
      campagneId,
      dto,
      user.email,
    );
  }

  // ─── 5. POST /:id/lancer — transition PARAMETRAGE -> EN_COURS ────

  @Post(':id/lancer')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('CAMPAGNE.GERER')
  @ApiOperation({
    summary:
      'Lance la campagne (PARAMETRAGE → EN_COURS). Exige au moins 1 membre Comité obligatoire (sinon visa impossible à compléter).',
  })
  @ApiOkResponse({ description: 'Campagne lancée, statut = EN_COURS.' })
  @ApiNotFoundResponse({ description: 'Campagne introuvable.' })
  @ApiConflictResponse({
    description:
      'Campagne pas en PARAMETRAGE OU aucun membre obligatoire dans le Comité.',
  })
  @ApiForbiddenResponse({ description: 'Permission CAMPAGNE.GERER manquante.' })
  async lancer(
    @Param('id', ParseUUIDPipe) campagneId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.campagneService.lancerCampagne(campagneId, user.email);
  }
}
