/**
 * Tests unitaires BordereauService (Lot 8.4 P1).
 *
 * 8 cas couvrent (cf. brief Lot 8.4) :
 *  1. R3 — document VISE avec 3 viseurs → PDF généré, Buffer non vide
 *  2. R3 — document SIGNE → PDF généré (post-signature)
 *  3. R3 — document BROUILLON → 409 Conflict
 *  4. R3 — document SOUMIS_VISA → 409 Conflict
 *  5. R3 — document inexistant → 404 NotFound
 *  6. R5 — document avec 1 visa REJETE → PDF généré
 *  7. R5 — document sans visa REJETE → 409 Conflict
 *  8. R5 — document inexistant → 404 NotFound
 *
 * Mock DataSource.query (queries SQL natives). PdfBuilderService réel
 * (génération pdfkit en mémoire — pas d'IO disque).
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';

import { PdfBuilderService } from '../generators/pdf-builder.service';
import { BordereauService } from '../services/bordereau.service';

const DOC_UUID = '11111111-1111-1111-1111-111111111111';

function mockDocRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: DOC_UUID,
    code_document: 'LETTRE_CADRAGE_2027',
    type_document: 'D2_LETTRE_CADRAGE',
    titre: 'Lettre de cadrage 2027',
    reference_externe: 'REF-EXT-001',
    statut: 'VISE',
    date_creation: new Date('2026-05-23T10:00:00Z').toISOString(),
    fk_campagne: 'camp-uuid-1',
    exercice_fiscal: 2027,
    emetteur_nom: 'MAMANE',
    emetteur_prenom: 'Ousmane',
    emetteur_email: 'finance@bsic.ne',
    ...over,
  };
}

function mockVisaRow(
  over: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    ordre_visa: 1,
    libelle_fonction: 'DGA Opérations',
    statut: 'VISE',
    date_action: new Date('2026-05-23T11:00:00Z').toISOString(),
    commentaire: 'OK',
    viseur_nom: 'OUSMANE',
    viseur_prenom: 'Halima',
    viseur_email: 'dga.ops@bsic.ne',
    ...over,
  };
}

describe('BordereauService (Lot 8.4 P1)', () => {
  let service: BordereauService;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        BordereauService,
        PdfBuilderService,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();
    service = moduleRef.get(BordereauService);
  });

  // ─── R3 — Bordereau de validation ────────────────────────────────

  it('1. R3 — document VISE avec 3 viseurs → PDF généré (Buffer non vide)', async () => {
    dataSource.query
      .mockResolvedValueOnce([mockDocRow({ statut: 'VISE' })])
      .mockResolvedValueOnce([
        mockVisaRow({ ordre_visa: 1, libelle_fonction: 'DGA Opérations' }),
        mockVisaRow({
          ordre_visa: 2,
          libelle_fonction: 'DGA Développement',
          viseur_prenom: 'Ibrahima',
          viseur_nom: 'MAHAMADOU',
        }),
        mockVisaRow({
          ordre_visa: 3,
          libelle_fonction: 'DG',
          viseur_prenom: 'Issoufou',
          viseur_nom: 'BARRY',
        }),
      ]);

    const buffer = await service.genererBordereauValidation(DOC_UUID);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    // Header PDF magique
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('2. R3 — document SIGNE → PDF généré (toujours accessible post-signature)', async () => {
    dataSource.query
      .mockResolvedValueOnce([mockDocRow({ statut: 'SIGNE' })])
      .mockResolvedValueOnce([mockVisaRow()]);
    const buffer = await service.genererBordereauValidation(DOC_UUID);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('3. R3 — document BROUILLON → 409 ConflictException', async () => {
    dataSource.query.mockResolvedValueOnce([
      mockDocRow({ statut: 'BROUILLON' }),
    ]);
    await expect(
      service.genererBordereauValidation(DOC_UUID),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('4. R3 — document SOUMIS_VISA → 409 ConflictException', async () => {
    dataSource.query.mockResolvedValueOnce([
      mockDocRow({ statut: 'SOUMIS_VISA' }),
    ]);
    await expect(
      service.genererBordereauValidation(DOC_UUID),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('5. R3 — document inexistant → 404 NotFoundException', async () => {
    dataSource.query.mockResolvedValueOnce([]); // fetch document vide
    await expect(
      service.genererBordereauValidation(DOC_UUID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ─── R5 — Bordereau de rejet ─────────────────────────────────────

  it('6. R5 — document avec 1 visa REJETE → PDF généré', async () => {
    dataSource.query
      .mockResolvedValueOnce([mockDocRow({ statut: 'BROUILLON' })])
      .mockResolvedValueOnce([
        mockVisaRow({
          statut: 'REJETE',
          commentaire: 'Données financières incomplètes',
        }),
      ]);
    const buffer = await service.genererBordereauRejet(DOC_UUID);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('7. R5 — document sans visa REJETE → 409 ConflictException', async () => {
    dataSource.query
      .mockResolvedValueOnce([mockDocRow({ statut: 'VISE' })])
      .mockResolvedValueOnce([]); // 0 visa REJETE
    await expect(
      service.genererBordereauRejet(DOC_UUID),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('8. R5 — document inexistant → 404 NotFoundException', async () => {
    dataSource.query.mockResolvedValueOnce([]); // fetch document vide
    await expect(
      service.genererBordereauRejet(DOC_UUID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
