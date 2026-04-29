import { ApiProperty } from '@nestjs/swagger';
import { ProduitResponseDto } from './produit-response.dto';

export class PaginatedProduitsDto {
  @ApiProperty({ type: [ProduitResponseDto] })
  items!: ProduitResponseDto[];

  @ApiProperty({ example: 25 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;
}
