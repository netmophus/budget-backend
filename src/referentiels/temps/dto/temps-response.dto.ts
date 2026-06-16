import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TempsResponseDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: '2026-05-01', format: 'date' })
  date!: string;

  @ApiProperty({ example: 2026 })
  annee!: number;

  @ApiProperty({ example: 2, minimum: 1, maximum: 4 })
  trimestre!: number;

  @ApiProperty({ example: 5, minimum: 1, maximum: 12 })
  mois!: number;

  @ApiProperty({ example: 1, minimum: 1, maximum: 31 })
  jour!: number;

  @ApiPropertyOptional({ example: 18, type: Number, nullable: true })
  semaineIso!: number | null;

  @ApiProperty({ example: false })
  jourOuvre!: boolean;

  @ApiProperty({ example: false })
  estFinDeMois!: boolean;

  @ApiProperty({ example: false })
  estFinDeTrimestre!: boolean;

  @ApiProperty({ example: false })
  estFinDAnnee!: boolean;

  @ApiProperty({ example: 2026 })
  exerciceFiscal!: number;

  @ApiProperty({ example: 'Mai 2026' })
  libelleMois!: string;

  @ApiPropertyOptional({
    example: 'Aïd el-Fitr 2027',
    type: String,
    nullable: true,
    description: 'Libellé du jour férié (saisi par l’ADMIN). Lot 8.7.A.',
  })
  libelleJour!: string | null;
}
