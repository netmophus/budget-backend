/**
 * RealiseConfigController — toggle global du mode de saisie du réalisé.
 *
 *   GET   /configuration/realise   (CONFIGURATION.LIRE)  → mode courant
 *   PATCH /configuration/realise   (CONFIGURATION.GERER) → modifie le mode
 *
 * La lecture est ouverte à tout détenteur de CONFIGURATION.LIRE (tous
 * les rôles métier) car l'écran Saisie réalisé doit connaître le mode
 * pour adapter son UI. L'écriture est réservée à CONFIGURATION.GERER.
 */
import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import {
  ModifierRealiseModeDto,
  RealiseModeResponseDto,
} from './dto/realise-config.dto';
import { ParametreSystemeService } from './parametre-systeme.service';

@ApiTags('configuration-realise')
@ApiBearerAuth()
@Controller('configuration/realise')
export class RealiseConfigController {
  constructor(private readonly svc: ParametreSystemeService) {}

  @Get()
  @RequirePermissions('CONFIGURATION.LIRE')
  @ApiOperation({ summary: 'Mode de saisie du réalisé courant.' })
  @ApiOkResponse({ type: RealiseModeResponseDto })
  async getMode(): Promise<RealiseModeResponseDto> {
    return { mode: await this.svc.getModeSaisieRealise() };
  }

  @Patch()
  @RequirePermissions('CONFIGURATION.GERER')
  @ApiOperation({
    summary:
      'Modifie le mode de saisie du réalisé (CENTRALISE / DECENTRALISE / MIXTE). Action structurante tracée.',
  })
  @ApiOkResponse({ type: RealiseModeResponseDto })
  async setMode(
    @Body() dto: ModifierRealiseModeDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RealiseModeResponseDto> {
    const mode = await this.svc.setModeSaisieRealise(dto.mode, user);
    return { mode };
  }
}
