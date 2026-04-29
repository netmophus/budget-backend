import { ApiProperty } from '@nestjs/swagger';
import { EffectivePermission } from '../../auth/permissions.service';
import { UserResponseDto } from './user-response.dto';

export class UserRoleSummaryDto {
  @ApiProperty({ example: 'ADMIN' })
  code!: string;

  @ApiProperty({ example: 'Administrateur système' })
  libelle!: string;

  @ApiProperty({ example: 'global', nullable: true })
  perimetreType!: string | null;

  @ApiProperty({ example: null, nullable: true })
  perimetreId!: string | null;
}

export class UserDetailResponseDto extends UserResponseDto {
  @ApiProperty({ type: [UserRoleSummaryDto] })
  roles!: UserRoleSummaryDto[];

  @ApiProperty({
    description: 'Permissions effectives, dédupliquées par code.',
    type: 'array',
    items: { type: 'object' },
  })
  permissions!: EffectivePermission[];
}
