import { ApiProperty } from '@nestjs/swagger';
import { CrResponseDto } from './cr-response.dto';

export class PaginatedCrsDto {
  @ApiProperty({ type: [CrResponseDto] })
  items!: CrResponseDto[];

  @ApiProperty({ example: 6 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;
}
