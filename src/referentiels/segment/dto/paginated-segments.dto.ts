import { ApiProperty } from '@nestjs/swagger';
import { SegmentResponseDto } from './segment-response.dto';

export class PaginatedSegmentsDto {
  @ApiProperty({ type: [SegmentResponseDto] })
  items!: SegmentResponseDto[];

  @ApiProperty({ example: 6 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;
}
