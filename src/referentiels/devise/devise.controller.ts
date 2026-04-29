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
import { DeviseService } from './devise.service';
import { CreateDeviseDto } from './dto/create-devise.dto';
import { DeviseResponseDto } from './dto/devise-response.dto';
import { ListDevisesQueryDto } from './dto/list-devises-query.dto';
import { PaginatedDevisesDto } from './dto/paginated-devises.dto';
import { UpdateDeviseDto } from './dto/update-devise.dto';

@ApiTags('referentiels-devise')
@ApiBearerAuth()
@Controller('referentiels/devises')
export class DeviseController {
  constructor(private readonly deviseService: DeviseService) {}

  @Get()
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({
    summary: 'Liste paginée des devises (filtres codeIso, estActive).',
  })
  @ApiOkResponse({ type: PaginatedDevisesDto })
  findAll(
    @Query() query: ListDevisesQueryDto,
  ): Promise<PaginatedDevisesDto> {
    return this.deviseService.findAll(query);
  }

  @Get('pivot')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Récupère la devise pivot du système (XOF).' })
  @ApiOkResponse({ type: DeviseResponseDto })
  findPivot(): Promise<DeviseResponseDto> {
    return this.deviseService.findPivot();
  }

  @Get(':id')
  @RequirePermissions('REFERENTIEL.LIRE')
  @ApiOperation({ summary: 'Récupère une devise par son id.' })
  @ApiOkResponse({ type: DeviseResponseDto })
  @ApiNotFoundResponse({ description: 'Devise introuvable' })
  findOne(@Param('id') id: string): Promise<DeviseResponseDto> {
    return this.deviseService.findOne(id);
  }

  @Post()
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({ typeAction: 'CREATE', entiteCible: 'dim_devise' })
  @ApiOperation({
    summary: 'Crée une nouvelle devise (requiert REFERENTIEL.GERER).',
  })
  @ApiCreatedResponse({ type: DeviseResponseDto })
  @ApiConflictResponse({
    description:
      'Code ISO déjà existant ou tentative de seconde devise pivot.',
  })
  create(
    @Body() dto: CreateDeviseDto,
    @CurrentUser() user: AuthUser,
  ): Promise<DeviseResponseDto> {
    return this.deviseService.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('REFERENTIEL.GERER')
  @Auditable({
    typeAction: 'UPDATE',
    entiteCible: 'dim_devise',
    extractIdCible: (req) => (req.params as { id?: string }).id ?? null,
  })
  @ApiOperation({
    summary:
      'Modifie une devise existante (libellé, symbole, décimales, pivot, actif).',
  })
  @ApiOkResponse({ type: DeviseResponseDto })
  @ApiNotFoundResponse({ description: 'Devise introuvable' })
  @ApiConflictResponse({
    description:
      'Désactivation/retrait pivot sur la devise pivot, ou tentative de seconde devise pivot.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDeviseDto,
    @CurrentUser() user: AuthUser,
  ): Promise<DeviseResponseDto> {
    return this.deviseService.update(id, dto, user.email);
  }

  @Delete(':id')
  @RequirePermissions('REFERENTIEL.GERER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    typeAction: 'DELETE',
    entiteCible: 'dim_devise',
    extractIdCible: (req) => (req.params as { id?: string }).id ?? null,
  })
  @ApiOperation({
    summary: 'Désactive une devise (soft-delete : est_active=false).',
  })
  @ApiNoContentResponse({ description: 'Devise désactivée.' })
  @ApiNotFoundResponse({ description: 'Devise introuvable' })
  @ApiConflictResponse({
    description: 'Tentative de désactivation de la devise pivot.',
  })
  async desactiver(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    const result = await this.deviseService.desactiver(id, user.email);
    if (!result) {
      throw new NotFoundException();
    }
  }
}
