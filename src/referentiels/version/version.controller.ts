import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Auditable } from '../../audit/decorators/auditable.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CreateVersionDto } from './dto/create-version.dto';
import { ListVersionsQueryDto } from './dto/list-versions-query.dto';
import { PaginatedVersionsDto } from './dto/paginated-versions.dto';
import { UpdateVersionDto } from './dto/update-version.dto';
import { VersionResponseDto } from './dto/version-response.dto';
import { VersionService } from './version.service';

@ApiTags('referentiels-version')
@ApiBearerAuth()
@Controller('referentiels/versions')
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  @Get()
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({
    summary:
      'Liste paginée des versions de budget (filtres exerciceFiscal, statut, typeVersion).',
  })
  @ApiOkResponse({ type: PaginatedVersionsDto })
  findAll(
    @Query() query: ListVersionsQueryDto,
  ): Promise<PaginatedVersionsDto> {
    return this.versionService.findAll(query);
  }

  @Get('par-code/:codeVersion')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Récupère une version par son code business.' })
  @ApiOkResponse({ type: VersionResponseDto })
  @ApiNotFoundResponse()
  findByCode(
    @Param('codeVersion') codeVersion: string,
  ): Promise<VersionResponseDto> {
    return this.versionService.findByCode(codeVersion);
  }

  @Get(':id')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Récupère une version par son id.' })
  @ApiOkResponse({ type: VersionResponseDto })
  @ApiNotFoundResponse()
  findOne(@Param('id') id: string): Promise<VersionResponseDto> {
    return this.versionService.findOne(id);
  }

  @Post()
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({ typeAction: 'CREATE', entiteCible: 'dim_version' })
  @ApiOperation({
    summary:
      "Crée une nouvelle version (statut='ouvert' systématique au Lot 3.1).",
  })
  @ApiCreatedResponse({ type: VersionResponseDto })
  @ApiConflictResponse({ description: 'codeVersion déjà existant.' })
  create(
    @Body() dto: CreateVersionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<VersionResponseDto> {
    return this.versionService.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({
    typeAction: 'UPDATE',
    entiteCible: 'dim_version',
    extractIdCible: (req) => (req.params as { id?: string }).id ?? null,
  })
  @ApiOperation({
    summary:
      "Modifie une version (uniquement si statut='ouvert' au Lot 3.1).",
  })
  @ApiOkResponse({ type: VersionResponseDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({
    description:
      "Statut différent de 'ouvert' — modification refusée (workflow Lot 3.3).",
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateVersionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<VersionResponseDto> {
    return this.versionService.update(id, dto, user.email);
  }

  @Delete(':id')
  @RequirePermissions('REFERENTIEL.GERER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    typeAction: 'DELETE',
    entiteCible: 'dim_version',
    extractIdCible: (req) => (req.params as { id?: string }).id ?? null,
  })
  @ApiOperation({
    summary: "Supprime une version (uniquement si statut='ouvert').",
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({
    description: "Statut différent de 'ouvert' — suppression refusée.",
  })
  async remove(@Param('id') id: string): Promise<void> {
    const ok = await this.versionService.softDelete(id);
    if (!ok) throw new NotFoundException();
  }
}
