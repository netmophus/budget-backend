import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/**
 * Query params pour `GET /faits/budget/par-grain`. Au Lot 3.2A on
 * passe les 10 FK directement (codes business résolus côté caller).
 * Le Lot 3.2B exposera une variante par codes business + date métier.
 */
export class ParGrainQueryDto {
  @ApiProperty({ example: '123' })
  @IsString()
  @Matches(/^\d+$/)
  fkTemps!: string;

  @ApiProperty({ example: '42' })
  @IsString()
  @Matches(/^\d+$/)
  fkCompte!: string;

  @ApiProperty({ example: '7' })
  @IsString()
  @Matches(/^\d+$/)
  fkStructure!: string;

  @ApiProperty({ example: '12' })
  @IsString()
  @Matches(/^\d+$/)
  fkCentre!: string;

  @ApiProperty({ example: '5' })
  @IsString()
  @Matches(/^\d+$/)
  fkLigneMetier!: string;

  @ApiProperty({ example: '8' })
  @IsString()
  @Matches(/^\d+$/)
  fkProduit!: string;

  @ApiProperty({ example: '3' })
  @IsString()
  @Matches(/^\d+$/)
  fkSegment!: string;

  @ApiProperty({ example: '1' })
  @IsString()
  @Matches(/^\d+$/)
  fkDevise!: string;

  @ApiProperty({ example: '2' })
  @IsString()
  @Matches(/^\d+$/)
  fkVersion!: string;

  @ApiProperty({ example: '1' })
  @IsString()
  @Matches(/^\d+$/)
  fkScenario!: string;
}
