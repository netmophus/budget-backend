/**
 * NotificationsController (Lot 4.3) — endpoints admin email-log
 * et préférences user.
 *
 * Routes :
 *  GET    /admin/email-log            (USER.GERER) — listing filtré
 *  GET    /admin/email-log/stats      (USER.GERER) — statistiques 7/30 j
 *  GET    /admin/email-log/:id        (USER.GERER) — détail
 *  POST   /admin/email-log/:id/rejouer (USER.GERER) — retry manuel
 *  GET    /me/preferences-notifications      (auth) — lire mes prefs
 *  PUT    /me/preferences-notifications      (auth) — màj mes prefs
 *
 * Utilise USER.GERER pour la partie admin (cohérent avec les pages
 * utilisateurs/affectations existantes — pas besoin d'un nouveau code
 * permission EMAIL.LIRE pour le moment).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Repository } from 'typeorm';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { User } from '../users/entities/user.entity';
import {
  EmailLogResponseDto,
  ListerEmailLogQueryDto,
  PreferencesNotificationsDto,
  StatistiquesEmailDto,
} from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller()
export class NotificationsController {
  constructor(
    private readonly notifs: NotificationsService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ─── Admin email-log ────────────────────────────────────────────

  @Get('admin/email-log')
  @RequirePermissions('USER.GERER')
  @ApiOperation({ summary: 'Lister le journal des emails (admin).' })
  @ApiOkResponse()
  async lister(
    @Query() query: ListerEmailLogQueryDto,
  ): Promise<{ items: EmailLogResponseDto[]; total: number }> {
    return this.notifs.listerLogs(query);
  }

  @Get('admin/email-log/stats')
  @RequirePermissions('USER.GERER')
  @ApiOperation({ summary: 'Statistiques 7/30 jours par statut & événement.' })
  @ApiOkResponse({ type: StatistiquesEmailDto })
  async stats(): Promise<StatistiquesEmailDto> {
    return this.notifs.statistiques();
  }

  @Post('admin/email-log/:id/rejouer')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('USER.GERER')
  @ApiOperation({ summary: 'Rejouer un email en échec.' })
  async rejouer(@Param('id') id: string): Promise<{ envoye: boolean }> {
    const r = await this.notifs.rejouer(id);
    return { envoye: r.envoye };
  }

  // ─── Préférences utilisateur courant ────────────────────────────

  @Get('me/preferences-notifications')
  @ApiOperation({ summary: 'Lire mes préférences de notifications.' })
  @ApiOkResponse({ type: PreferencesNotificationsDto })
  async lirePreferences(
    @CurrentUser() user: AuthUser,
  ): Promise<PreferencesNotificationsDto> {
    const u = await this.userRepo.findOne({ where: { id: user.userId } });
    if (!u) throw new NotFoundException(`User ${user.userId} introuvable.`);
    return {
      notificationsEmailActives: u.notificationsEmailActives,
      notificationsEmailTypes: u.notificationsEmailTypes as never,
    };
  }

  @Put('me/preferences-notifications')
  @ApiOperation({ summary: 'Mettre à jour mes préférences de notifications.' })
  @ApiOkResponse({ type: PreferencesNotificationsDto })
  async majPreferences(
    @Body() dto: PreferencesNotificationsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PreferencesNotificationsDto> {
    const u = await this.userRepo.findOne({ where: { id: user.userId } });
    if (!u) throw new NotFoundException(`User ${user.userId} introuvable.`);
    u.notificationsEmailActives = dto.notificationsEmailActives;
    u.notificationsEmailTypes = dto.notificationsEmailTypes;
    u.dateModification = new Date();
    u.utilisateurModification = user.email;
    await this.userRepo.save(u);
    return {
      notificationsEmailActives: u.notificationsEmailActives,
      notificationsEmailTypes: u.notificationsEmailTypes as never,
    };
  }
}
