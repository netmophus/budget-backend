import { ApiProperty } from '@nestjs/swagger';
import { TauxChangeResponseDto } from './taux-change-response.dto';

export class PaginatedTauxChangeDto {
  @ApiProperty({ type: [TauxChangeResponseDto] })
  items!: TauxChangeResponseDto[];

  @ApiProperty({ example: 18 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;
}
