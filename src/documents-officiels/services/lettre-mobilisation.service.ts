/**
 * LettreMobilisationService (Lot 8.3.B) — gestion du détail métier
 * structuré d'une Lettre de mobilisation DG → Directeurs BSIC.
 *
 * Pattern strictement identique à `LettreCadrageService` (Lot 8.2.C)
 * et `NoteOrientationService` (Lot 8.3.A) — seule la contrainte
 * sur `typeDocument` change (D5_LETTRE_MOBILISATION).
 *
 * 2 méthodes :
 *  - `lireDetail`            : lecture (null si pas encore créé)
 *  - `creerOuMettreAJour`    : UPSERT (INSERT si absent, UPDATE sinon)
 *
 * Contraintes métier :
 *  1. Document existe                          → 404 sinon
 *  2. Document de type D5_LETTRE_MOBILISATION  → 409 sinon
 *  3. Document en statut BROUILLON             → 409 sinon
 *  4. User === émetteur du document            → 403 sinon
 *
 * Pattern d'auth : `userEmail` paramètre + lookup user.id côté
 * service (aligné Lots 8.1.D, 8.2.C, 8.3.A).
 *
 * UPSERT via findOne+save (et pas .upsert() natif) pour conserver
 * `utilisateurCreation` au 1er INSERT et remplir
 * `utilisateurModification` aux UPDATE suivants (audit BCEAO 10 ans).
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { CreerOuMettreAJourLettreMobilisationDetailDto } from '../dto/lettre-mobilisation-detail.dto';
import { DocumentOfficiel } from '../entities/document-officiel.entity';
import { LettreMobilisationDetail } from '../entities/lettre-mobilisation-detail.entity';

@Injectable()
export class LettreMobilisationService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Lecture du détail métier. Retourne `null` si pas encore créé
   * (premier appel sur un document D5 fraîchement créé).
   */
  async lireDetail(
    documentId: string,
  ): Promise<LettreMobilisationDetail | null> {
    return this.dataSource
      .getRepository(LettreMobilisationDetail)
      .findOne({ where: { fkDocument: documentId } });
  }

  /**
   * UPSERT du détail métier — INSERT au 1er appel, UPDATE ensuite.
   *
   * @throws NotFoundException     si document introuvable
   * @throws ConflictException     si type document ≠ D5_LETTRE_MOBILISATION
   *                                OU statut document ≠ BROUILLON
   * @throws ForbiddenException    si user ≠ émetteur du document
   */
  async creerOuMettreAJour(
    documentId: string,
    dto: CreerOuMettreAJourLettreMobilisationDetailDto,
    userEmail: string,
  ): Promise<LettreMobilisationDetail> {
    const docRepo = this.dataSource.getRepository(DocumentOfficiel);
    const lmdRepo = this.dataSource.getRepository(LettreMobilisationDetail);

    const document = await docRepo.findOne({ where: { id: documentId } });
    if (!document) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }
    if (document.typeDocument !== 'D5_LETTRE_DG') {
      // Identifiant technique : 'D5_LETTRE_DG' (cohérent enum
      // `creer-document.dto.ts` + frontend `types/document.ts`).
      // Label métier affiché côté frontend : "Lettre de mobilisation".
      throw new ConflictException(
        `Le détail mobilisation n'est applicable qu'aux documents D5_LETTRE_DG ` +
          `(reçu : '${document.typeDocument}').`,
      );
    }
    if (document.statut !== 'BROUILLON') {
      throw new ConflictException(
        `Le détail mobilisation ne peut être modifié qu'en statut BROUILLON ` +
          `(statut actuel : '${document.statut}').`,
      );
    }

    // Check émetteur via lookup email → user.id (pattern Lots 8.2.C / 8.3.A).
    const userIdEmetteur = await this.lookupUserIdByEmail(userEmail);
    if (document.fkUserEmetteur !== userIdEmetteur) {
      throw new ForbiddenException(
        `Modification du détail mobilisation réservée à l'émetteur du document ` +
          `(user.id=${document.fkUserEmetteur}).`,
      );
    }

    // UPSERT : INSERT si pas de ligne existante, UPDATE sinon.
    // findOne+save plutôt que .upsert() pour conserver audit
    // utilisateurCreation au 1er INSERT (cf. décision Lot 8.2.C P1).
    const existant = await lmdRepo.findOne({
      where: { fkDocument: documentId },
    });

    if (existant) {
      Object.assign(existant, dto);
      existant.utilisateurModification = userEmail;
      return lmdRepo.save(existant);
    }

    const nouveau = lmdRepo.create({
      ...dto,
      fkDocument: documentId,
      utilisateurCreation: userEmail,
    });
    return lmdRepo.save(nouveau);
  }

  // ─── Helpers privés ────────────────────────────────────────────

  private async lookupUserIdByEmail(email: string): Promise<string | null> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT "id" FROM "user" WHERE "email" = $1 LIMIT 1`,
      [email],
    );
    return rows[0]?.id ?? null;
  }
}
