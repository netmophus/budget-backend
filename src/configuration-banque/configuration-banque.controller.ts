/**
 * ConfigurationBanqueController (Lot B1).
 *
 *   GET    /configuration-banque              (BANQUE.GERER) — config complète
 *   PUT    /configuration-banque              (BANQUE.GERER) — mise à jour
 *   POST   /configuration-banque/membres      (BANQUE.GERER) — ajout membre
 *   PUT    /configuration-banque/membres/:id  (BANQUE.GERER) — modif membre
 *   DELETE /configuration-banque/membres/:id  (BANQUE.GERER) — désactive membre
 *   GET    /configuration-banque/public       (@Public)      — branding front
 *
 * La route publique bypasse le JwtAuthGuard global (@Public) et expose
 * une whitelist stricte (cf. getConfigurationPublique).
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
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ConfigurationBanqueService } from './configuration-banque.service';
import {
  ConfigurationBanquePubliqueDto,
  ConfigurationBanqueResponseDto,
  CreateMembreComiteDto,
  MembreComiteResponseDto,
  UpdateConfigurationBanqueDto,
  UpdateMembreComiteDto,
} from './dto/configuration-banque.dto';

@ApiTags('configuration-banque')
@Controller('configuration-banque')
export class ConfigurationBanqueController {
  constructor(private readonly svc: ConfigurationBanqueService) {}

  // ─── Branding public (sans auth) ────────────────────────────────

  @Get('public')
  @Public()
  @ApiOperation({
    summary:
      'Configuration publique (sans authentification) pour le branding du ' +
      'splash / login : nom, sigle, couleurs, logo. Whitelist stricte.',
  })
  @ApiOkResponse({ type: ConfigurationBanquePubliqueDto })
  getPublique(): Promise<ConfigurationBanquePubliqueDto> {
    return this.svc.getConfigurationPublique();
  }

  // ─── Administration (BANQUE.GERER) ──────────────────────────────

  @Get()
  @ApiBearerAuth()
  @RequirePermissions('BANQUE.GERER')
  @ApiOperation({
    summary: 'Configuration complète de la banque + membres du Comité.',
  })
  @ApiOkResponse({ type: ConfigurationBanqueResponseDto })
  getConfiguration(): Promise<ConfigurationBanqueResponseDto> {
    return this.svc.getConfiguration();
  }

  @Put()
  @ApiBearerAuth()
  @RequirePermissions('BANQUE.GERER')
  @ApiOperation({
    summary: 'Met à jour la configuration institutionnelle (audit tracé).',
  })
  @ApiOkResponse({ type: ConfigurationBanqueResponseDto })
  updateConfiguration(
    @Body() dto: UpdateConfigurationBanqueDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ConfigurationBanqueResponseDto> {
    return this.svc.updateConfiguration(dto, user);
  }

  @Post('membres')
  @ApiBearerAuth()
  @RequirePermissions('BANQUE.GERER')
  @ApiOperation({ summary: 'Ajoute un membre au Comité Budgétaire.' })
  @ApiOkResponse({ type: MembreComiteResponseDto })
  ajouterMembre(
    @Body() dto: CreateMembreComiteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<MembreComiteResponseDto> {
    return this.svc.ajouterMembre(dto, user);
  }

  @Put('membres/:id')
  @ApiBearerAuth()
  @RequirePermissions('BANQUE.GERER')
  @ApiOperation({ summary: 'Modifie un membre du Comité.' })
  @ApiOkResponse({ type: MembreComiteResponseDto })
  modifierMembre(
    @Param('id') id: string,
    @Body() dto: UpdateMembreComiteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<MembreComiteResponseDto> {
    return this.svc.modifierMembre(id, dto, user);
  }

  @Delete('membres/:id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @RequirePermissions('BANQUE.GERER')
  @ApiOperation({
    summary: 'Désactive un membre du Comité (suppression logique).',
  })
  @ApiOkResponse({ type: MembreComiteResponseDto })
  desactiverMembre(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<MembreComiteResponseDto> {
    return this.svc.desactiverMembre(id, user);
  }
}
