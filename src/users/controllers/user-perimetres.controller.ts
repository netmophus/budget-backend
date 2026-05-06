/**
 * UserPerimetresController (Lot 4.1.B.2) — endpoints de gestion des
 * affectations multi-périmètres :
 *
 *  - POST   /admin/users/:userId/perimetres        (USER.GERER)
 *  - DELETE /admin/users/:userId/perimetres/:id    (USER.GERER)
 *  - GET    /admin/users/:userId/perimetres        (USER.LIRE)
 *  - GET    /me/perimetres                         (auth)
 *
 * Le préfixe `/admin/users` est utilisé pour les opérations
 * admin (mandat 4.1) ; `/me/perimetres` est exposé séparément pour
 * que tout user authentifié puisse consulter ses propres affectations
 * sans permission spéciale.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import {
  AffectationPerimetreResponseDto,
  CreerAffectationPerimetreDto,
  ListerPerimetresUserQueryDto,
} from '../dto/affectation-perimetre.dto';
import { UserPerimetreService } from '../services/user-perimetre.service';

@ApiTags('users-perimetres')
@ApiBearerAuth()
@Controller()
export class UserPerimetresController {
  constructor(private readonly perimetresService: UserPerimetreService) {}

  // ─── Admin ────────────────────────────────────────────────────────

  @Post('admin/users/:userId/perimetres')
  @RequirePermissions('USER.GERER')
  @ApiOperation({
    summary:
      'Crée une affectation de périmètre pour un utilisateur (cible_type STRUCTURE / CR / CR_SET).',
  })
  @ApiCreatedResponse({ type: AffectationPerimetreResponseDto })
  @ApiBadRequestResponse({
    description: 'Cible invalide / dates incohérentes / CR_SET < 2 CR.',
  })
  @ApiConflictResponse({ description: 'Affectation déjà active.' })
  @ApiNotFoundResponse({ description: 'Utilisateur cible introuvable.' })
  async creer(
    @Param('userId') userId: string,
    @Body() dto: CreerAffectationPerimetreDto,
    @CurrentUser() auteur: AuthUser,
  ): Promise<AffectationPerimetreResponseDto> {
    const created = await this.perimetresService.creer(userId, dto, auteur.email);
    return {
      id: String(created.id),
      cibleType: created.cibleType,
      cibleId: created.cibleId === null ? null : String(created.cibleId),
      cibleCrIds:
        created.cibleCrIds === null
          ? null
          : created.cibleCrIds.map((x) => String(x)),
      origine: created.origine,
      delegationId:
        created.delegationId === null ? null : String(created.delegationId),
      dateDebut: created.dateDebut,
      dateFin: created.dateFin,
      actif: created.actif,
      motif: created.motif,
    };
  }

  @Delete('admin/users/:userId/perimetres/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('USER.GERER')
  @ApiOperation({
    summary:
      'Désactive (soft delete) une affectation de périmètre. La ligne reste en base pour audit.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Affectation déjà inactive.' })
  async retirer(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CurrentUser() auteur: AuthUser,
  ): Promise<void> {
    await this.perimetresService.retirer(userId, id, auteur.email);
  }

  @Get('admin/users/:userId/perimetres')
  @RequirePermissions('USER.LIRE')
  @ApiOperation({
    summary:
      'Liste les affectations d\'un utilisateur (filtres actif / origine / dateRef).',
  })
  @ApiOkResponse({ type: AffectationPerimetreResponseDto, isArray: true })
  async lister(
    @Param('userId') userId: string,
    @Query() query: ListerPerimetresUserQueryDto,
  ): Promise<AffectationPerimetreResponseDto[]> {
    return this.perimetresService.lister(userId, query);
  }

  // ─── User connecté ────────────────────────────────────────────────

  @Get('me/perimetres')
  @ApiOperation({
    summary:
      'Liste les affectations actives de l\'utilisateur connecté à la date du jour.',
  })
  @ApiOkResponse({ type: AffectationPerimetreResponseDto, isArray: true })
  async mesPerimetres(
    @CurrentUser() user: AuthUser,
  ): Promise<AffectationPerimetreResponseDto[]> {
    const today = new Date().toISOString().slice(0, 10);
    return this.perimetresService.lister(user.userId, {
      actif: true,
      dateRef: today,
    });
  }
}
