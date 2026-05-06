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

  /**
   * Lot 4.1-fix.A — rempli uniquement si la liste est demandée avec
   * `?withPerimetresCount=true`. Compte les lignes user_perimetres
   * actives à aujourd'hui pour ce user.
   */
  @ApiPropertyOptional({ example: 2 })
  nombrePerimetresActifs?: number;
}
