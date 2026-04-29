import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService, CurrentUserView, IssuedTokens } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

interface LoginResponse extends IssuedTokens {
  user: { id: string; email: string; nom: string; prenom: string };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authentification par email + mot de passe.' })
  @ApiOkResponse({ description: 'Tokens émis.' })
  @ApiUnauthorizedResponse({ description: 'Email ou mot de passe incorrect.' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ): Promise<LoginResponse> {
    const ip = (req.ip ?? null) as string | null;
    const userAgent = (req.headers['user-agent'] ?? null) as string | null;
    const { tokens, user } = await this.authService.login(
      dto.email,
      dto.motDePasse,
      ip,
      userAgent,
    );
    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
      },
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Rotation du refresh token : émet un nouveau couple access/refresh et révoque l’ancien.',
  })
  @ApiOkResponse({ description: 'Nouveaux tokens émis.' })
  @ApiUnauthorizedResponse({
    description: 'Refresh invalide, expiré ou révoqué.',
  })
  refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
  ): Promise<IssuedTokens> {
    const ip = (req.ip ?? null) as string | null;
    const userAgent = (req.headers['user-agent'] ?? null) as string | null;
    return this.authService.refresh(dto.refreshToken, ip, userAgent);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Révoque un refresh token (ou tous les refresh actifs si aucun n’est fourni).',
  })
  @ApiResponse({ status: 204, description: 'Token(s) révoqué(s).' })
  async logout(
    @Body() dto: LogoutDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    const ip = (req.ip ?? null) as string | null;
    const userAgent = (req.headers['user-agent'] ?? null) as string | null;
    await this.authService.logout(
      user.userId,
      user.email,
      dto.refreshToken,
      ip,
      userAgent,
    );
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Profil utilisateur courant : rôles, permissions, périmètres.',
  })
  @ApiOkResponse({ description: 'Profil enrichi des rôles et permissions.' })
  @ApiUnauthorizedResponse({ description: 'Token absent ou invalide.' })
  me(@CurrentUser() user: AuthUser): Promise<CurrentUserView> {
    return this.authService.getCurrentUser(user.userId);
  }
}
