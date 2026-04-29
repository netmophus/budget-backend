import { ApiProperty } from '@nestjs/swagger';
import { ScenarioResponseDto } from './scenario-response.dto';

export class PaginatedScenariosDto {
  @ApiProperty({ type: [ScenarioResponseDto] })
  items!: ScenarioResponseDto[];

  @ApiProperty({ example: 3 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;
}
