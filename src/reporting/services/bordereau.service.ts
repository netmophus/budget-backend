/**
 * BordereauService (Lot 8.4) — génération à la volée des bordereaux
 * de validation (R3) et de rejet (R5) au format PDF.
 *
 * **Architecture choisie** (cf. audit pré-Lot 8.4) :
 *  - Génération à la volée : aucun snapshot persisté, aucune table
 *    nouvelle. Les tables `document_visa` + `document_officiel` sont
 *    immuables une fois VISE/REJETE/SIGNE — régénérer produit le
 *    même PDF de manière déterministe.
 *  - Format consolidé : 1 R3 unique listant tous les viseurs ayant
 *    validé, 1 R5 unique sur le 1er visa rejeté.
 *
 * **Garde-fous métier** :
 *  - R3 disponible si `statut ∈ {VISE, SIGNE}` (le document a atteint
 *    la validation complète). 409 si BROUILLON/SOUMIS_VISA.
 *  - R5 disponible si au moins 1 `document_visa` au statut `REJETE`
 *    existe pour ce document. 409 sinon.
 *  - 404 si document inexistant.
 *
 * **Interface mutualisable** : prévoit une éventuelle évolution Profil
 * 2 (snapshot + hash crypto) sans refacto majeur — il suffira d'ajouter
 * `persisterBordereau(documentId, type, buffer)` consommant
 * `DocumentFichierService` (Lot 8.1.D).
 *
 * **Réutilisations strictes** :
 *  - `PdfBuilderService` (Lot 7.6) pour primitives charte BSIC
 *  - Templates dédiés dans `src/reporting/templates/r3-*` et `r5-*`
 *  - Pattern `extractDonnees + genererPdfBuffer` aligné R04
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { PdfBuilderService } from '../generators/pdf-builder.service';
import { buildR3Pdf } from '../templates/r3-bordereau-validation.template';
import { buildR5Pdf } from '../templates/r5-bordereau-rejet.template';

/**
 * Métadonnées document partagées par R3 et R5 (extraites depuis
 * `document_officiel` + jointure `user` émetteur).
 */
export interface BordereauDocumentMeta {
  id: string;
  codeDocument: string;
  typeDocument: string;
  titre: string;
  referenceExterne: string | null;
  statut: string;
  dateCreation: string;
  fkCampagne: string | null;
  exerciceFiscal: number | null;
  emetteurNom: string | null;
  emetteurPrenom: string | null;
  emetteurEmail: string | null;
}

/**
 * Snapshot d'un visa enrichi (jointure `user`). Utilisé par R3 (tous
 * les visas VISE) et R5 (le visa REJETE).
 */
export interface BordereauVisaEntry {
  ordreVisa: number;
  libelleFonction: string | null;
  statut: string;
  dateAction: string | null;
  commentaire: string | null;
  viseurNom: string | null;
  viseurPrenom: string | null;
  viseurEmail: string | null;
}

export interface BordereauR3Data {
  document: BordereauDocumentMeta;
  visasValidants: BordereauVisaEntry[];
}

export interface BordereauR5Data {
  document: BordereauDocumentMeta;
  visaRejete: BordereauVisaEntry;
}

@Injectable()
export class BordereauService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly pdfBuilder: PdfBuilderService,
  ) {}

  /**
   * Extrait les données du R3 : document + tous les visas VISE
   * (consolidé, format A.2 actée). Lève 404 si document inexistant,
   * 409 si statut document ≠ VISE && ≠ SIGNE.
   */
  async extractDataR3(documentId: string): Promise<BordereauR3Data> {
    const document = await this.fetchDocumentMeta(documentId);
    if (!document) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }
    if (document.statut !== 'VISE' && document.statut !== 'SIGNE') {
      throw new ConflictException(
        `Le bordereau de validation R3 n'est disponible que pour les ` +
          `documents en statut VISE ou SIGNE (statut actuel : '${document.statut}').`,
      );
    }
    const visasValidants = await this.fetchVisas(documentId, 'VISE');
    return { document, visasValidants };
  }

  /**
   * Extrait les données du R5 : document + 1er visa REJETE trouvé.
   * Lève 404 si document inexistant, 409 si aucun visa REJETE.
   */
  async extractDataR5(documentId: string): Promise<BordereauR5Data> {
    const document = await this.fetchDocumentMeta(documentId);
    if (!document) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }
    const rejets = await this.fetchVisas(documentId, 'REJETE');
    if (rejets.length === 0) {
      throw new ConflictException(
        `Le bordereau de rejet R5 n'est disponible que pour les documents ` +
          `comportant au moins un visa REJETE (aucun trouvé sur ${documentId}).`,
      );
    }
    return { document, visaRejete: rejets[0] };
  }

  /**
   * Génère le PDF complet R3 et retourne un Buffer prêt à streamer.
   * Validation faite en amont par `extractDataR3()`.
   */
  async genererBordereauValidation(documentId: string): Promise<Buffer> {
    const data = await this.extractDataR3(documentId);
    const doc = this.pdfBuilder.createDocument({
      title: `R3 Bordereau Validation — ${data.document.codeDocument}`,
      subject: `Bordereau de validation MIZNAS pour ${data.document.codeDocument}`,
    });
    buildR3Pdf(doc, data, this.pdfBuilder);
    return this.streamToBuffer(doc);
  }

  /**
   * Génère le PDF complet R5 et retourne un Buffer prêt à streamer.
   * Validation faite en amont par `extractDataR5()`.
   */
  async genererBordereauRejet(documentId: string): Promise<Buffer> {
    const data = await this.extractDataR5(documentId);
    const doc = this.pdfBuilder.createDocument({
      title: `R5 Bordereau Rejet — ${data.document.codeDocument}`,
      subject: `Bordereau de rejet MIZNAS pour ${data.document.codeDocument}`,
    });
    buildR5Pdf(doc, data, this.pdfBuilder);
    return this.streamToBuffer(doc);
  }

  // ─── Helpers privés — queries SQL natives (pattern R04) ────────

  private async fetchDocumentMeta(
    documentId: string,
  ): Promise<BordereauDocumentMeta | null> {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        code_document: string;
        type_document: string;
        titre: string;
        reference_externe: string | null;
        statut: string;
        date_creation: string;
        fk_campagne: string | null;
        exercice_fiscal: number | null;
        emetteur_nom: string | null;
        emetteur_prenom: string | null;
        emetteur_email: string | null;
      }>
    >(
      `SELECT
         d.id,
         d.code_document,
         d.type_document,
         d.titre,
         d.reference_externe,
         d.statut,
         d.date_creation,
         d.fk_campagne,
         cb.exercice_fiscal,
         u.nom AS emetteur_nom,
         u.prenom AS emetteur_prenom,
         u.email AS emetteur_email
       FROM document_officiel d
       LEFT JOIN "user" u ON u.id = d.fk_user_emetteur
       LEFT JOIN campagne_budgetaire cb ON cb.id = d.fk_campagne
       WHERE d.id = $1::uuid
       LIMIT 1`,
      [documentId],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: String(r.id),
      codeDocument: r.code_document,
      typeDocument: r.type_document,
      titre: r.titre,
      referenceExterne: r.reference_externe,
      statut: r.statut,
      dateCreation:
        typeof r.date_creation === 'string'
          ? r.date_creation
          : new Date(r.date_creation).toISOString(),
      fkCampagne: r.fk_campagne ? String(r.fk_campagne) : null,
      exerciceFiscal:
        r.exercice_fiscal !== null && r.exercice_fiscal !== undefined
          ? Number(r.exercice_fiscal)
          : null,
      emetteurNom: r.emetteur_nom,
      emetteurPrenom: r.emetteur_prenom,
      emetteurEmail: r.emetteur_email,
    };
  }

  private async fetchVisas(
    documentId: string,
    statut: 'VISE' | 'REJETE',
  ): Promise<BordereauVisaEntry[]> {
    const rows = await this.dataSource.query<
      Array<{
        ordre_visa: number;
        libelle_fonction: string | null;
        statut: string;
        date_action: string | null;
        commentaire: string | null;
        viseur_nom: string | null;
        viseur_prenom: string | null;
        viseur_email: string | null;
      }>
    >(
      `SELECT
         v.ordre_visa,
         v.libelle_fonction,
         v.statut,
         v.date_action,
         v.commentaire,
         u.nom AS viseur_nom,
         u.prenom AS viseur_prenom,
         u.email AS viseur_email
       FROM document_visa v
       LEFT JOIN "user" u ON u.id = v.fk_user_viseur
       WHERE v.fk_document = $1::uuid AND v.statut = $2
       ORDER BY v.ordre_visa ASC`,
      [documentId, statut],
    );
    return rows.map((r) => ({
      ordreVisa: Number(r.ordre_visa),
      libelleFonction: r.libelle_fonction,
      statut: r.statut,
      dateAction:
        r.date_action === null
          ? null
          : typeof r.date_action === 'string'
            ? r.date_action
            : new Date(r.date_action).toISOString(),
      commentaire: r.commentaire,
      viseurNom: r.viseur_nom,
      viseurPrenom: r.viseur_prenom,
      viseurEmail: r.viseur_email,
    }));
  }

  private async streamToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err: Error) => reject(err));
      doc.end();
    });
  }
}
