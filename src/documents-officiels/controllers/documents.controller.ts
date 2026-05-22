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
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ApporterVisaDto } from '../dto/apporter-visa.dto';
import { CreerDocumentDto } from '../dto/creer-document.dto';
import { EditerDocumentDto } from '../dto/editer-document.dto';
import { ListerDocumentsQueryDto } from '../dto/lister-documents-query.dto';
import { SignerDocumentDto } from '../dto/signer-document.dto';
import { SoumettreVisaDto } from '../dto/soumettre-visa.dto';
import type { ActorContext } from '../services/document-workflow.service';
import { DocumentWorkflowService } from '../services/document-workflow.service';

@ApiTags('documents-officiels')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly workflowService: DocumentWorkflowService) {}

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
}
