import { ApiProperty } from '@nestjs/swagger';
import { LigneMetierResponseDto } from './ligne-metier-response.dto';

export class PaginatedLignesMetierDto {
  @ApiProperty({ type: [LigneMetierResponseDto] })
  items!: LigneMetierResponseDto[];

  @ApiProperty({ example: 12 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;
}
