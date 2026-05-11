import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export type ImportMode = 'insert-only' | 'upsert';

export class ImportRequestDto {
  @ApiPropertyOptional({
    enum: ['insert-only', 'upsert'],
    default: 'insert-only',
    description:
      'insert-only : ignore silencieusement les codeCompte déjà existants. upsert : crée une nouvelle version SCD2 si un champ tracé diffère.',
  })
  @IsOptional()
  @IsIn(['insert-only', 'upsert'])
  mode?: ImportMode;
}
