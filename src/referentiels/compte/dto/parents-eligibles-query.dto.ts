import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const CLASSES_PCB: readonly string[] = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
];

/**
 * Query de l'endpoint `GET /referentiels/comptes/parents-eligibles`.
 * Renvoie les comptes éligibles comme parent d'un compte de la classe
 * `classe` et du niveau `niveau` : niveau strictement inférieur, même
 * classe, courants + actifs, et (mode édition) hors descendants de
 * `excludeId`.
 */
export class ParentsEligiblesQueryDto {
  @ApiProperty({ example: '6', enum: CLASSES_PCB })
  @IsString()
  @IsIn(CLASSES_PCB)
  classe!: string;

  @ApiProperty({
    example: 5,
    minimum: 1,
    maximum: 6,
    description: 'Niveau du compte enfant. Les parents auront un niveau < N.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6)
  niveau!: number;

  @ApiPropertyOptional({
    description:
      'Id du compte en cours d’édition : lui-même et ses descendants ' +
      'sont exclus de la liste (anti-cycle).',
  })
  @IsOptional()
  @IsString()
  excludeId?: string;
}
