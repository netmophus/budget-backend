/**
 * NotePreparatoireService (Lot 8.3.C) — gestion du détail métier
 * structuré d'une Note préparatoire DG (émise AVANT la réunion du
 * Comité, en début de cycle budgétaire BSIC).
 *
 * Pattern strictement identique à `LettreCadrageService` (Lot 8.2.C),
 * `NoteOrientationService` (Lot 8.3.A) et `LettreMobilisationService`
 * (Lot 8.3.B) — seule la contrainte sur `typeDocument` change
 * (D1_NOTE_PREPARATOIRE).
 *
 * 2 méthodes :
 *  - `lireDetail`            : lecture (null si pas encore créé)
 *  - `creerOuMettreAJour`    : UPSERT (INSERT si absent, UPDATE sinon)
 *
 * Contraintes métier :
 *  1. Document existe                          → 404 sinon
 *  2. Document de type D1_NOTE_PREPARATOIRE    → 409 sinon
 *  3. Document en statut BROUILLON             → 409 sinon
 *  4. User === émetteur du document            → 403 sinon
 *
 * Pattern d'auth : `userEmail` paramètre + lookup user.id côté
 * service (aligné Lots 8.1.D, 8.2.C, 8.3.A, 8.3.B).
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

import { CreerOuMettreAJourNotePreparatoireDetailDto } from '../dto/note-preparatoire-detail.dto';
import { DocumentOfficiel } from '../entities/document-officiel.entity';
import { NotePreparatoireDetail } from '../entities/note-preparatoire-detail.entity';

@Injectable()
export class NotePreparatoireService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Lecture du détail métier. Retourne `null` si pas encore créé
   * (premier appel sur un document D1 fraîchement créé).
   */
  async lireDetail(documentId: string): Promise<NotePreparatoireDetail | null> {
    return this.dataSource
      .getRepository(NotePreparatoireDetail)
      .findOne({ where: { fkDocument: documentId } });
  }

  /**
   * UPSERT du détail métier — INSERT au 1er appel, UPDATE ensuite.
   *
   * @throws NotFoundException     si document introuvable
   * @throws ConflictException     si type document ≠ D1_NOTE_PREPARATOIRE
   *                                OU statut document ≠ BROUILLON
   * @throws ForbiddenException    si user ≠ émetteur du document
   */
  async creerOuMettreAJour(
    documentId: string,
    dto: CreerOuMettreAJourNotePreparatoireDetailDto,
    userEmail: string,
  ): Promise<NotePreparatoireDetail> {
    const docRepo = this.dataSource.getRepository(DocumentOfficiel);
    const npdRepo = this.dataSource.getRepository(NotePreparatoireDetail);

    const document = await docRepo.findOne({ where: { id: documentId } });
    if (!document) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }
    if (document.typeDocument !== 'D1_NOTE_PREPARATOIRE') {
      throw new ConflictException(
        `Le détail note préparatoire n'est applicable qu'aux documents D1_NOTE_PREPARATOIRE ` +
          `(reçu : '${document.typeDocument}').`,
      );
    }
    if (document.statut !== 'BROUILLON') {
      throw new ConflictException(
        `Le détail note préparatoire ne peut être modifié qu'en statut BROUILLON ` +
          `(statut actuel : '${document.statut}').`,
      );
    }

    // Check émetteur via lookup email → user.id (pattern Lots 8.2.C / 8.3.A / 8.3.B).
    const userIdEmetteur = await this.lookupUserIdByEmail(userEmail);
    if (document.fkUserEmetteur !== userIdEmetteur) {
      throw new ForbiddenException(
        `Modification du détail note préparatoire réservée à l'émetteur du document ` +
          `(user.id=${document.fkUserEmetteur}).`,
      );
    }

    // UPSERT : INSERT si pas de ligne existante, UPDATE sinon.
    // findOne+save plutôt que .upsert() pour conserver audit
    // utilisateurCreation au 1er INSERT (cf. décision Lot 8.2.C P1).
    const existant = await npdRepo.findOne({
      where: { fkDocument: documentId },
    });

    if (existant) {
      Object.assign(existant, dto);
      existant.utilisateurModification = userEmail;
      return npdRepo.save(existant);
    }

    const nouveau = npdRepo.create({
      ...dto,
      fkDocument: documentId,
      utilisateurCreation: userEmail,
    });
    return npdRepo.save(nouveau);
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
