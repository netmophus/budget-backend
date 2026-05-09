/**
 * MePasswordController (Lot 6.4.A) — endpoint dédié au changement de
 * mot de passe par l'utilisateur courant.
 *
 *   PATCH /api/v1/me/password
 *
 * Whitelisted via `@AllowExpiredPassword()` — accessible même si le
 * JWT contient `dcm=true` (mdp temporaire forcé) ou `mdpExpire=true`.
 *
 * En réponse : nouveau couple access/refresh sans flags. Le frontend
 * remplace ses tokens et débloque l'API.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { AuthService, type IssuedTokens } from './auth.service';
import { AllowExpiredPassword } from './decorators/allow-expired-password.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from './decorators/current-user.decorator';
import { ChangerMdpDto } from './dto/changer-mdp.dto';

interface ChangerMdpResponse extends IssuedTokens {
  user: { id: string; email: string; nom: string; prenom: string };
  mdpExpire: false;
  doitChangerMdp: false;
}

@ApiTags('me-password')
@ApiBearerAuth()
@Controller('me')
export class MePasswordController {
  constructor(private readonly authService: AuthService) {}

  @Patch('password')
  @HttpCode(HttpStatus.OK)
  @AllowExpiredPassword()
  @ApiOperation({
    summary:
      'Change le mot de passe de l\'utilisateur courant. Politique : ' +
      '≥12 chars + maj + minuscule + chiffre + caractère spécial. ' +
      'Émet un nouveau couple access/refresh sans flags d\'expiration.',
  })
  @ApiOkResponse({ description: 'Mot de passe changé + nouveaux tokens.' })
  @ApiUnauthorizedResponse({ description: 'Ancien mot de passe incorrect.' })
  async changerMdp(
    @Body() dto: ChangerMdpDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ChangerMdpResponse> {
    const ip = (req.ip ?? null) as string | null;
    const userAgent = (req.headers['user-agent'] ?? null) as string | null;
    const result = await this.authService.changerMdp(
      user.userId,
      dto.ancienMdp,
      dto.nouveauMdp,
      ip,
      userAgent,
    );
    return {
      ...result.tokens,
      user: {
        id: result.user.id,
        email: result.user.email,
        nom: result.user.nom,
        prenom: result.user.prenom,
      },
      mdpExpire: false,
      doitChangerMdp: false,
    };
  }
}
