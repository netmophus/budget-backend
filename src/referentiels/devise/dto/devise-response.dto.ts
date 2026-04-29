import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DeviseResponseDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'XOF' })
  codeIso!: string;

  @ApiProperty({ example: 'Franc CFA BCEAO' })
  libelle!: string;

  @ApiPropertyOptional({ example: 'F CFA', nullable: true })
  symbole!: string | null;

  @ApiProperty({ example: 0 })
  nbDecimales!: number;

  @ApiProperty({ example: true })
  estDevisePivot!: boolean;

  @ApiProperty({ example: true })
  estActive!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  dateCreation!: Date;

  @ApiProperty({ example: 'system' })
  utilisateurCreation!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  dateModification!: Date | null;

  @ApiPropertyOptional({ example: 'admin@miznas.local', nullable: true })
  utilisateurModification!: string | null;
}
