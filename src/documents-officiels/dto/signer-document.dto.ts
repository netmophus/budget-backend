import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * DTO entrée `POST /documents-officiels/documents/:id/signer`
 * (Lot 8.1.C).
 *
 * Re-saisie de securite obligatoire avant signature finale. Le mot de
 * passe est compare au hash bcrypt du user via `bcrypt.compare`. Pas
 * de logging du mot de passe en clair (ni dans audit, ni dans les
 * payloadAvant/Apres). Pattern aligne sur l'auth.service.ts.
 */
export class SignerDocumentDto {
  @ApiProperty({
    description:
      "Mot de passe actuel du user signataire (verification bcrypt). N'est PAS persiste ni logue.",
  })
  @IsString()
  @MinLength(1)
  motDePasse!: string;
}
