import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AuditService } from './audit.service';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import { PaginatedAuditLogsDto } from './dto/paginated-audit-logs.dto';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
@RequirePermissions('AUDIT.LIRE')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({
    summary:
      'Liste paginée du journal d’audit, filtrable. La consultation est elle-même tracée (LIRE_AUDIT).',
  })
  @ApiOkResponse({ type: PaginatedAuditLogsDto })
  findAll(
    @Query() query: ListAuditLogsQueryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<PaginatedAuditLogsDto> {
    return this.auditService.findAll(query, {
      caller: user.email,
      ipSource: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d’une ligne d’audit.' })
  @ApiOkResponse({ type: AuditLogResponseDto })
  findOne(@Param('id') id: string): Promise<AuditLogResponseDto> {
    return this.auditService.findOne(id);
  }
}
