import { ApiProperty } from '@nestjs/swagger';
import { StructureResponseDto } from './structure-response.dto';

export class PaginatedStructuresDto {
  @ApiProperty({ type: [StructureResponseDto] })
  items!: StructureResponseDto[];

  @ApiProperty({ example: 9 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;
}
