import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({
    description:
      'Refresh token à révoquer. Si omis, tous les refresh actifs de l’utilisateur sont révoqués.',
    example: '8c1d5b3e-2a4f-4b9d-9c5d-3a1f2e6c8a90',
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  refreshToken?: string;
}
