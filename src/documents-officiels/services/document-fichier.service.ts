/**
 * DocumentFichierService (Lot 8.1.D) — upload/download/suppression du
 * PDF original attaché à un document officiel.
 *
 * Le PDF original (reçu du Holding ou émis en interne) est la **source
 * de vérité documentaire** pour audit BCEAO. Conservation 10 ans avec
 * le document. Stocké sur disque local (chemin paramétré via env
 * `DOCUMENTS_UPLOAD_PATH`), pas dans la DB.
 *
 * Structure de stockage :
 *   <uploadRoot>/<exercice>/<codeDocument>.pdf
 *
 * Le `fichier_joint_path` en DB stocke le chemin RELATIF à uploadRoot
 * (portabilité entre environnements). Le `fichier_joint_nom` capture
 * le nom original pour le téléchargement.
 *
 * **Sécurité** :
 *   - Magic bytes PDF vérifiés (le MIME type HTTP est trichable)
 *   - Path traversal bloqué via validation de `codeDocument`
 *   - Limite 10 MB côté FileInterceptor (controller)
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { createReadStream, type ReadStream } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { resolve as resolvePath, dirname } from 'path';
import { DataSource } from 'typeorm';

import { AuditLog } from '../../audit/entities/audit-log.entity';
import { DocumentOfficiel } from '../entities/document-officiel.entity';
import { DocumentVisa } from '../entities/document-visa.entity';
import { CampagneBudgetaire } from '../entities/campagne-budgetaire.entity';

const TAILLE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const PDF_MAGIC_HEADER = '%PDF-';

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
  stream: ReadStream;
  fichierNom: string;
  mimeType: string;
}

@Injectable()
export class DocumentFichierService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

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
   *   - Si un fichier existait déjà → unlink ancien avant write nouveau
   *   - mkdir récursif `<uploadRoot>/<exerciceFiscal>/`
   *   - writeFile `<uploadRoot>/<exerciceFiscal>/<codeDocument>.pdf`
   *   - UPDATE document_officiel (path relatif + nom original)
   *   - INSERT audit_log EDITER_DOCUMENT avec payload UPLOAD_FICHIER
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

    // Path resolution + protection path traversal.
    const exercice = await this.lookupExerciceFiscal(doc.fkCampagne);
    const uploadRoot = this.getUploadRoot();
    const codeDocSafe = this.sanitizeCodeDocument(doc.codeDocument);
    const relativePath = `${exercice}/${codeDocSafe}.pdf`;
    const absolutePath = resolvePath(uploadRoot, relativePath);
    // Vérifie que le chemin résolu reste DANS uploadRoot (anti-traversal
    // ceinture-bretelle, même si sanitizeCodeDocument a déjà fait son job).
    if (!absolutePath.startsWith(resolvePath(uploadRoot))) {
      throw new BadRequestException(
        'Chemin de stockage invalide (path traversal détecté).',
      );
    }

    // Suppression ancien fichier (remplacement). Tolérant aux erreurs
    // ENOENT (fichier supprimé manuellement entre-temps).
    if (doc.fichierJointPath) {
      const oldAbs = resolvePath(uploadRoot, doc.fichierJointPath);
      try {
        await unlink(oldAbs);
      } catch {
        // Best-effort, on ne bloque pas l'upload pour un cleanup raté.
      }
    }

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.buffer);

    doc.fichierJointPath = relativePath;
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
        action: doc.fichierJointPath ? 'REMPLACER_FICHIER' : 'UPLOAD_FICHIER',
        nom: file.originalname,
        taille: file.size,
        cheminRelatif: relativePath,
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
   * Téléchargement du PDF stocké.
   *
   * Accès = émetteur OU viseur OU signataire (mêmes règles que
   * `DocumentWorkflowService.detailDocument`). Le bypass admin reste
   * dette technique du Lot 8.1.C.
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
    if (!doc.fichierJointPath || !doc.fichierJointNom) {
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

    const absolutePath = resolvePath(
      this.getUploadRoot(),
      doc.fichierJointPath,
    );
    return {
      stream: createReadStream(absolutePath),
      fichierNom: doc.fichierJointNom,
      mimeType: 'application/pdf',
    };
  }

  /**
   * Suppression du PDF (en BROUILLON uniquement). Le fichier sur disque
   * est unlink, les colonnes DB passent à NULL.
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

    if (doc.fichierJointPath) {
      const abs = resolvePath(this.getUploadRoot(), doc.fichierJointPath);
      try {
        await unlink(abs);
      } catch {
        // Best-effort.
      }
    }

    doc.fichierJointPath = null;
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

  private getUploadRoot(): string {
    return this.config.get<string>(
      'DOCUMENTS_UPLOAD_PATH',
      './uploads/documents',
    );
  }

  /**
   * Bloque les caractères dangereux dans `codeDocument` (path traversal,
   * séparateurs, null bytes). En complément de `path.resolve()` + check
   * startsWith uploadRoot dans `uploadFichier`.
   */
  private sanitizeCodeDocument(code: string): string {
    if (/[/\\.\0]/.test(code) || code.includes('..')) {
      throw new BadRequestException(
        `Code document '${code}' contient des caractères interdits (/, \\, ., \\0, ..).`,
      );
    }
    return code;
  }

  private async lookupUserIdByEmail(email: string): Promise<string | null> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT "id" FROM "user" WHERE "email" = $1 LIMIT 1`,
      [email],
    );
    return rows[0]?.id ?? null;
  }

  private async lookupExerciceFiscal(
    campagneId: string | null,
  ): Promise<string> {
    if (!campagneId) {
      // Document sans campagne — fallback "orphelins" pour ne pas crasher.
      return 'orphelins';
    }
    const c = await this.dataSource
      .getRepository(CampagneBudgetaire)
      .findOne({ where: { id: campagneId } });
    return String(c?.exerciceFiscal ?? 'orphelins');
  }
}
