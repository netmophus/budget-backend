import { ApiProperty } from '@nestjs/swagger';
import { PermissionResponseDto } from './permission-response.dto';

export class RoleResponseDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'ADMIN' })
  codeRole!: string;

  @ApiProperty({ example: 'Administrateur système' })
  libelle!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ example: true })
  estActif!: boolean;

  @ApiProperty({ type: [PermissionResponseDto] })
  permissions!: PermissionResponseDto[];
}
