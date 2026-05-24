/**
 * LettreCadrageService (Lot 8.2.C) — gestion du détail métier
 * structuré d'une Lettre de cadrage BSIC.
 *
 * 2 méthodes :
 *  - `lireDetail`            : lecture (null si pas encore créé)
 *  - `creerOuMettreAJour`    : UPSERT (INSERT si absent, UPDATE sinon)
 *
 * Contraintes métier (checks applicatifs en plus des CHECK SQL) :
 *  1. Document existe                      → 404 sinon
 *  2. Document de type D2_LETTRE_CADRAGE   → 409 sinon
 *  3. Document en statut BROUILLON         → 409 sinon
 *  4. User === émetteur du document        → 403 sinon
 *
 * Pattern d'auth : `userEmail` paramètre + lookup user.id côté
 * service (aligné `document-fichier.service` Lot 8.1.D). Le bypass
 * admin reste dette technique (cf. ActorContext.isAdmin documenté
 * Lot 8.1.C — non traité ici pour cohérence avec les autres
 * services du module).
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { CreerOuMettreAJourLettreCadrageDetailDto } from '../dto/lettre-cadrage-detail.dto';
import { DocumentOfficiel } from '../entities/document-officiel.entity';
import { LettreCadrageDetail } from '../entities/lettre-cadrage-detail.entity';

@Injectable()
export class LettreCadrageService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Lecture du détail métier. Retourne `null` si pas encore créé
   * (premier appel sur un document fraichement créé).
   */
  async lireDetail(documentId: string): Promise<LettreCadrageDetail | null> {
    return this.dataSource
      .getRepository(LettreCadrageDetail)
      .findOne({ where: { fkDocument: documentId } });
  }

  /**
   * UPSERT du détail métier — INSERT au 1er appel, UPDATE ensuite.
   *
   * @throws NotFoundException     si document introuvable
   * @throws ConflictException     si type document ≠ D2_LETTRE_CADRAGE
   *                                OU statut document ≠ BROUILLON
   * @throws ForbiddenException    si user ≠ émetteur du document
   */
  async creerOuMettreAJour(
    documentId: string,
    dto: CreerOuMettreAJourLettreCadrageDetailDto,
    userEmail: string,
  ): Promise<LettreCadrageDetail> {
    const docRepo = this.dataSource.getRepository(DocumentOfficiel);
    const lcdRepo = this.dataSource.getRepository(LettreCadrageDetail);

    const document = await docRepo.findOne({ where: { id: documentId } });
    if (!document) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }
    if (document.typeDocument !== 'D2_LETTRE_CADRAGE') {
      throw new ConflictException(
        `Le détail cadrage n'est applicable qu'aux documents D2_LETTRE_CADRAGE ` +
          `(reçu : '${document.typeDocument}').`,
      );
    }
    if (document.statut !== 'BROUILLON') {
      throw new ConflictException(
        `Le détail cadrage ne peut être modifié qu'en statut BROUILLON ` +
          `(statut actuel : '${document.statut}').`,
      );
    }

    // Check émetteur : on résout user.id via email (pattern
    // `document-fichier.service` Lot 8.1.D). Évite de propager
    // userId dans toute la chaîne quand seul userEmail est dispo.
    const userIdEmetteur = await this.lookupUserIdByEmail(userEmail);
    if (document.fkUserEmetteur !== userIdEmetteur) {
      throw new ForbiddenException(
        `Modification du détail cadrage réservée à l'émetteur du document ` +
          `(user.id=${document.fkUserEmetteur}).`,
      );
    }

    // UPSERT : INSERT si pas de ligne existante, UPDATE sinon.
    // findOne+save plutôt que .upsert() de TypeORM pour conserver
    // les colonnes audit (utilisateurCreation au 1er INSERT,
    // utilisateurModification aux UPDATE suivants).
    const existant = await lcdRepo.findOne({
      where: { fkDocument: documentId },
    });

    if (existant) {
      Object.assign(existant, dto);
      existant.utilisateurModification = userEmail;
      return lcdRepo.save(existant);
    }

    const nouveau = lcdRepo.create({
      ...dto,
      fkDocument: documentId,
      utilisateurCreation: userEmail,
    });
    return lcdRepo.save(nouveau);
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
