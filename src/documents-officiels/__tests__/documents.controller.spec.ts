/**
 * Tests unitaires DocumentsController (Lot 8.1.C Palier 3).
 *
 * Pattern : check decorators @RequirePermissions par endpoint +
 * construction correcte de l'ActorContext + transformation
 * `signer(@CurrentUser, @Req)` qui capture IP + User-Agent pour
 * la signature crypto.
 */
import { Test } from '@nestjs/testing';
import type { Request } from 'express';

import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import {
  PERMISSIONS_KEY,
  type PermissionsMetadata,
} from '../../auth/decorators/require-permissions.decorator';
import { DocumentsController } from '../controllers/documents.controller';
import { DocumentWorkflowService } from '../services/document-workflow.service';

const mockUser: AuthUser = { userId: '23', email: 'dg@bsic.ne' };

describe('DocumentsController (Lot 8.1.C Palier 3)', () => {
  let controller: DocumentsController;
  let service: {
    creerDocument: jest.Mock;
    editerDocument: jest.Mock;
    soumettreVisa: jest.Mock;
    apporterVisa: jest.Mock;
    signerDocument: jest.Mock;
    verifierIntegrite: jest.Mock;
    historiqueDocument: jest.Mock;
    listerDocuments: jest.Mock;
    detailDocument: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      creerDocument: jest.fn(),
      editerDocument: jest.fn(),
      soumettreVisa: jest.fn(),
      apporterVisa: jest.fn(),
      signerDocument: jest.fn(),
      verifierIntegrite: jest.fn(),
      historiqueDocument: jest.fn(),
      listerDocuments: jest.fn(),
      detailDocument: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [{ provide: DocumentWorkflowService, useValue: service }],
    }).compile();
    controller = moduleRef.get(DocumentsController);
  });

  // ─── RBAC decorators metadata par endpoint ──────────────────────

  it('@RequirePermissions(DOCUMENT.CREER) sur POST / (creer)', () => {
    const meta = Reflect.getMetadata(
      PERMISSIONS_KEY,
      controller.creer,
    ) as PermissionsMetadata;
    expect(meta.permissions).toContain('DOCUMENT.CREER');
  });

  it('@RequirePermissions(DOCUMENT.VISER) sur POST /:id/visa', () => {
    const meta = Reflect.getMetadata(
      PERMISSIONS_KEY,
      controller.visa,
    ) as PermissionsMetadata;
    expect(meta.permissions).toContain('DOCUMENT.VISER');
  });

  it('@RequirePermissions(DOCUMENT.SIGNER) sur POST /:id/signer', () => {
    const meta = Reflect.getMetadata(
      PERMISSIONS_KEY,
      controller.signer,
    ) as PermissionsMetadata;
    expect(meta.permissions).toContain('DOCUMENT.SIGNER');
  });

  it('@RequirePermissions(DOCUMENT.LIRE) sur GET /:id/historique', () => {
    const meta = Reflect.getMetadata(
      PERMISSIONS_KEY,
      controller.historique,
    ) as PermissionsMetadata;
    expect(meta.permissions).toContain('DOCUMENT.LIRE');
  });

  // ─── Construction ActorContext ─────────────────────────────────

  it('creer construit ActorContext (userId/email, isAdmin=false)', async () => {
    const dto = {
      codeDocument: 'X',
      typeDocument: 'D2_LETTRE_CADRAGE' as const,
      fkCampagne: 'camp-1',
      titre: 'T',
      contenuHtml: '<p>X</p>',
      fkUserSignataire: '24',
    };
    service.creerDocument.mockResolvedValue({ id: 'doc-1' });
    await controller.creer(dto, mockUser);
    expect(service.creerDocument).toHaveBeenCalledWith(
      dto,
      expect.objectContaining({
        userId: '23',
        userEmail: 'dg@bsic.ne',
        isAdmin: false,
      }),
    );
  });

  it('signer construit ActorContext AVEC ipAddress + userAgent depuis Request', async () => {
    const req = {
      ip: '10.0.0.5',
      headers: { 'user-agent': 'Postman/9.0' },
      socket: { remoteAddress: '10.0.0.5' },
    } as unknown as Request;
    service.signerDocument.mockResolvedValue({ id: 'doc-1', statut: 'SIGNE' });
    await controller.signer(
      'doc-uuid-1',
      { motDePasse: 'secret' },
      mockUser,
      req,
    );
    expect(service.signerDocument).toHaveBeenCalledWith(
      'doc-uuid-1',
      { motDePasse: 'secret' },
      expect.objectContaining({
        userId: '23',
        userEmail: 'dg@bsic.ne',
        ipAddress: '10.0.0.5',
        userAgent: 'Postman/9.0',
      }),
    );
  });

  it('visa délègue au service avec dto + actor', async () => {
    service.apporterVisa.mockResolvedValue({ id: 'doc-1' });
    await controller.visa('doc-uuid-1', { action: 'VISER' }, mockUser);
    expect(service.apporterVisa).toHaveBeenCalledWith(
      'doc-uuid-1',
      { action: 'VISER' },
      expect.objectContaining({ userId: '23' }),
    );
  });

  // ─── Endpoints lecture (pas d'actor pour audit/integrite) ──────

  it("verifierIntegrite délègue le documentId au service (pas d'actor)", async () => {
    service.verifierIntegrite.mockResolvedValue({
      documentId: 'doc-uuid-1',
      signaturePresente: false,
    });
    await controller.verifierIntegrite('doc-uuid-1');
    expect(service.verifierIntegrite).toHaveBeenCalledWith('doc-uuid-1');
  });

  it("historique délègue le documentId au service (pas d'actor)", async () => {
    service.historiqueDocument.mockResolvedValue({
      documentId: 'doc-uuid-1',
      evenements: [],
    });
    await controller.historique('doc-uuid-1');
    expect(service.historiqueDocument).toHaveBeenCalledWith('doc-uuid-1');
  });
});
