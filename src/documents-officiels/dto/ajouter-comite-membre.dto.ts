import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO entrée `POST /documents-officiels/campagnes/:id/comite`.
 *
 * L'`ordre` n'est PAS dans le DTO : auto-incrementé côté service en
 * fonction du nb actuel de membres (max + 1).
 */
export class AjouterComiteMembreDto {
  @ApiProperty({ example: '24', description: 'BIGINT user.id stringifié' })
  @IsString()
  fkUser!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  estObligatoire?: boolean;

  @ApiPropertyOptional({ example: 'DGA Opérations' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  libelleFonction?: string;
}
