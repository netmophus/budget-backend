/**
 * LettreOfficialisationService (Lot 8.3.E) — gestion du détail
 * métier structuré d'une Lettre d'officialisation BSIC (émise APRÈS
 * la signature du PV CA, pour notifier l'approbation du budget aux
 * parties prenantes : équipe direction, filiales, BCEAO, CREPMF,
 * holding, etc.).
 *
 * Pattern strictement identique aux 5 services *-detail précédents
 * (`LettreCadrageService`, `NoteOrientationService`,
 * `LettreMobilisationService`, `NotePreparatoireService`,
 * `PvApprobationService`) — seule la contrainte sur `typeDocument`
 * change (D12_LETTRE_OFFICIALISATION).
 *
 * 2 méthodes :
 *  - `lireDetail`            : lecture (null si pas encore créé)
 *  - `creerOuMettreAJour`    : UPSERT (INSERT si absent, UPDATE sinon)
 *
 * Contraintes métier :
 *  1. Document existe                              → 404 sinon
 *  2. Document de type D12_LETTRE_OFFICIALISATION  → 409 sinon
 *  3. Document en statut BROUILLON                 → 409 sinon
 *  4. User === émetteur du document                → 403 sinon
 *
 * Pattern d'auth : `userEmail` paramètre + lookup user.id côté
 * service (aligné Lots 8.1.D → 8.3.D).
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

import { CreerOuMettreAJourLettreOfficialisationDetailDto } from '../dto/lettre-officialisation-detail.dto';
import { DocumentOfficiel } from '../entities/document-officiel.entity';
import { LettreOfficialisationDetail } from '../entities/lettre-officialisation-detail.entity';

@Injectable()
export class LettreOfficialisationService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Lecture du détail métier. Retourne `null` si pas encore créé
   * (premier appel sur un document D12 fraîchement créé).
   */
  async lireDetail(
    documentId: string,
  ): Promise<LettreOfficialisationDetail | null> {
    return this.dataSource
      .getRepository(LettreOfficialisationDetail)
      .findOne({ where: { fkDocument: documentId } });
  }

  /**
   * UPSERT du détail métier — INSERT au 1er appel, UPDATE ensuite.
   *
   * @throws NotFoundException     si document introuvable
   * @throws ConflictException     si type document ≠ D12_LETTRE_OFFICIALISATION
   *                                OU statut document ≠ BROUILLON
   * @throws ForbiddenException    si user ≠ émetteur du document
   */
  async creerOuMettreAJour(
    documentId: string,
    dto: CreerOuMettreAJourLettreOfficialisationDetailDto,
    userEmail: string,
  ): Promise<LettreOfficialisationDetail> {
    const docRepo = this.dataSource.getRepository(DocumentOfficiel);
    const lodRepo = this.dataSource.getRepository(LettreOfficialisationDetail);

    const document = await docRepo.findOne({ where: { id: documentId } });
    if (!document) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }
    if (document.typeDocument !== 'D12_LETTRE_OFFICIALISATION') {
      throw new ConflictException(
        `Le détail lettre officialisation n'est applicable qu'aux documents D12_LETTRE_OFFICIALISATION ` +
          `(reçu : '${document.typeDocument}').`,
      );
    }
    if (document.statut !== 'BROUILLON') {
      throw new ConflictException(
        `Le détail lettre officialisation ne peut être modifié qu'en statut BROUILLON ` +
          `(statut actuel : '${document.statut}').`,
      );
    }

    // Check émetteur via lookup email → user.id (pattern Lots 8.2.C / 8.3.A / 8.3.B / 8.3.C / 8.3.D).
    const userIdEmetteur = await this.lookupUserIdByEmail(userEmail);
    if (document.fkUserEmetteur !== userIdEmetteur) {
      throw new ForbiddenException(
        `Modification du détail lettre officialisation réservée à l'émetteur du document ` +
          `(user.id=${document.fkUserEmetteur}).`,
      );
    }

    // UPSERT : INSERT si pas de ligne existante, UPDATE sinon.
    // findOne+save plutôt que .upsert() pour conserver audit
    // utilisateurCreation au 1er INSERT (cf. décision Lot 8.2.C P1).
    const existant = await lodRepo.findOne({
      where: { fkDocument: documentId },
    });

    if (existant) {
      Object.assign(existant, dto);
      existant.utilisateurModification = userEmail;
      return lodRepo.save(existant);
    }

    const nouveau = lodRepo.create({
      ...dto,
      fkDocument: documentId,
      utilisateurCreation: userEmail,
    });
    return lodRepo.save(nouveau);
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
