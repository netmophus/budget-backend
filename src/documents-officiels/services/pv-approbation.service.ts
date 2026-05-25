/**
 * PvApprobationService (Lot 8.3.D) — gestion du détail métier
 * structuré d'un PV d'approbation du Conseil d'Administration
 * (émis APRÈS la signature de D2 Lettre de cadrage, acte officiel
 * d'approbation budgétaire par le CA BSIC).
 *
 * Pattern strictement identique aux 4 services *-detail précédents
 * (`LettreCadrageService`, `NoteOrientationService`,
 * `LettreMobilisationService`, `NotePreparatoireService`) — seule
 * la contrainte sur `typeDocument` change (D11_PV_APPROBATION).
 *
 * 2 méthodes :
 *  - `lireDetail`            : lecture (null si pas encore créé)
 *  - `creerOuMettreAJour`    : UPSERT (INSERT si absent, UPDATE sinon)
 *
 * Contraintes métier :
 *  1. Document existe                          → 404 sinon
 *  2. Document de type D11_PV_APPROBATION      → 409 sinon
 *  3. Document en statut BROUILLON             → 409 sinon
 *  4. User === émetteur du document            → 403 sinon
 *
 * Pattern d'auth : `userEmail` paramètre + lookup user.id côté
 * service (aligné Lots 8.1.D, 8.2.C, 8.3.A, 8.3.B, 8.3.C).
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

import { CreerOuMettreAJourPvApprobationDetailDto } from '../dto/pv-approbation-detail.dto';
import { DocumentOfficiel } from '../entities/document-officiel.entity';
import { PvApprobationDetail } from '../entities/pv-approbation-detail.entity';

@Injectable()
export class PvApprobationService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Lecture du détail métier. Retourne `null` si pas encore créé
   * (premier appel sur un document D11 fraîchement créé).
   */
  async lireDetail(documentId: string): Promise<PvApprobationDetail | null> {
    return this.dataSource
      .getRepository(PvApprobationDetail)
      .findOne({ where: { fkDocument: documentId } });
  }

  /**
   * UPSERT du détail métier — INSERT au 1er appel, UPDATE ensuite.
   *
   * @throws NotFoundException     si document introuvable
   * @throws ConflictException     si type document ≠ D11_PV_APPROBATION
   *                                OU statut document ≠ BROUILLON
   * @throws ForbiddenException    si user ≠ émetteur du document
   */
  async creerOuMettreAJour(
    documentId: string,
    dto: CreerOuMettreAJourPvApprobationDetailDto,
    userEmail: string,
  ): Promise<PvApprobationDetail> {
    const docRepo = this.dataSource.getRepository(DocumentOfficiel);
    const padRepo = this.dataSource.getRepository(PvApprobationDetail);

    const document = await docRepo.findOne({ where: { id: documentId } });
    if (!document) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }
    if (document.typeDocument !== 'D11_PV_APPROBATION') {
      throw new ConflictException(
        `Le détail PV approbation n'est applicable qu'aux documents D11_PV_APPROBATION ` +
          `(reçu : '${document.typeDocument}').`,
      );
    }
    if (document.statut !== 'BROUILLON') {
      throw new ConflictException(
        `Le détail PV approbation ne peut être modifié qu'en statut BROUILLON ` +
          `(statut actuel : '${document.statut}').`,
      );
    }

    // Check émetteur via lookup email → user.id (pattern Lots 8.2.C / 8.3.A / 8.3.B / 8.3.C).
    const userIdEmetteur = await this.lookupUserIdByEmail(userEmail);
    if (document.fkUserEmetteur !== userIdEmetteur) {
      throw new ForbiddenException(
        `Modification du détail PV approbation réservée à l'émetteur du document ` +
          `(user.id=${document.fkUserEmetteur}).`,
      );
    }

    // UPSERT : INSERT si pas de ligne existante, UPDATE sinon.
    // findOne+save plutôt que .upsert() pour conserver audit
    // utilisateurCreation au 1er INSERT (cf. décision Lot 8.2.C P1).
    const existant = await padRepo.findOne({
      where: { fkDocument: documentId },
    });

    if (existant) {
      Object.assign(existant, dto);
      existant.utilisateurModification = userEmail;
      return padRepo.save(existant);
    }

    const nouveau = padRepo.create({
      ...dto,
      fkDocument: documentId,
      utilisateurCreation: userEmail,
    });
    return padRepo.save(nouveau);
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
