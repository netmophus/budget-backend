import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuditLogResponseDto {
  @ApiProperty({ example: '42' })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  dateAction!: Date;

  @ApiProperty({ example: 'admin@miznas.local' })
  utilisateur!: string;

  @ApiPropertyOptional({ nullable: true })
  ipSource!: string | null;

  @ApiPropertyOptional({ nullable: true })
  userAgent!: string | null;

  @ApiProperty({ example: 'LOGIN' })
  typeAction!: string;

  @ApiProperty({ example: 'auth' })
  entiteCible!: string;

  @ApiPropertyOptional({ nullable: true })
  idCible!: string | null;

  @ApiPropertyOptional({ nullable: true })
  payloadAvant!: unknown;

  @ApiPropertyOptional({ nullable: true })
  payloadApres!: unknown;

  @ApiPropertyOptional({ nullable: true })
  commentaire!: string | null;

  @ApiProperty({ example: 'success' })
  statut!: string;

  @ApiPropertyOptional({ nullable: true })
  dureeMs!: number | null;
}
