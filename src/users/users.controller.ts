import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import {
  EffectivePermission,
  PermissionsService,
} from '../auth/permissions.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { PaginatedUsersDto } from './dto/paginated-users.dto';
import { UserDetailResponseDto } from './dto/user-detail-response.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly permissionsService: PermissionsService,
  ) {}

  @Get()
  @RequirePermissions('USER.LIRE')
  @ApiOperation({
    summary: 'Liste paginée des utilisateurs (requiert USER.LIRE).',
  })
  @ApiOkResponse({ type: PaginatedUsersDto })
  findAll(@Query() query: ListUsersQueryDto): Promise<PaginatedUsersDto> {
    return this.usersService.findAll(query);
  }

  @Get('me/permissions')
  @ApiOperation({
    summary:
      'Permissions effectives de l’utilisateur courant (utilisé par le frontend pour adapter l’UI).',
  })
  @ApiOkResponse({ description: 'Liste des permissions effectives.' })
  meEffectivePermissions(
    @CurrentUser() user: AuthUser,
  ): Promise<EffectivePermission[]> {
    return this.permissionsService.getEffectivePermissions(user.userId);
  }

  @Get(':id')
  @RequirePermissions('USER.LIRE')
  @ApiOperation({
    summary:
      'Détail utilisateur enrichi des rôles et permissions effectives (requiert USER.LIRE).',
  })
  @ApiOkResponse({ type: UserDetailResponseDto })
  findOne(@Param('id') id: string): Promise<UserDetailResponseDto> {
    return this.usersService.findOne(id);
  }
}
