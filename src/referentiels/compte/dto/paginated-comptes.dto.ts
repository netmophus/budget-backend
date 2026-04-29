import { ApiProperty } from '@nestjs/swagger';
import { CompteResponseDto } from './compte-response.dto';

export class PaginatedComptesDto {
  @ApiProperty({ type: [CompteResponseDto] })
  items!: CompteResponseDto[];

  @ApiProperty({ example: 95 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;
}
