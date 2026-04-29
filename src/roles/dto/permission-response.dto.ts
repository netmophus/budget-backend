import { ApiProperty } from '@nestjs/swagger';

export class PermissionResponseDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'USER.LIRE' })
  codePermission!: string;

  @ApiProperty({ example: 'Lire les utilisateurs' })
  libelle!: string;

  @ApiProperty({ example: 'USER' })
  module!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;
}
