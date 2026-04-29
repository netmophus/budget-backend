import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ example: '8c1d5b3e-2a4f-4b9d-9c5d-3a1f2e6c8a90' })
  @IsString()
  @IsUUID()
  refreshToken!: string;
}
