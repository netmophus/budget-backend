import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO réponse `GET /documents-officiels/documents/:id/verifier-integrite`
 * (Lot 8.1.C).
 *
 * Service `verifierIntegrite(documentId)` recalcule les hashes a partir
 * du contenu actuel et compare avec ceux figes dans `document_signature`.
 * Si `contenuIntact && visasIntacts` → document non altere depuis la
 * signature. Sinon, `details` documente la divergence.
 */
export class SignataireSnapshotDto {
  @ApiProperty()
  email!: string;

  @ApiProperty()
  nom!: string;
}

export class VerifierIntegriteDetailsDto {
  @ApiProperty({ description: 'Hash recalcule a partir du contenu actuel.' })
  hashContenuActuel!: string;

  @ApiProperty({ description: 'Hash fige dans document_signature.' })
  hashContenuSigne!: string;

  @ApiProperty({ description: 'Hash recalcule a partir des visas actuels.' })
  hashVisasActuel!: string;

  @ApiProperty({ description: 'Hash fige dans document_signature.' })
  hashVisasSigne!: string;
}

export class VerifierIntegriteDto {
  @ApiProperty({ format: 'uuid' })
  documentId!: string;

  @ApiProperty({
    description:
      'true si une ligne document_signature existe pour ce document.',
  })
  signaturePresente!: boolean;

  @ApiProperty({
    description: 'true si hashContenuActuel === hashContenuSigne.',
  })
  contenuIntact!: boolean;

  @ApiProperty({
    description: 'true si hashVisasActuel === hashVisasSigne.',
  })
  visasIntacts!: boolean;

  @ApiProperty({ nullable: true })
  dateSignature!: Date | null;

  @ApiProperty({ type: SignataireSnapshotDto, nullable: true })
  signataireSnapshot!: SignataireSnapshotDto | null;

  @ApiProperty({
    type: VerifierIntegriteDetailsDto,
    description: 'Details des hashes (diagnostic en cas de mismatch).',
  })
  details!: VerifierIntegriteDetailsDto;
}
