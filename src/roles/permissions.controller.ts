import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PermissionResponseDto } from './dto/permission-response.dto';
import { RolesService } from './roles.service';

@ApiTags('permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions('ROLE.LIRE')
  @ApiOperation({
    summary:
      'Liste des permissions disponibles (groupables par module). Requiert ROLE.LIRE.',
  })
  @ApiOkResponse({ type: [PermissionResponseDto] })
  findAll(): Promise<PermissionResponseDto[]> {
    return this.rolesService.findAllPermissions();
  }
}
