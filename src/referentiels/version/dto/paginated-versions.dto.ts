import { ApiProperty } from '@nestjs/swagger';
import { VersionResponseDto } from './version-response.dto';

export class PaginatedVersionsDto {
  @ApiProperty({ type: [VersionResponseDto] })
  items!: VersionResponseDto[];

  @ApiProperty({ example: 3 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;
}
