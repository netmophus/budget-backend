import { ApiProperty } from '@nestjs/swagger';
import { FaitBudgetResponseDto } from './fait-budget-response.dto';

export class PaginatedFaitBudgetDto {
  @ApiProperty({ type: [FaitBudgetResponseDto] })
  items!: FaitBudgetResponseDto[];

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;
}
