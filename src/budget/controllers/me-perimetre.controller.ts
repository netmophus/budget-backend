/**
 * MePerimetreController (Lot 7.3) — résumé du périmètre RBAC du user
 * connecté, utilisé par l'UI pour afficher des pills d'en-tête comme
 * "Mon périmètre (12 CR)".
 *
 *   GET /api/v1/me/perimetre   (auth uniquement, aucune permission requise)
 */
import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { MePerimetreResumeDto } from '../dto/me-perimetre.dto';
import { PerimetreService } from '../services/perimetre.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MePerimetreController {
  constructor(private readonly perimetreService: PerimetreService) {}

  @Get('perimetre')
  @ApiOperation({
    summary:
      'Résumé du périmètre RBAC du user connecté (nb CR + flag admin global). Auth uniquement, pas de permission applicative.',
  })
  @ApiOkResponse({ type: MePerimetreResumeDto })
  async getMonPerimetre(
    @CurrentUser() user: AuthUser,
  ): Promise<MePerimetreResumeDto> {
    return this.perimetreService.getResume(user.userId);
  }
}
