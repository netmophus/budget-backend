/**
 * VersionsResumeController (Lot 7.3) — résumé agrégé d'une version
 * budgétaire, exposé pour la page « Versions à valider ».
 *
 *   GET /api/v1/budget/versions/:id/resume   (BUDGET.LIRE)
 */
import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ResumeVersionDto } from '../dto/resume-version.dto';
import { PerimetreService } from '../services/perimetre.service';
import { VersionsResumeService } from '../services/versions-resume.service';

@ApiTags('budget-versions-resume')
@ApiBearerAuth()
@Controller('budget/versions')
export class VersionsResumeController {
  constructor(
    private readonly service: VersionsResumeService,
    private readonly perimetreService: PerimetreService,
  ) {}

  @Get(':id/resume')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      "Résumé agrégé (somme FCFA, nb comptes, nb lignes) d'une version budget. Filtré par périmètre RBAC du user (Q5).",
  })
  @ApiOkResponse({ type: ResumeVersionDto })
  async getResume(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ResumeVersionDto> {
    const crAutorises = await this.perimetreService.getCrAutorisesPourUser(
      user.userId,
    );
    return this.service.getResumeVersion(id, crAutorises);
  }
}
