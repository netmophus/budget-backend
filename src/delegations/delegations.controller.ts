/**
 * DelegationsController (Lot 4.2.B) — endpoints REST :
 *   POST   /delegations                  (auth) — créer
 *   POST   /delegations/:id/revoquer     (auth délégant ou admin)
 *   GET    /delegations/recues           (auth) — où je suis délégataire
 *   GET    /delegations/emises           (auth) — où je suis délégant
 *   GET    /admin/delegations            (DELEGATION.GERER) — toutes
 *
 * Authentification globale via JwtAuthGuard. Les permissions
 * sont vérifiées par `@RequirePermissions` quand pertinent.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PermissionsService } from '../auth/permissions.service';
import { DelegationsService } from './delegations.service';
import {
  CreerDelegationDto,
  CreerDelegationResponseDto,
  DelegationResponseDto,
  ListerDelegationsQueryDto,
  RevoquerDelegationDto,
} from './dto/delegation.dto';

@ApiTags('delegations')
@ApiBearerAuth()
@Controller()
export class DelegationsController {
  constructor(
    private readonly service: DelegationsService,
    private readonly permissionsService: PermissionsService,
  ) {}

  @Post('delegations')
  @ApiOperation({
    summary:
      'Créer une délégation (le délégant est l\'utilisateur courant). Anti-chaînage strict (D2) — un périmètre déjà reçu par délégation ne peut pas être re-délégué.',
  })
  @ApiCreatedResponse({ type: CreerDelegationResponseDto })
  @ApiBadRequestResponse({
    description:
      'Anti-chaînage / inclusion périmètre / inclusion permissions / dates incohérentes.',
  })
  async creer(
    @Body() dto: CreerDelegationDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CreerDelegationResponseDto> {
    const { delegation, warnings } = await this.service.creer(dto, user);
    const today = new Date().toISOString().slice(0, 10);
    return {
      id: String(delegation.id),
      fkDelegant: String(delegation.fkDelegant),
      fkDelegataire: String(delegation.fkDelegataire),
      perimetreUserPerimetreIds: delegation.perimetreUserPerimetreIds.map(String),
      permissions: delegation.permissions,
      motif: delegation.motif,
      dateDebut: delegation.dateDebut,
      dateFin: delegation.dateFin,
      actif: delegation.actif,
      revoqueeLe: delegation.revoqueeLe ? delegation.revoqueeLe.toISOString() : null,
      fkRevoquePar:
        delegation.fkRevoquePar === null ? null : String(delegation.fkRevoquePar),
      motifRevocation: delegation.motifRevocation,
      statut:
        delegation.actif && delegation.dateFin >= today
          ? 'ACTIVE'
          : 'EXPIREE',
      warnings,
    };
  }

  @Post('delegations/:id/revoquer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Révoquer une délégation. Autorisé : délégant ou ADMIN (DELEGATION.GERER).',
  })
  @ApiOkResponse({ type: DelegationResponseDto })
  @ApiForbiddenResponse()
  async revoquer(
    @Param('id') id: string,
    @Body() dto: RevoquerDelegationDto,
    @CurrentUser() user: AuthUser,
  ): Promise<DelegationResponseDto> {
    const isAdmin = await this.permissionsService.hasPermission(
      user.userId,
      ['DELEGATION.GERER'],
    );
    const d = await this.service.revoquer(id, dto, user, isAdmin);
    const today = new Date().toISOString().slice(0, 10);
    return {
      id: String(d.id),
      fkDelegant: String(d.fkDelegant),
      fkDelegataire: String(d.fkDelegataire),
      perimetreUserPerimetreIds: d.perimetreUserPerimetreIds.map(String),
      permissions: d.permissions,
      motif: d.motif,
      dateDebut: d.dateDebut,
      dateFin: d.dateFin,
      actif: d.actif,
      revoqueeLe: d.revoqueeLe ? d.revoqueeLe.toISOString() : null,
      fkRevoquePar: d.fkRevoquePar === null ? null : String(d.fkRevoquePar),
      motifRevocation: d.motifRevocation,
      statut: d.revoqueeLe
        ? 'REVOQUEE'
        : !d.actif || d.dateFin < today
          ? 'EXPIREE'
          : 'ACTIVE',
    };
  }

  @Get('delegations/recues')
  @ApiOperation({
    summary: 'Liste les délégations reçues par l\'utilisateur courant.',
  })
  @ApiOkResponse({ type: DelegationResponseDto, isArray: true })
  async mesRecues(
    @Query() query: ListerDelegationsQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<DelegationResponseDto[]> {
    return this.service.listerEnTantQueDelegataire(user.userId, {
      actif: query.actif,
      dateRef: query.dateRef,
    });
  }

  @Get('delegations/emises')
  @ApiOperation({
    summary: 'Liste les délégations émises par l\'utilisateur courant.',
  })
  @ApiOkResponse({ type: DelegationResponseDto, isArray: true })
  async mesEmises(
    @Query() query: ListerDelegationsQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<DelegationResponseDto[]> {
    return this.service.listerEmises(user.userId, {
      actif: query.actif,
      statut: query.statut,
    });
  }

  @Get('admin/delegations')
  @RequirePermissions('DELEGATION.GERER')
  @ApiOperation({
    summary:
      'Liste toutes les délégations (admin) avec filtres. Permission DELEGATION.GERER.',
  })
  @ApiOkResponse({ type: DelegationResponseDto, isArray: true })
  async toutes(
    @Query() query: ListerDelegationsQueryDto,
  ): Promise<DelegationResponseDto[]> {
    return this.service.listerToutes(query);
  }
}
