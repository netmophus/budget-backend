/**
 * UsersAdminController (Lot Administration) — endpoints
 * d'administration utilisateurs accessibles avec USER.GERER.
 *
 * Routes :
 *  POST   /admin/users
 *  PATCH  /admin/users/:id
 *  POST   /admin/users/:id/desactiver
 *  POST   /admin/users/:id/reactiver
 *  POST   /admin/users/:id/reset-password
 *  POST   /admin/users/:id/forcer-deconnexion
 *  GET    /admin/users/:id/historique-connexion
 *  GET    /admin/users/:id/roles
 *  POST   /admin/users/:id/roles
 *  DELETE /admin/users/:id/roles/:fkRole
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import {
  AttribuerRoleDto,
  CreerUserDto,
  HistoriqueConnexionItemDto,
  ModifierUserDto,
  MotifDto,
  ResetPasswordResponseDto,
  UserRoleResumeDto,
} from '../dto/admin-user.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { UsersAdminService } from '../services/users-admin.service';

@ApiTags('admin-users')
@ApiBearerAuth()
@Controller('admin/users')
export class UsersAdminController {
  constructor(private readonly svc: UsersAdminService) {}

  // ─── CRUD ──────────────────────────────────────────────────

  @Post()
  @RequirePermissions('USER.GERER')
  @ApiOperation({
    summary:
      'Créer un utilisateur (USER.GERER). Mot de passe initial ≥ 12 caractères, ≥ 1 rôle.',
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  creer(
    @Body() dto: CreerUserDto,
    @CurrentUser() user: AuthUser,
  ): Promise<UserResponseDto> {
    return this.svc.creer(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('USER.GERER')
  @ApiOperation({ summary: 'Modifier nom/prenom/email (USER.GERER).' })
  @ApiOkResponse({ type: UserResponseDto })
  modifier(
    @Param('id') id: string,
    @Body() dto: ModifierUserDto,
    @CurrentUser() user: AuthUser,
  ): Promise<UserResponseDto> {
    return this.svc.modifier(id, dto, user);
  }

  @Post(':id/desactiver')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('USER.GERER')
  @ApiOperation({
    summary:
      'Désactiver un utilisateur (USER.GERER). Auto-désactivation interdite.',
  })
  desactiver(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<UserResponseDto> {
    return this.svc.desactiver(id, user);
  }

  @Post(':id/reactiver')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('USER.GERER')
  @ApiOperation({ summary: 'Réactiver un utilisateur (USER.GERER).' })
  reactiver(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<UserResponseDto> {
    return this.svc.reactiver(id, user);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('USER.GERER')
  @ApiOperation({
    summary:
      "Générer un mot de passe temporaire (USER.GERER) et l'envoyer par " +
      "email à l'utilisateur (Lot 6.4.C — async via queue BullMQ). Le mot " +
      "de passe en clair n'apparaît PAS dans la réponse API.",
  })
  @ApiOkResponse({ type: ResetPasswordResponseDto })
  resetPassword(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ResetPasswordResponseDto> {
    return this.svc.resetPassword(id, user);
  }

  /**
   * Lot 6.4.C.2 — force `doit_changer_mdp = true` SANS reset du
   * mdp lui-même. Utile au support pour obliger un user à changer
   * son mdp à sa prochaine connexion (par exemple suite à une
   * suspicion de compromission, sans casser la session courante
   * tant qu'elle est valide). N'envoie PAS d'email.
   *
   * Cas d'usage smoke Playwright (Lot 6.4.C.2) : forcer le flag
   * sur un user de test avant l'exécution du flow.
   */
  @Post(':id/forcer-changement-mdp')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('USER.GERER')
  @ApiOperation({
    summary:
      'Force `doit_changer_mdp=true` sur un utilisateur (USER.GERER) — ' +
      'le user devra changer son mdp à sa prochaine connexion. Ne reset ' +
      'PAS le mdp existant (à utiliser seul ou avant un reset-password).',
  })
  @ApiOkResponse({ type: UserResponseDto })
  forcerChangementMdp(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<UserResponseDto> {
    return this.svc.forcerChangementMdp(id, user);
  }

  @Post(':id/forcer-deconnexion')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('USER.GERER')
  @ApiOperation({
    summary: 'Révoquer tous les refresh tokens actifs du user (USER.GERER).',
  })
  forcerDeconnexion(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ revoquees: boolean }> {
    return this.svc.forcerDeconnexion(id, user);
  }

  @Get(':id/historique-connexion')
  @RequirePermissions('USER.GERER')
  @ApiOperation({
    summary: '50 dernières lignes audit_log de connexion du user (USER.GERER).',
  })
  @ApiOkResponse({ type: [HistoriqueConnexionItemDto] })
  historiqueConnexion(
    @Param('id') id: string,
  ): Promise<HistoriqueConnexionItemDto[]> {
    return this.svc.getHistoriqueConnexion(id);
  }

  // ─── Rôles ─────────────────────────────────────────────────

  @Get(':id/roles')
  @RequirePermissions('USER.GERER')
  @ApiOperation({ summary: 'Lister les rôles actifs du user (USER.GERER).' })
  @ApiOkResponse({ type: [UserRoleResumeDto] })
  listerRoles(@Param('id') id: string): Promise<UserRoleResumeDto[]> {
    return this.svc.listerRoles(id);
  }

  @Post(':id/roles')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('USER.GERER')
  @ApiOperation({
    summary:
      'Attribuer un rôle au user (USER.GERER). Idempotent + réactive si inactif.',
  })
  @ApiOkResponse({ type: UserRoleResumeDto })
  attribuerRole(
    @Param('id') id: string,
    @Body() dto: AttribuerRoleDto,
    @CurrentUser() user: AuthUser,
  ): Promise<UserRoleResumeDto> {
    return this.svc.attribuerRole(id, dto, user);
  }

  @Delete(':id/roles/:fkRole')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('USER.GERER')
  @ApiOperation({
    summary:
      'Retirer un rôle (USER.GERER). Garde-fou : ≥ 1 rôle actif obligatoire.',
  })
  retirerRole(
    @Param('id') id: string,
    @Param('fkRole') fkRole: string,
    @Body() dto: MotifDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ retire: boolean }> {
    return this.svc.retirerRole(id, fkRole, dto, user);
  }
}
