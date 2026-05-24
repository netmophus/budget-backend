/**
 * NoteOrientationService (Lot 8.3.A) — gestion du détail métier
 * structuré d'une Note d'orientation interne BSIC.
 *
 * Pattern strictement identique à `LettreCadrageService` (Lot 8.2.C) —
 * seule la contrainte sur `typeDocument` change (D3_NOTE_ORIENTATION
 * au lieu de D2_LETTRE_CADRAGE).
 *
 * 2 méthodes :
 *  - `lireDetail`            : lecture (null si pas encore créé)
 *  - `creerOuMettreAJour`    : UPSERT (INSERT si absent, UPDATE sinon)
 *
 * Contraintes métier :
 *  1. Document existe                       → 404 sinon
 *  2. Document de type D3_NOTE_ORIENTATION  → 409 sinon
 *  3. Document en statut BROUILLON          → 409 sinon
 *  4. User === émetteur du document         → 403 sinon
 *
 * Pattern d'auth : `userEmail` paramètre + lookup user.id côté
 * service (aligné `document-fichier.service` Lot 8.1.D et
 * `lettre-cadrage.service` Lot 8.2.C).
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

import { CreerOuMettreAJourNoteOrientationDetailDto } from '../dto/note-orientation-detail.dto';
import { DocumentOfficiel } from '../entities/document-officiel.entity';
import { NoteOrientationDetail } from '../entities/note-orientation-detail.entity';

@Injectable()
export class NoteOrientationService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Lecture du détail métier. Retourne `null` si pas encore créé
   * (premier appel sur un document D3 fraîchement créé).
   */
  async lireDetail(documentId: string): Promise<NoteOrientationDetail | null> {
    return this.dataSource
      .getRepository(NoteOrientationDetail)
      .findOne({ where: { fkDocument: documentId } });
  }

  /**
   * UPSERT du détail métier — INSERT au 1er appel, UPDATE ensuite.
   *
   * @throws NotFoundException     si document introuvable
   * @throws ConflictException     si type document ≠ D3_NOTE_ORIENTATION
   *                                OU statut document ≠ BROUILLON
   * @throws ForbiddenException    si user ≠ émetteur du document
   */
  async creerOuMettreAJour(
    documentId: string,
    dto: CreerOuMettreAJourNoteOrientationDetailDto,
    userEmail: string,
  ): Promise<NoteOrientationDetail> {
    const docRepo = this.dataSource.getRepository(DocumentOfficiel);
    const nodRepo = this.dataSource.getRepository(NoteOrientationDetail);

    const document = await docRepo.findOne({ where: { id: documentId } });
    if (!document) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }
    if (document.typeDocument !== 'D3_NOTE_ORIENTATION') {
      throw new ConflictException(
        `Le détail orientation n'est applicable qu'aux documents D3_NOTE_ORIENTATION ` +
          `(reçu : '${document.typeDocument}').`,
      );
    }
    if (document.statut !== 'BROUILLON') {
      throw new ConflictException(
        `Le détail orientation ne peut être modifié qu'en statut BROUILLON ` +
          `(statut actuel : '${document.statut}').`,
      );
    }

    // Check émetteur via lookup email → user.id (pattern Lot 8.2.C).
    const userIdEmetteur = await this.lookupUserIdByEmail(userEmail);
    if (document.fkUserEmetteur !== userIdEmetteur) {
      throw new ForbiddenException(
        `Modification du détail orientation réservée à l'émetteur du document ` +
          `(user.id=${document.fkUserEmetteur}).`,
      );
    }

    // UPSERT : INSERT si pas de ligne existante, UPDATE sinon.
    // findOne+save plutôt que .upsert() pour conserver audit
    // utilisateurCreation au 1er INSERT (cf. décision Lot 8.2.C P1).
    const existant = await nodRepo.findOne({
      where: { fkDocument: documentId },
    });

    if (existant) {
      Object.assign(existant, dto);
      existant.utilisateurModification = userEmail;
      return nodRepo.save(existant);
    }

    const nouveau = nodRepo.create({
      ...dto,
      fkDocument: documentId,
      utilisateurCreation: userEmail,
    });
    return nodRepo.save(nouveau);
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
