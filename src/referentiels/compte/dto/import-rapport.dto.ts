import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type ImportErrorCode =
  | 'PARENT_INCONNU'
  | 'VALIDATION_ZOD'
  | 'CYCLE_DETECTE'
  | 'INCOHERENCE_NIVEAU'
  | 'INCOHERENCE_CLASSE'
  | 'AUTRE';

export class ImportErrorDto {
  @ApiProperty({ example: 42 })
  ligne!: number;

  @ApiPropertyOptional({ example: '601100' })
  codeCompte?: string;

  @ApiProperty({ example: 'Parent inconnu : 999' })
  message!: string;

  @ApiProperty({
    enum: [
      'PARENT_INCONNU',
      'VALIDATION_ZOD',
      'CYCLE_DETECTE',
      'INCOHERENCE_NIVEAU',
      'INCOHERENCE_CLASSE',
      'AUTRE',
    ],
  })
  code!: ImportErrorCode;
}

export class ImportRapportDto {
  @ApiProperty({ example: 95 })
  totalLines!: number;

  @ApiProperty({ example: 92 })
  imported!: number;

  @ApiProperty({ example: 0, description: 'Mises à jour SCD2 (mode upsert).' })
  updated!: number;

  @ApiProperty({
    example: 1,
    description:
      'Lignes ignorées (déjà existant en mode insert-only ou no-op).',
  })
  skipped!: number;

  @ApiProperty({ type: [ImportErrorDto] })
  errors!: ImportErrorDto[];

  @ApiProperty({ example: 1234 })
  dureeMs!: number;
}
