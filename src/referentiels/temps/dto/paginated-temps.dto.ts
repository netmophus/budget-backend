import { ApiProperty } from '@nestjs/swagger';
import { TempsResponseDto } from './temps-response.dto';

export class PaginatedTempsDto {
  @ApiProperty({ type: [TempsResponseDto] })
  items!: TempsResponseDto[];

  @ApiProperty({ example: 31 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 366 })
  limit!: number;
}
