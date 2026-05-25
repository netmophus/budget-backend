/**
 * DocumentsController (Lot 8.1.C) — 9 endpoints REST pour le workflow
 * signature des documents officiels.
 *
 *   POST   /api/v1/documents               DOCUMENT.CREER  creer (201)
 *   GET    /api/v1/documents               DOCUMENT.LIRE   lister
 *   GET    /api/v1/documents/:id           DOCUMENT.LIRE   detail
 *   PATCH  /api/v1/documents/:id           DOCUMENT.CREER  editer
 *   POST   /api/v1/documents/:id/soumettre DOCUMENT.CREER  → SOUMIS_VISA (200)
 *   POST   /api/v1/documents/:id/visa      DOCUMENT.VISER  visa/rejet (200)
 *   POST   /api/v1/documents/:id/signer    DOCUMENT.SIGNER → SIGNE (200)
 *   GET    /api/v1/documents/:id/integrite DOCUMENT.LIRE   verif crypto
 *   GET    /api/v1/documents/:id/historique DOCUMENT.LIRE  timeline audit
 *
 * Construit un `ActorContext` à partir de `@CurrentUser()` + `@Req()`
 * pour passer au DocumentWorkflowService (qui a besoin de userId, IP,
 * UA pour les checks métier + la signature crypto).
 *
 * **Note isAdmin** : passé à `false` au Lot 8.1.C — le bypass admin
 * (editerDocument et detailDocument permettent à ADMIN de contourner
 * le check émetteur) sera implémenté dans un futur palier via un
 * `PermissionService` dédié. Le check `user === emetteur` reste
 * effectif pour tous les autres rôles. Décision documentée au
 * cadrage Lot 8.1.C.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ApporterVisaDto } from '../dto/apporter-visa.dto';
import { CreerDocumentDto } from '../dto/creer-document.dto';
import { EditerDocumentDto } from '../dto/editer-document.dto';
import { CreerOuMettreAJourLettreCadrageDetailDto } from '../dto/lettre-cadrage-detail.dto';
import { CreerOuMettreAJourLettreMobilisationDetailDto } from '../dto/lettre-mobilisation-detail.dto';
import { ListerDocumentsQueryDto } from '../dto/lister-documents-query.dto';
import { CreerOuMettreAJourNoteOrientationDetailDto } from '../dto/note-orientation-detail.dto';
import { CreerOuMettreAJourLettreOfficialisationDetailDto } from '../dto/lettre-officialisation-detail.dto';
import { CreerOuMettreAJourNotePreparatoireDetailDto } from '../dto/note-preparatoire-detail.dto';
import { CreerOuMettreAJourPvApprobationDetailDto } from '../dto/pv-approbation-detail.dto';
import { SignerDocumentDto } from '../dto/signer-document.dto';
import { SoumettreVisaDto } from '../dto/soumettre-visa.dto';
import {
  DocumentFichierService,
  type UploadedPdfFile,
} from '../services/document-fichier.service';
import type { ActorContext } from '../services/document-workflow.service';
import { DocumentWorkflowService } from '../services/document-workflow.service';
import { LettreCadrageService } from '../services/lettre-cadrage.service';
import { LettreMobilisationService } from '../services/lettre-mobilisation.service';
import { NoteOrientationService } from '../services/note-orientation.service';
import { LettreOfficialisationService } from '../services/lettre-officialisation.service';
import { NotePreparatoireService } from '../services/note-preparatoire.service';
import { PvApprobationService } from '../services/pv-approbation.service';
import { BordereauService } from '../../reporting/services/bordereau.service';

@ApiTags('documents-officiels')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly workflowService: DocumentWorkflowService,
    private readonly fichierService: DocumentFichierService,
    private readonly lettreCadrageService: LettreCadrageService,
    private readonly noteOrientationService: NoteOrientationService,
    private readonly lettreMobilisationService: LettreMobilisationService,
    private readonly notePreparatoireService: NotePreparatoireService,
    private readonly pvApprobationService: PvApprobationService,
    private readonly lettreOfficialisationService: LettreOfficialisationService,
    private readonly bordereauService: BordereauService,
  ) {}

  /**
   * Helper : construit l'`ActorContext` à partir des décorateurs NestJS.
   * `isAdmin` est forcé à false — voir doc de classe.
   */
  private toActor(user: AuthUser, req?: Request): ActorContext {
    return {
      userId: user.userId,
      userEmail: user.email,
      isAdmin: false,
      ipAddress: req?.ip ?? req?.socket?.remoteAddress ?? null,
      userAgent: req?.headers['user-agent'] ?? null,
    };
  }

  // ─── 1. POST / — creer ───────────────────────────────────────────

  @Post()
  @RequirePermissions('DOCUMENT.CREER')
  @ApiOperation({
    summary:
      'Crée un nouveau document officiel en statut BROUILLON. La campagne doit être en EN_COURS.',
  })
  @ApiCreatedResponse({ description: 'Document créé.' })
  @ApiBadRequestResponse({
    description: 'Type document hors whitelist ou DTO invalide.',
  })
  @ApiConflictResponse({
    description: 'Code document déjà pris OU campagne pas EN_COURS.',
  })
  @ApiNotFoundResponse({
    description: 'Campagne ou signataire introuvable.',
  })
  async creer(@Body() dto: CreerDocumentDto, @CurrentUser() user: AuthUser) {
    return this.workflowService.creerDocument(dto, this.toActor(user));
  }

  // ─── 2. GET / — lister ───────────────────────────────────────────

  @Get()
  @RequirePermissions('DOCUMENT.LIRE')
  @ApiOperation({
    summary:
      'Liste les documents accessibles : émetteur, viseur, signataire ou ADMIN. Filtres : statut, type, campagne, monRole.',
  })
  @ApiOkResponse({
    description: 'Liste des documents (tri date_modification DESC).',
  })
  async lister(
    @Query() query: ListerDocumentsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workflowService.listerDocuments(query, this.toActor(user));
  }

  // ─── 3. GET /:id — detail ────────────────────────────────────────

  @Get(':id')
  @RequirePermissions('DOCUMENT.LIRE')
  @ApiOperation({
    summary:
      "Détail d'un document avec ses visas et signature. Acteur (émetteur/viseur/signataire) requis sauf ADMIN.",
  })
  @ApiOkResponse({ description: 'Document + visas + signature.' })
  @ApiNotFoundResponse({ description: 'Document introuvable.' })
  @ApiForbiddenResponse({ description: 'Pas acteur du document.' })
  async detail(
    @Param('id', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workflowService.detailDocument(documentId, this.toActor(user));
  }

  // ─── 4. PATCH /:id — editer ──────────────────────────────────────

  @Patch(':id')
  @RequirePermissions('DOCUMENT.CREER')
  @ApiOperation({
    summary:
      'Modifie un BROUILLON (émetteur seul). Tous les champs sont optionnels.',
  })
  @ApiOkResponse({ description: 'Document modifié.' })
  @ApiForbiddenResponse({ description: 'Pas émetteur.' })
  @ApiConflictResponse({ description: 'Statut différent de BROUILLON.' })
  @ApiNotFoundResponse({ description: 'Document introuvable.' })
  async editer(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() dto: EditerDocumentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workflowService.editerDocument(
      documentId,
      dto,
      this.toActor(user),
    );
  }

  // ─── 5. POST /:id/soumettre — BROUILLON → SOUMIS_VISA ────────────

  @Post(':id/soumettre')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('DOCUMENT.CREER')
  @ApiOperation({
    summary:
      'Soumet un BROUILLON au visa du Comité. Snapshot N lignes document_visa (figé même si le Comité évolue après).',
  })
  @ApiOkResponse({ description: 'Document soumis, statut = SOUMIS_VISA.' })
  @ApiForbiddenResponse({ description: 'Pas émetteur.' })
  @ApiConflictResponse({
    description:
      'Statut différent de BROUILLON OU campagne pas EN_COURS OU Comité vide.',
  })
  async soumettre(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() dto: SoumettreVisaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workflowService.soumettreVisa(
      documentId,
      dto,
      this.toActor(user),
    );
  }

  // ─── 6. POST /:id/visa — VISER ou REJETER ────────────────────────

  @Post(':id/visa')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('DOCUMENT.VISER')
  @ApiOperation({
    summary:
      "Appose un visa (VISER ou REJETER) sur un document SOUMIS_VISA. Mode séquentiel : visas d'ordre inférieur doivent déjà être VISE.",
  })
  @ApiOkResponse({
    description:
      'Visa apposé. Si tous obligatoires VISE → document passe en VISE auto. Si REJETER → retour BROUILLON.',
  })
  @ApiForbiddenResponse({
    description:
      'Pas dans le Comité, ou déjà visé, ou séquence ordre non respectée.',
  })
  @ApiBadRequestResponse({ description: 'REJETER sans commentaire.' })
  @ApiConflictResponse({ description: 'Statut différent de SOUMIS_VISA.' })
  async visa(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() dto: ApporterVisaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workflowService.apporterVisa(
      documentId,
      dto,
      this.toActor(user),
    );
  }

  // ─── 7. POST /:id/signer — VISE → SIGNE (irreversible) ───────────

  @Post(':id/signer')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('DOCUMENT.SIGNER')
  @ApiOperation({
    summary:
      "Signature finale d'un document VISE. **ACTION IRRÉVERSIBLE** : hash crypto + audit + capture IP/UA. Re-saisie mot de passe obligatoire.",
  })
  @ApiOkResponse({ description: 'Document signé, statut = SIGNE.' })
  @ApiUnauthorizedResponse({ description: 'Mot de passe invalide.' })
  @ApiForbiddenResponse({ description: 'Pas le signataire désigné.' })
  @ApiConflictResponse({ description: 'Statut différent de VISE.' })
  async signer(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() dto: SignerDocumentDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.workflowService.signerDocument(
      documentId,
      dto,
      this.toActor(user, request),
    );
  }

  // ─── 8. GET /:id/integrite — audit crypto ────────────────────────

  @Get(':id/integrite')
  @RequirePermissions('DOCUMENT.LIRE')
  @ApiOperation({
    summary:
      "Vérifie l'intégrité cryptographique d'un document signé. Recalcule hash_contenu + hash_visas, compare avec ceux figés au moment de la signature.",
  })
  @ApiOkResponse({
    description:
      'Résultat avec contenuIntact / visasIntacts + diagnostic des hashes.',
  })
  @ApiNotFoundResponse({ description: 'Document introuvable.' })
  async verifierIntegrite(@Param('id', ParseUUIDPipe) documentId: string) {
    return this.workflowService.verifierIntegrite(documentId);
  }

  // ─── 9. GET /:id/historique — timeline audit ─────────────────────

  @Get(':id/historique')
  @RequirePermissions('DOCUMENT.LIRE')
  @ApiOperation({
    summary:
      "Timeline chronologique d'un document depuis audit_log (création, éditions, soumission, visas, signature). Libellés FR.",
  })
  @ApiOkResponse({ description: "Liste d'événements ordonnés ASC." })
  @ApiNotFoundResponse({
    description: 'Aucun événement (document inexistant).',
  })
  async historique(@Param('id', ParseUUIDPipe) documentId: string) {
    return this.workflowService.historiqueDocument(documentId);
  }

  // ─── 10. POST /:id/upload-fichier — Lot 8.1.D ────────────────────

  @Post(':id/upload-fichier')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('DOCUMENT.CREER')
  @UseInterceptors(
    FileInterceptor('fichier', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req, file, callback) => {
        if (file.mimetype !== 'application/pdf') {
          return callback(
            new BadRequestException(
              'Seuls les fichiers PDF (Content-Type: application/pdf) sont acceptés.',
            ),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'PDF original (≤ 10 MB) à attacher au document.',
    schema: {
      type: 'object',
      properties: {
        fichier: {
          type: 'string',
          format: 'binary',
          description: 'Fichier PDF (multipart field name = "fichier").',
        },
      },
      required: ['fichier'],
    },
  })
  @ApiOperation({
    summary:
      'Attache un PDF original au document (BROUILLON only, émetteur only). Source de vérité documentaire pour audit BCEAO. Validation magic bytes %PDF- en plus du MIME type. Remplace silencieusement un fichier précédent.',
  })
  @ApiOkResponse({
    description:
      'Fichier uploadé, document_officiel.fichier_joint_path mis à jour.',
  })
  @ApiBadRequestResponse({
    description:
      'Fichier absent, vide, non-PDF (MIME ou magic bytes), ou > 10 MB.',
  })
  @ApiForbiddenResponse({ description: "Pas l'émetteur du document." })
  @ApiConflictResponse({ description: 'Statut différent de BROUILLON.' })
  @ApiNotFoundResponse({ description: 'Document introuvable.' })
  async uploadFichier(
    @Param('id', ParseUUIDPipe) documentId: string,
    @UploadedFile() file: UploadedPdfFile | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Fichier requis (multipart field "fichier", PDF ≤ 10 MB).',
      );
    }
    return this.fichierService.uploadFichier(documentId, file, user.email);
  }

  // ─── 11. GET /:id/fichier — Lot 8.1.D ────────────────────────────

  @Get(':id/fichier')
  @RequirePermissions('DOCUMENT.LIRE')
  @ApiOperation({
    summary:
      'Télécharge le PDF original attaché au document. Accès : émetteur, viseur ou signataire.',
  })
  @ApiOkResponse({
    description:
      'Stream PDF avec Content-Disposition: attachment + nom original.',
  })
  @ApiNotFoundResponse({
    description: 'Document introuvable ou aucun fichier joint.',
  })
  @ApiForbiddenResponse({
    description:
      'Pas acteur du document (ni émetteur, ni viseur, ni signataire).',
  })
  async telechargerFichier(
    @Param('id', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { stream, fichierNom, mimeType } =
      await this.fichierService.telechargerFichier(documentId, user.email);
    response.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${fichierNom}"`,
    });
    return new StreamableFile(stream);
  }

  // ─── 12. GET /:id/cadrage-detail — Lot 8.2.C ─────────────────────

  @Get(':id/cadrage-detail')
  @RequirePermissions('DOCUMENT.LIRE')
  @ApiOperation({
    summary:
      "Détail métier d'une Lettre de cadrage (objectifs PNB/RN, ratios BCEAO, calendrier 5 jalons, orientations).",
  })
  @ApiOkResponse({
    description:
      'Détail trouvé OU null si pas encore renseigné (BROUILLON fraîchement créé).',
  })
  async lireDetailCadrage(@Param('id', ParseUUIDPipe) documentId: string) {
    return this.lettreCadrageService.lireDetail(documentId);
  }

  // ─── 13. PUT /:id/cadrage-detail — Lot 8.2.C ─────────────────────

  @Put(':id/cadrage-detail')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('DOCUMENT.CREER')
  @ApiOperation({
    summary:
      "Crée OU met à jour le détail métier d'une Lettre de cadrage (UPSERT). Réservé à l'émetteur en BROUILLON.",
  })
  @ApiOkResponse({ description: 'Détail enregistré.' })
  @ApiNotFoundResponse({ description: 'Document introuvable.' })
  @ApiConflictResponse({
    description: 'Type document ≠ D2_LETTRE_CADRAGE OU statut ≠ BROUILLON.',
  })
  @ApiForbiddenResponse({
    description: "Modification réservée à l'émetteur du document.",
  })
  async mettreAJourDetailCadrage(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() dto: CreerOuMettreAJourLettreCadrageDetailDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.lettreCadrageService.creerOuMettreAJour(
      documentId,
      dto,
      user.email,
    );
  }

  // ─── 14. GET /:id/note-orientation-detail — Lot 8.3.A ────────────

  @Get(':id/note-orientation-detail')
  @RequirePermissions('DOCUMENT.LIRE')
  @ApiOperation({
    summary:
      "Détail métier d'une Note d'orientation (analyse macro, axes stratégiques, description riche TipTap).",
  })
  @ApiOkResponse({
    description:
      'Détail trouvé OU null si pas encore renseigné (BROUILLON fraîchement créé).',
  })
  async lireDetailNoteOrientation(
    @Param('id', ParseUUIDPipe) documentId: string,
  ) {
    return this.noteOrientationService.lireDetail(documentId);
  }

  // ─── 15. PUT /:id/note-orientation-detail — Lot 8.3.A ────────────

  @Put(':id/note-orientation-detail')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('DOCUMENT.CREER')
  @ApiOperation({
    summary:
      "Crée OU met à jour le détail métier d'une Note d'orientation (UPSERT). Réservé à l'émetteur en BROUILLON.",
  })
  @ApiOkResponse({ description: 'Détail enregistré.' })
  @ApiNotFoundResponse({ description: 'Document introuvable.' })
  @ApiConflictResponse({
    description: 'Type document ≠ D3_NOTE_ORIENTATION OU statut ≠ BROUILLON.',
  })
  @ApiForbiddenResponse({
    description: "Modification réservée à l'émetteur du document.",
  })
  async mettreAJourDetailNoteOrientation(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() dto: CreerOuMettreAJourNoteOrientationDetailDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.noteOrientationService.creerOuMettreAJour(
      documentId,
      dto,
      user.email,
    );
  }

  // ─── 16. GET /:id/lettre-mobilisation-detail — Lot 8.3.B ─────────

  @Get(':id/lettre-mobilisation-detail')
  @RequirePermissions('DOCUMENT.LIRE')
  @ApiOperation({
    summary:
      "Détail métier d'une Lettre de mobilisation (objectifs globaux, indicateurs mobilisation, échéances, message DG TipTap).",
  })
  @ApiOkResponse({
    description:
      'Détail trouvé OU null si pas encore renseigné (BROUILLON fraîchement créé).',
  })
  async lireDetailLettreMobilisation(
    @Param('id', ParseUUIDPipe) documentId: string,
  ) {
    return this.lettreMobilisationService.lireDetail(documentId);
  }

  // ─── 17. PUT /:id/lettre-mobilisation-detail — Lot 8.3.B ─────────

  @Put(':id/lettre-mobilisation-detail')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('DOCUMENT.CREER')
  @ApiOperation({
    summary:
      "Crée OU met à jour le détail métier d'une Lettre de mobilisation (UPSERT). Réservé à l'émetteur en BROUILLON.",
  })
  @ApiOkResponse({ description: 'Détail enregistré.' })
  @ApiNotFoundResponse({ description: 'Document introuvable.' })
  @ApiConflictResponse({
    description: 'Type document ≠ D5_LETTRE_DG OU statut ≠ BROUILLON.',
  })
  @ApiForbiddenResponse({
    description: "Modification réservée à l'émetteur du document.",
  })
  async mettreAJourDetailLettreMobilisation(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() dto: CreerOuMettreAJourLettreMobilisationDetailDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.lettreMobilisationService.creerOuMettreAJour(
      documentId,
      dto,
      user.email,
    );
  }

  // ─── 18. GET /:id/note-preparatoire-detail — Lot 8.3.C ───────────

  @Get(':id/note-preparatoire-detail')
  @RequirePermissions('DOCUMENT.LIRE')
  @ApiOperation({
    summary:
      "Détail métier d'une Note préparatoire DG (référence + convocation Comité + lieu + participants + exercice + ordre du jour TipTap + documents pré-lus + points clés + décisions attendues).",
  })
  @ApiOkResponse({
    description:
      'Détail trouvé OU null si pas encore renseigné (BROUILLON fraîchement créé).',
  })
  async lireDetailNotePreparatoire(
    @Param('id', ParseUUIDPipe) documentId: string,
  ) {
    return this.notePreparatoireService.lireDetail(documentId);
  }

  // ─── 19. PUT /:id/note-preparatoire-detail — Lot 8.3.C ───────────

  @Put(':id/note-preparatoire-detail')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('DOCUMENT.CREER')
  @ApiOperation({
    summary:
      "Crée OU met à jour le détail métier d'une Note préparatoire DG (UPSERT). Réservé à l'émetteur en BROUILLON.",
  })
  @ApiOkResponse({ description: 'Détail enregistré.' })
  @ApiNotFoundResponse({ description: 'Document introuvable.' })
  @ApiConflictResponse({
    description: 'Type document ≠ D1_NOTE_PREPARATOIRE OU statut ≠ BROUILLON.',
  })
  @ApiForbiddenResponse({
    description: "Modification réservée à l'émetteur du document.",
  })
  async mettreAJourDetailNotePreparatoire(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() dto: CreerOuMettreAJourNotePreparatoireDetailDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notePreparatoireService.creerOuMettreAJour(
      documentId,
      dto,
      user.email,
    );
  }

  // ─── 20. GET /:id/pv-approbation-detail — Lot 8.3.D ──────────────

  @Get(':id/pv-approbation-detail')
  @RequirePermissions('DOCUMENT.LIRE')
  @ApiOperation({
    summary:
      "Détail métier d'un PV d'approbation CA (identification + présidence + quorum + ordre du jour TipTap + décisions TipTap + vote + commentaire président).",
  })
  @ApiOkResponse({
    description:
      'Détail trouvé OU null si pas encore renseigné (BROUILLON fraîchement créé).',
  })
  async lireDetailPvApprobation(
    @Param('id', ParseUUIDPipe) documentId: string,
  ) {
    return this.pvApprobationService.lireDetail(documentId);
  }

  // ─── 21. PUT /:id/pv-approbation-detail — Lot 8.3.D ──────────────

  @Put(':id/pv-approbation-detail')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('DOCUMENT.CREER')
  @ApiOperation({
    summary:
      "Crée OU met à jour le détail métier d'un PV d'approbation CA (UPSERT). Réservé à l'émetteur en BROUILLON.",
  })
  @ApiOkResponse({ description: 'Détail enregistré.' })
  @ApiNotFoundResponse({ description: 'Document introuvable.' })
  @ApiConflictResponse({
    description: 'Type document ≠ D11_PV_APPROBATION OU statut ≠ BROUILLON.',
  })
  @ApiForbiddenResponse({
    description: "Modification réservée à l'émetteur du document.",
  })
  async mettreAJourDetailPvApprobation(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() dto: CreerOuMettreAJourPvApprobationDetailDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pvApprobationService.creerOuMettreAJour(
      documentId,
      dto,
      user.email,
    );
  }

  // ─── 22. GET /:id/lettre-officialisation-detail — Lot 8.3.E ──────

  @Get(':id/lettre-officialisation-detail')
  @RequirePermissions('DOCUMENT.LIRE')
  @ApiOperation({
    summary:
      "Détail métier d'une Lettre d'officialisation (identification + destinataires + référence PV CA + corps TipTap + signature + cachet apposé).",
  })
  @ApiOkResponse({
    description:
      'Détail trouvé OU null si pas encore renseigné (BROUILLON fraîchement créé).',
  })
  async lireDetailLettreOfficialisation(
    @Param('id', ParseUUIDPipe) documentId: string,
  ) {
    return this.lettreOfficialisationService.lireDetail(documentId);
  }

  // ─── 23. PUT /:id/lettre-officialisation-detail — Lot 8.3.E ──────

  @Put(':id/lettre-officialisation-detail')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('DOCUMENT.CREER')
  @ApiOperation({
    summary:
      "Crée OU met à jour le détail métier d'une Lettre d'officialisation (UPSERT). Réservé à l'émetteur en BROUILLON.",
  })
  @ApiOkResponse({ description: 'Détail enregistré.' })
  @ApiNotFoundResponse({ description: 'Document introuvable.' })
  @ApiConflictResponse({
    description:
      'Type document ≠ D12_LETTRE_OFFICIALISATION OU statut ≠ BROUILLON.',
  })
  @ApiForbiddenResponse({
    description: "Modification réservée à l'émetteur du document.",
  })
  async mettreAJourDetailLettreOfficialisation(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Body() dto: CreerOuMettreAJourLettreOfficialisationDetailDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.lettreOfficialisationService.creerOuMettreAJour(
      documentId,
      dto,
      user.email,
    );
  }

  // ─── 24. GET /:id/bordereau-validation — Lot 8.4 (R3) ────────────

  @Get(':id/bordereau-validation')
  @RequirePermissions('DOCUMENT.LIRE')
  @ApiOperation({
    summary:
      'Télécharge le bordereau de validation R3 (PDF officiel BSIC). Disponible UNIQUEMENT si statut du document = VISE ou SIGNE. Format consolidé listant tous les viseurs ayant validé positivement.',
  })
  @ApiOkResponse({
    description:
      'PDF binaire (application/pdf), Content-Disposition: attachment. Format consolidé.',
  })
  @ApiNotFoundResponse({ description: 'Document introuvable.' })
  @ApiConflictResponse({
    description:
      'Statut document ≠ VISE et ≠ SIGNE (bordereau non encore disponible).',
  })
  @ApiForbiddenResponse({ description: 'Permission DOCUMENT.LIRE manquante.' })
  async telechargerBordereauValidation(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Res() res: Response,
  ): Promise<void> {
    // Validation faite dans le service (404/409 levés en amont).
    const data = await this.bordereauService.extractDataR3(documentId);
    const buffer =
      await this.bordereauService.genererBordereauValidation(documentId);
    const filename = `R3-bordereau-validation-${data.document.codeDocument}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }

  // ─── 25. GET /:id/bordereau-rejet — Lot 8.4 (R5) ─────────────────

  @Get(':id/bordereau-rejet')
  @RequirePermissions('DOCUMENT.LIRE')
  @ApiOperation({
    summary:
      'Télécharge le bordereau de rejet R5 (PDF officiel BSIC). Disponible UNIQUEMENT si au moins un visa REJETE existe sur le document. Atteste du rejet (auteur, fonction, date, motif).',
  })
  @ApiOkResponse({
    description:
      'PDF binaire (application/pdf), Content-Disposition: attachment.',
  })
  @ApiNotFoundResponse({ description: 'Document introuvable.' })
  @ApiConflictResponse({
    description:
      'Aucun visa REJETE sur ce document (bordereau non applicable).',
  })
  @ApiForbiddenResponse({ description: 'Permission DOCUMENT.LIRE manquante.' })
  async telechargerBordereauRejet(
    @Param('id', ParseUUIDPipe) documentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const data = await this.bordereauService.extractDataR5(documentId);
    const buffer =
      await this.bordereauService.genererBordereauRejet(documentId);
    const filename = `R5-bordereau-rejet-${data.document.codeDocument}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }
}
