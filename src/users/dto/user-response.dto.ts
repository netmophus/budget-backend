import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'admin@miznas.local' })
  email!: string;

  @ApiProperty({ example: 'Admin' })
  nom!: string;

  @ApiProperty({ example: 'MIZNAS' })
  prenom!: string;

  @ApiProperty({ example: true })
  estActif!: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  dateDerniereConnexion!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  dateCreation!: Date;
}
