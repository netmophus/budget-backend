/**
 * Contrôleurs du workflow de validation par CR (Lot workflow CR, PR A).
 *
 * Endpoints ADDITIFS — les endpoints version-globale existants
 * (/referentiels/versions/:id/{soumettre,valider,rejeter,publier}) ne
 * sont PAS touchés (coexistence, décision Option A).
 *
 * Le `versionId` est passé en query (`?versionId=`) sur les routes CR :
 * un statut est porté par le couple (version × CR).
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
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CrWorkflowService } from './cr-workflow.service';
import {
  CrStatutResponseDto,
  StatutsCrsResponseDto,
} from './dto/cr-statut-response.dto';
import {
  CrContexteQueryDto,
  RejeterCrDto,
  RouvrirCrDto,
  SoumettreComiteDto,
  SoumettreCrDto,
  ValiderCrDto,
} from './dto/cr-workflow.dto';

@ApiTags('Budget — Workflow par CR')
@Controller('budget')
export class CrWorkflowController {
  constructor(private readonly service: CrWorkflowService) {}

  @Post('cr/:crCode/soumettre')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('BUDGET.SOUMETTRE')
  @ApiOperation({
    summary:
      'Soumet la saisie d’un CR à validation (EN_SAISIE → SOUMIS). ' +
      'CR dans le périmètre + ≥ 1 ligne budgétaire requis.',
  })
  @ApiQuery({ name: 'versionId', required: true })
  @ApiOkResponse({ type: CrStatutResponseDto })
  soumettre(
    @Param('crCode') crCode: string,
    @Query() query: CrContexteQueryDto,
    @Body() dto: SoumettreCrDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CrStatutResponseDto> {
    return this.service.soumettre(
      query.versionId,
      crCode,
      dto.commentaire,
      user,
    );
  }

  @Post('cr/:crCode/valider')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('BUDGET.VALIDER')
  @ApiOperation({
    summary:
      'Valide la saisie d’un CR (SOUMIS → VALIDE). CR dans le ' +
      'périmètre du validateur.',
  })
  @ApiQuery({ name: 'versionId', required: true })
  @ApiOkResponse({ type: CrStatutResponseDto })
  valider(
    @Param('crCode') crCode: string,
    @Query() query: CrContexteQueryDto,
    @Body() dto: ValiderCrDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CrStatutResponseDto> {
    return this.service.valider(query.versionId, crCode, dto.commentaire, user);
  }

  @Post('cr/:crCode/rejeter')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('BUDGET.VALIDER')
  @ApiOperation({
    summary:
      'Rejette la saisie d’un CR (SOUMIS → EN_SAISIE). Motif obligatoire.',
  })
  @ApiQuery({ name: 'versionId', required: true })
  @ApiOkResponse({ type: CrStatutResponseDto })
  rejeter(
    @Param('crCode') crCode: string,
    @Query() query: CrContexteQueryDto,
    @Body() dto: RejeterCrDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CrStatutResponseDto> {
    return this.service.rejeter(query.versionId, crCode, dto.motif, user);
  }

  @Post('cr/:crCode/rouvrir')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('BUDGET.VALIDER')
  @ApiOperation({
    summary:
      'Rouvre un CR validé (VALIDE → EN_SAISIE). Réservé au validateur ' +
      'ayant validé ; version non encore soumise au Comité. Motif obligatoire.',
  })
  @ApiQuery({ name: 'versionId', required: true })
  @ApiOkResponse({ type: CrStatutResponseDto })
  rouvrir(
    @Param('crCode') crCode: string,
    @Query() query: CrContexteQueryDto,
    @Body() dto: RouvrirCrDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CrStatutResponseDto> {
    return this.service.rouvrir(query.versionId, crCode, dto.motif, user);
  }

  @Get('cr/:crCode/statut')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({ summary: 'Statut courant d’un CR pour une version.' })
  @ApiQuery({ name: 'versionId', required: true })
  @ApiOkResponse({ type: CrStatutResponseDto })
  getStatut(
    @Param('crCode') crCode: string,
    @Query() query: CrContexteQueryDto,
  ): Promise<CrStatutResponseDto> {
    return this.service.getStatut(query.versionId, crCode);
  }

  @Get('version/:versionId/statuts-crs')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      'Vue d’ensemble des CR attendus d’une version (snapshot) + ' +
      'compteur « X/Y validés ».',
  })
  @ApiOkResponse({ type: StatutsCrsResponseDto })
  getStatutsCrs(
    @Param('versionId') versionId: string,
  ): Promise<StatutsCrsResponseDto> {
    return this.service.getStatutsCrs(versionId);
  }
}

/**
 * Endpoint version (soumission au Comité). Base path partagée avec
 * VersionController (référentiels/versions) — route additive, sans
 * collision avec les transitions version-globale existantes.
 */
@ApiTags('Budget — Workflow par CR')
@Controller('referentiels/versions')
export class VersionComiteController {
  constructor(private readonly service: CrWorkflowService) {}

  @Post(':id/soumettre-comite')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('BUDGET.COORDONNER')
  @ApiOperation({
    summary:
      'Soumet une version pré-validée au Comité (PRE_VALIDE → ' +
      'SOUMIS_COMITE). Réservé au Coordinateur.',
  })
  async soumettreComite(
    @Param('id') id: string,
    @Body() dto: SoumettreComiteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ id: string; codeVersion: string; statut: string }> {
    const v = await this.service.soumettreComite(id, dto.commentaire, user);
    return { id: String(v.id), codeVersion: v.codeVersion, statut: v.statut };
  }
}
