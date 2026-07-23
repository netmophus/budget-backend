/**
 * DocumentFichierService (Lot 8.1.D) — upload/download/suppression du
 * PDF original attaché à un document officiel.
 *
 * Le PDF original (reçu du Holding ou émis en interne) est la **source
 * de vérité documentaire** pour audit BCEAO. Conservation 10 ans avec
 * le document.
 *
 * **Stockage EN BASE** (migration ...630) : les octets du PDF vivent
 * dans `document_officiel.fichier_contenu` (bytea), pas sur disque. Le
 * système de fichiers des plateformes PaaS (Heroku, Render) est
 * éphémère — un fichier écrit sur disque disparaît au redémarrage du
 * dyno. En base, il est persistant et capturé par les sauvegardes
 * Postgres (cohérence document + métadonnée dans le même instantané).
 *
 * Colonnes :
 *   - `fichier_contenu` (bytea, select:false) : les octets.
 *   - `fichier_taille`  (int)                 : taille en octets.
 *   - `fichier_mime`    (varchar)             : type MIME.
 *   - `fichier_joint_nom` (varchar)           : nom d'origine + indicateur
 *     « le document a un fichier ». `fichier_joint_path` (legacy disque)
 *     n'est plus alimenté par l'upload.
 *
 * **Sécurité** :
 *   - Magic bytes PDF vérifiés (le MIME type HTTP est trichable)
 *   - Limite 10 MB côté FileInterceptor (controller) ET ici
 *   - Contrôle d'accès download : émetteur, viseur ou signataire
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Readable } from 'stream';
import { DataSource } from 'typeorm';

import { AuditLog } from '../../audit/entities/audit-log.entity';
import { DocumentOfficiel } from '../entities/document-officiel.entity';
import { DocumentVisa } from '../entities/document-visa.entity';

const TAILLE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const PDF_MAGIC_HEADER = '%PDF-';
const PDF_MIME = 'application/pdf';

/**
 * Type local du fichier reçu via Multer/FileInterceptor. Aligné sur
 * `UploadedBudgetFile` (budget-import.controller.ts) — le namespace
 * `Express.Multer` n'est pas inclus dans les types par défaut.
 */
export interface UploadedPdfFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface UploadFichierResult {
  documentId: string;
  fichierNom: string;
  fichierTaille: number;
  dateUpload: Date;
}

export interface TelechargerFichierResult {
  stream: Readable;
  fichierNom: string;
  mimeType: string;
}

@Injectable()
export class DocumentFichierService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Upload du PDF original sur un document BROUILLON.
   *
   * Conditions :
   *   - User est l'émetteur du document (check métier ; bypass admin
   *     est dette technique reportée — cf. ActorContext.isAdmin Lot 8.1.C)
   *   - Statut = BROUILLON
   *   - file présent, PDF valide (magic bytes), taille > 0 et ≤ 10 MB
   *
   * Action :
   *   - UPDATE document_officiel : fichier_contenu (octets) + taille +
   *     mime + nom d'origine
   *   - INSERT audit_log EDITER_DOCUMENT (UPLOAD_FICHIER / REMPLACER_FICHIER)
   */
  async uploadFichier(
    documentId: string,
    file: UploadedPdfFile | undefined,
    userEmail: string,
  ): Promise<UploadFichierResult> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Fichier vide ou absent.');
    }
    if (file.size > TAILLE_MAX_BYTES) {
      throw new BadRequestException(
        `Fichier trop volumineux (${file.size} octets > ${TAILLE_MAX_BYTES} octets = 10 MB).`,
      );
    }
    // Magic bytes : un PDF commence TOUJOURS par "%PDF-"
    const header = file.buffer.toString('utf-8', 0, PDF_MAGIC_HEADER.length);
    if (header !== PDF_MAGIC_HEADER) {
      throw new BadRequestException(
        "Le fichier n'est pas un PDF valide (magic bytes invalides — vérification stricte au-delà du MIME type).",
      );
    }

    const docRepo = this.dataSource.getRepository(DocumentOfficiel);
    const doc = await docRepo.findOne({ where: { id: documentId } });
    if (!doc) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }
    if (doc.statut !== 'BROUILLON') {
      throw new ConflictException(
        `Upload impossible : statut '${doc.statut}' (BROUILLON requis).`,
      );
    }
    // Check métier émetteur. Le bypass admin est reporté à un futur palier
    // (dette Lot 8.1.C documentée — pas de PermissionService dispo).
    const userIdEmetteur = await this.lookupUserIdByEmail(userEmail);
    if (doc.fkUserEmetteur !== userIdEmetteur) {
      throw new ForbiddenException(
        `Upload réservé à l'émetteur du document (user.id=${doc.fkUserEmetteur}).`,
      );
    }

    // `fichier_joint_nom` fait office d'indicateur « fichier déjà présent »
    // (remplacement vs premier upload). L'ancien contenu est simplement
    // écrasé par le UPDATE ci-dessous — pas de fichier disque à nettoyer.
    const avaitFichier = Boolean(doc.fichierJointNom);

    doc.fichierContenu = file.buffer;
    doc.fichierTaille = file.size;
    doc.fichierMime = PDF_MIME;
    doc.fichierJointNom = file.originalname;
    doc.dateModification = new Date();
    doc.utilisateurModification = userEmail;
    await docRepo.save(doc);

    await this.dataSource.getRepository(AuditLog).insert({
      utilisateur: userEmail,
      typeAction: 'EDITER_DOCUMENT',
      entiteCible: 'document_officiel',
      idCible: doc.id,
      payloadApres: {
        action: avaitFichier ? 'REMPLACER_FICHIER' : 'UPLOAD_FICHIER',
        nom: file.originalname,
        taille: file.size,
        stockage: 'base',
      },
      commentaire: `Upload fichier ${file.originalname} (${file.size} octets) pour document ${doc.codeDocument}.`,
      statut: 'success',
    });

    return {
      documentId: doc.id,
      fichierNom: file.originalname,
      fichierTaille: file.size,
      dateUpload: doc.dateModification,
    };
  }

  /**
   * Téléchargement du PDF stocké en base.
   *
   * Accès = émetteur OU viseur OU signataire (mêmes règles que
   * `DocumentWorkflowService.detailDocument`). Le bypass admin reste
   * dette technique du Lot 8.1.C.
   *
   * Le blob (`fichier_contenu`, select:false) n'est pas chargé par le
   * `findOne` de contrôle d'accès : il est récupéré par une requête
   * ciblée, puis servi via un flux `Readable`.
   */
  async telechargerFichier(
    documentId: string,
    userEmail: string,
  ): Promise<TelechargerFichierResult> {
    const doc = await this.dataSource
      .getRepository(DocumentOfficiel)
      .findOne({ where: { id: documentId } });
    if (!doc) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }
    if (!doc.fichierJointNom) {
      throw new NotFoundException(
        `Aucun fichier joint pour le document ${doc.codeDocument}.`,
      );
    }

    const userIdActor = await this.lookupUserIdByEmail(userEmail);
    const visas = await this.dataSource
      .getRepository(DocumentVisa)
      .find({ where: { fkDocument: documentId } });
    const estEmetteur = doc.fkUserEmetteur === userIdActor;
    const estSignataire = doc.fkUserSignataire === userIdActor;
    const estViseur = visas.some((v) => v.fkUserViseur === userIdActor);
    if (!estEmetteur && !estSignataire && !estViseur) {
      throw new ForbiddenException(
        "Téléchargement refusé : vous n'êtes ni émetteur, ni viseur, ni signataire de ce document.",
      );
    }

    // Récupération ciblée du blob (colonne select:false).
    const rows = await this.dataSource.query<
      Array<{ fichier_contenu: Buffer | null }>
    >(
      `SELECT "fichier_contenu" FROM "document_officiel" WHERE "id" = $1 LIMIT 1`,
      [documentId],
    );
    const contenu = rows[0]?.fichier_contenu ?? null;
    if (!contenu || contenu.length === 0) {
      // Ligne antérieure à la migration ...630 (contenu jadis sur disque,
      // non migré) ou fichier corrompu.
      throw new NotFoundException(
        `Contenu du fichier introuvable pour ${doc.codeDocument} (fichier stocké sur l'ancien système disque et non migré — ré-uploader le PDF).`,
      );
    }

    return {
      stream: Readable.from(contenu),
      fichierNom: doc.fichierJointNom,
      mimeType: doc.fichierMime ?? PDF_MIME,
    };
  }

  /**
   * Suppression du PDF (en BROUILLON uniquement). Le contenu, la taille,
   * le mime et le nom passent à NULL.
   */
  async supprimerFichier(documentId: string, userEmail: string): Promise<void> {
    const docRepo = this.dataSource.getRepository(DocumentOfficiel);
    const doc = await docRepo.findOne({ where: { id: documentId } });
    if (!doc) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }
    if (doc.statut !== 'BROUILLON') {
      throw new ConflictException(
        `Suppression fichier impossible : statut '${doc.statut}' (BROUILLON requis).`,
      );
    }
    const userIdEmetteur = await this.lookupUserIdByEmail(userEmail);
    if (doc.fkUserEmetteur !== userIdEmetteur) {
      throw new ForbiddenException(
        `Suppression réservée à l'émetteur du document.`,
      );
    }

    doc.fichierContenu = null;
    doc.fichierTaille = null;
    doc.fichierMime = null;
    doc.fichierJointNom = null;
    doc.dateModification = new Date();
    doc.utilisateurModification = userEmail;
    await docRepo.save(doc);

    await this.dataSource.getRepository(AuditLog).insert({
      utilisateur: userEmail,
      typeAction: 'EDITER_DOCUMENT',
      entiteCible: 'document_officiel',
      idCible: doc.id,
      payloadApres: { action: 'SUPPRIMER_FICHIER' },
      commentaire: `Suppression fichier joint du document ${doc.codeDocument}.`,
      statut: 'success',
    });
  }

  // ─── Helpers privés ─────────────────────────────────────────────

  private async lookupUserIdByEmail(email: string): Promise<string | null> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT "id" FROM "user" WHERE "email" = $1 LIMIT 1`,
      [email],
    );
    return rows[0]?.id ?? null;
  }
}
