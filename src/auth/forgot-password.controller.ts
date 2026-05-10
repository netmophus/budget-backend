/**
 * ForgotPasswordController (Lot 6.5.A) — endpoints publics
 * (sans JWT, sans PasswordExpiredGuard) du flux forgot password.
 *
 *  - POST /auth/forgot-password : rate-limité 3/15min/IP. Réponse
 *    identique pour email connu/inconnu (anti-énumération).
 *  - POST /auth/reset-password  : valide le token + applique le
 *    nouveau mdp. NE retourne PAS de tokens JWT — le user doit
 *    se reconnecter normalement.
 *
 * Les 2 endpoints sont marqués `@Public()` pour bypasser le
 * JwtAuthGuard global et `@AllowExpiredPassword()` pour bypasser
 * le PasswordExpiredGuard global (un user dont le mdp est expiré
 * doit pouvoir lancer un forgot-password si son mdp expire entre
 * 2 connexions, etc.).
 */
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { AllowExpiredPassword } from './decorators/allow-expired-password.decorator';
import { Public } from './decorators/public.decorator';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/forgot-password.dto';
import { ForgotPasswordRateLimitGuard } from './guards/forgot-password-rate-limit.guard';
import {
  ForgotPasswordResult,
  PasswordResetService,
  ResetPasswordResult,
} from './password-reset.service';

@ApiTags('auth')
@Controller('auth')
export class ForgotPasswordController {
  constructor(private readonly passwordResetService: PasswordResetService) {}

  @Post('forgot-password')
  @Public()
  @AllowExpiredPassword()
  @UseGuards(ForgotPasswordRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Demander un lien de réinitialisation de mot de passe (public). ' +
      'Réponse identique pour email connu ou inconnu (anti-énumération).',
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({
    description: 'Réponse uniforme — toujours success=true.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: {
          type: 'string',
          example:
            "Si l'email existe, un lien de réinitialisation a été envoyé.",
        },
      },
    },
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit dépassé (3 demandes / 15 min / IP).',
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ForgotPasswordResult> {
    const userAgent = (req.headers['user-agent'] ?? null) as string | null;
    return this.passwordResetService.demanderReset(dto.email, ip, userAgent);
  }

  @Post('reset-password')
  @Public()
  @AllowExpiredPassword()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Réinitialiser le mot de passe via le lien reçu par email (public). ' +
      'Le token est consommé en une seule fois ; le user doit se reconnecter.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({
    description: 'Mot de passe changé.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: {
          type: 'string',
          example:
            'Mot de passe changé avec succès. Vous pouvez maintenant vous connecter.',
        },
      },
    },
  })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Ip() ip: string,
    @Req() req: Request,
    @Headers('user-agent') userAgent: string | null,
  ): Promise<ResetPasswordResult> {
    return this.passwordResetService.executerReset(
      dto.token,
      dto.nouveauMdp,
      ip,
      userAgent,
    );
  }
}
