import { ApiProperty } from '@nestjs/swagger';
import { DeviseResponseDto } from './devise-response.dto';

export class PaginatedDevisesDto {
  @ApiProperty({ type: [DeviseResponseDto] })
  items!: DeviseResponseDto[];

  @ApiProperty({ example: 7 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;
}
