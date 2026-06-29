import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
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
  AjouterPermissionDto,
  RetirerPermissionDto,
  RolePermissionMutationDto,
} from './dto/role-permission-mutation.dto';
import { RoleResponseDto } from './dto/role-response.dto';
import { RolePermissionService } from './role-permission.service';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
@RequirePermissions('ROLE.LIRE')
export class RolesController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly rolePermissionService: RolePermissionService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Liste des rôles avec leurs permissions (requiert ROLE.LIRE).',
  })
  @ApiOkResponse({ type: [RoleResponseDto] })
  findAll(): Promise<RoleResponseDto[]> {
    return this.rolesService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Détail d’un rôle (requiert ROLE.LIRE).',
  })
  @ApiOkResponse({ type: RoleResponseDto })
  findOne(@Param('id') id: string): Promise<RoleResponseDto> {
    return this.rolesService.findOne(id);
  }

  // ─── Matrice rôle × permission (écriture) ──────────────────────
  // Method-level @RequirePermissions('ROLE.GERER') prime sur le
  // ROLE.LIRE de la classe (Reflector.getAllAndOverride → handler gagne).

  @Post(':id/permissions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ROLE.GERER')
  @ApiOperation({
    summary:
      'Ajouter une permission à un rôle (ROLE.GERER). Idempotent : 200 ' +
      'même si le lien existe déjà (champ deja=true).',
  })
  @ApiOkResponse({ type: RolePermissionMutationDto })
  ajouterPermission(
    @Param('id') id: string,
    @Body() dto: AjouterPermissionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RolePermissionMutationDto> {
    return this.rolePermissionService.ajouterPermission(
      id,
      dto.fkPermission,
      user,
      dto.motif,
    );
  }

  @Delete(':id/permissions/:permId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ROLE.GERER')
  @ApiOperation({
    summary:
      'Retirer une permission d’un rôle (ROLE.GERER). 403 si garde-fou ' +
      '(permission verrouillée sur ADMIN, ou anti-lockout ROLE.GERER).',
  })
  @ApiOkResponse({ type: RolePermissionMutationDto })
  retirerPermission(
    @Param('id') id: string,
    @Param('permId') permId: string,
    @Body() dto: RetirerPermissionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RolePermissionMutationDto> {
    return this.rolePermissionService.retirerPermission(
      id,
      permId,
      user,
      dto.motif,
    );
  }
}
