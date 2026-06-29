import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTOs PR A — édition de la matrice rôle × permission.
 *
 * `AjouterPermissionDto` : corps du POST /roles/:id/permissions.
 * `RolePermissionMutationDto` : réponse compacte des deux endpoints
 * d'écriture, suffisante pour rafraîchir l'UI (le détail complet du
 * rôle reste disponible via GET /roles/:id).
 */
export class AjouterPermissionDto {
  @ApiProperty({ description: 'fk_permission à attribuer au rôle.' })
  @IsString()
  fkPermission!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motif?: string;
}

export class RetirerPermissionDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motif?: string;
}

export class RolePermissionMutationDto {
  @ApiProperty({ example: '3' })
  roleId!: string;

  @ApiProperty({ example: 'SAISISSEUR' })
  codeRole!: string;

  @ApiProperty({ example: '12' })
  fkPermission!: string;

  @ApiProperty({ example: 'BUDGET.SAISIR' })
  codePermission!: string;

  /**
   * true si l'opération n'a rien changé (POST sur un lien déjà présent,
   * idempotent — aucune ligne d'audit n'est alors émise).
   */
  @ApiProperty({ example: false })
  deja!: boolean;
}
