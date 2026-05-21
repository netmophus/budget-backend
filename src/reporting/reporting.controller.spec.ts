/**
 * Tests unitaires ReportingController (Lot 7.6 — Palier 4).
 *
 * Couvre :
 *  - Décorateur @RequirePermissions('BUDGET.LIRE') posé sur les 2
 *    handlers (équivaut à garantir le 403 par PermissionsGuard global)
 *  - Content-Type headers corrects (PDF / XLSX)
 *  - Content-Disposition: attachment avec filename respectant le
 *    pattern `<code>_R04_BCEAO_<YYYYMMDD>.<ext>`
 *  - Audit log écrit après succès (typeAction + payloadApres riche)
 */
import { Test } from '@nestjs/testing';
import type { Response } from 'express';

import { AuditService } from '../audit/audit.service';
import {
  PERMISSIONS_KEY,
  type PermissionsMetadata,
} from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { ReportingController } from './reporting.controller';
import {
  R04BudgetBceaoService,
  type R04Donnees,
} from './services/r04-budget-bceao.service';

function mockDonnees(): R04Donnees {
  return {
    version: {
      id: '42',
      code_version: 'BUDGET_2026_v1.0',
      libelle: 'Budget initial 2026',
      type_version: 'budget_initial',
      exercice_fiscal: 2026,
      statut: 'gele',
      date_soumission: null,
      utilisateur_soumission: null,
      commentaire_soumission: null,
      date_validation: null,
      utilisateur_validation: null,
      commentaire_validation: null,
      date_gel: '2026-05-20T17:09:00.000Z',
      utilisateur_gel: 'dg@bsic.ne',
      commentaire_publication: null,
    },
    totaux: {
      nb_lignes: 0,
      nb_comptes: 0,
      nb_cr: 0,
      total_produits: 0,
      total_charges: 0,
    },
    ventilationCr: [],
    detailComptes: [],
    comptedeResultat: [],
    auditTrail: [],
  };
}

function mockResponse(): Response & {
  setHeader: jest.Mock;
  send: jest.Mock;
} {
  return {
    setHeader: jest.fn(),
    send: jest.fn(),
  } as unknown as Response & { setHeader: jest.Mock; send: jest.Mock };
}

const mockUser: AuthUser = {
  userId: '1',
  email: 'dg@bsic.ne',
} as AuthUser;

describe('ReportingController', () => {
  let controller: ReportingController;
  let r04Service: {
    extractDonnees: jest.Mock;
    genererPdfBuffer: jest.Mock;
    genererXlsxBuffer: jest.Mock;
  };
  let auditService: { log: jest.Mock };

  beforeEach(async () => {
    r04Service = {
      extractDonnees: jest.fn().mockResolvedValue(mockDonnees()),
      genererPdfBuffer: jest
        .fn()
        .mockResolvedValue(Buffer.from('%PDF-1.4 fake content', 'utf8')),
      genererXlsxBuffer: jest
        .fn()
        .mockResolvedValue(Buffer.from('PK\x03\x04 fake xlsx', 'binary')),
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      controllers: [ReportingController],
      providers: [
        { provide: R04BudgetBceaoService, useValue: r04Service },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    controller = moduleRef.get(ReportingController);
  });

  // ─── 403 — couverture par décorateur RBAC ─────────────────────

  it('@RequirePermissions(BUDGET.LIRE) posé sur downloadR04Pdf', () => {
    const meta = Reflect.getMetadata(
      PERMISSIONS_KEY,
      controller.downloadR04Pdf,
    ) as PermissionsMetadata;
    expect(meta).toBeDefined();
    expect(meta.permissions).toContain('BUDGET.LIRE');
  });

  it('@RequirePermissions(BUDGET.LIRE) posé sur downloadR04Xlsx', () => {
    const meta = Reflect.getMetadata(
      PERMISSIONS_KEY,
      controller.downloadR04Xlsx,
    ) as PermissionsMetadata;
    expect(meta).toBeDefined();
    expect(meta.permissions).toContain('BUDGET.LIRE');
  });

  // ─── PDF — Content-Type + Content-Disposition + audit ─────────

  it('downloadR04Pdf : Content-Type application/pdf + attachment + audit', async () => {
    const res = mockResponse();
    await controller.downloadR04Pdf('42', mockUser, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/pdf',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(
        /^attachment; filename="BUDGET_2026_v1\.0_R04_BCEAO_\d{8}\.pdf"$/,
      ),
    );
    expect(res.send).toHaveBeenCalledTimes(1);
    const sentBuffer = res.send.mock.calls[0][0] as Buffer;
    expect(Buffer.isBuffer(sentBuffer)).toBe(true);
    expect(sentBuffer.length).toBeGreaterThan(0);

    // Audit log écrit AVANT le res.send (séquentiel async)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        utilisateur: 'dg@bsic.ne',
        typeAction: 'EXPORT_R04_PDF',
        entiteCible: 'dim_version',
        idCible: '42',
        statut: 'success',
        payloadApres: expect.objectContaining({
          rapport: 'R04',
          format: 'pdf',
          versionId: '42',
          codeVersion: 'BUDGET_2026_v1.0',
        }),
      }),
    );
  });

  // ─── XLSX — Content-Type + Content-Disposition + audit ────────

  it('downloadR04Xlsx : Content-Type spreadsheetml.sheet + attachment + audit', async () => {
    const res = mockResponse();
    await controller.downloadR04Xlsx('42', mockUser, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(
        /^attachment; filename="BUDGET_2026_v1\.0_R04_BCEAO_\d{8}\.xlsx"$/,
      ),
    );

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        typeAction: 'EXPORT_R04_XLSX',
        payloadApres: expect.objectContaining({
          format: 'xlsx',
          codeVersion: 'BUDGET_2026_v1.0',
        }),
      }),
    );
  });

  // ─── Pas d'audit en cas d'échec (404/409 levés par extractDonnees) ─

  it("n'écrit PAS d'audit si extractDonnees throw (404/409)", async () => {
    r04Service.extractDonnees.mockRejectedValueOnce(
      new Error('Version inexistante'),
    );
    const res = mockResponse();
    await expect(
      controller.downloadR04Pdf('999', mockUser, res),
    ).rejects.toThrow();
    expect(auditService.log).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });
});
