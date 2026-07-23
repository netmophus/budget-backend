/**
 * Tests unitaires DocumentFichierService (Lot 8.1.D — stockage EN BASE).
 *
 * Le PDF est stocké dans `document_officiel.fichier_contenu` (bytea),
 * plus sur disque. On mocke le DataSource (repositories + query brute)
 * — aucun accès disque. 7 cas : upload happy / SIGNE / non-émetteur /
 * non-PDF / remplacement + téléchargement happy / contenu legacy absent.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Readable } from 'stream';

import {
  DocumentFichierService,
  type UploadedPdfFile,
} from '../services/document-fichier.service';

interface FakeDoc {
  id: string;
  codeDocument: string;
  fkCampagne: string | null;
  fkUserEmetteur: string;
  fkUserSignataire: string;
  statut: 'BROUILLON' | 'SOUMIS_VISA' | 'VISE' | 'SIGNE' | 'ARCHIVE';
  fichierJointNom: string | null;
  fichierMime: string | null;
}

function makeDoc(over: Partial<FakeDoc> = {}): FakeDoc {
  return {
    id: 'doc-uuid-1',
    codeDocument: 'LETTRE_CADRAGE_2026',
    fkCampagne: 'camp-uuid-1',
    fkUserEmetteur: '23',
    fkUserSignataire: '24',
    statut: 'BROUILLON',
    fichierJointNom: null,
    fichierMime: null,
    ...over,
  };
}

function makePdfBuffer(content = 'fake pdf body'): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(content)]);
}

function makeFile(over: Partial<UploadedPdfFile> = {}): UploadedPdfFile {
  const buffer = makePdfBuffer();
  return {
    originalname: 'lettre.pdf',
    mimetype: 'application/pdf',
    buffer,
    size: buffer.length,
    ...over,
  };
}

describe('DocumentFichierService (Lot 8.1.D — stockage base)', () => {
  let service: DocumentFichierService;
  let docRepo: { findOne: jest.Mock; save: jest.Mock };
  let visaRepo: { find: jest.Mock };
  let auditLogRepo: { insert: jest.Mock };
  let dataSource: { getRepository: jest.Mock; query: jest.Mock };

  // Contenu renvoyé par la requête ciblée du blob (surchargé par test).
  let blobRow: { fichier_contenu: Buffer | null };

  beforeEach(async () => {
    docRepo = { findOne: jest.fn(), save: jest.fn() };
    visaRepo = { find: jest.fn().mockResolvedValue([]) };
    auditLogRepo = { insert: jest.fn().mockResolvedValue({ identifiers: [] }) };
    blobRow = { fichier_contenu: makePdfBuffer() };

    dataSource = {
      // Route selon la requête : lookup user (RBAC) vs SELECT du blob.
      query: jest.fn((sql: string) => {
        if (sql.includes('FROM "user"')) {
          return Promise.resolve([{ id: '23' }]);
        }
        if (sql.includes('fichier_contenu')) {
          return Promise.resolve([blobRow]);
        }
        return Promise.resolve([]);
      }),
      getRepository: jest.fn((entity: { name: string }) => {
        switch (entity.name) {
          case 'DocumentOfficiel':
            return docRepo;
          case 'DocumentVisa':
            return visaRepo;
          case 'AuditLog':
            return auditLogRepo;
          default:
            throw new Error(`Unmocked entity: ${entity.name}`);
        }
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentFichierService,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();
    service = moduleRef.get(DocumentFichierService);
  });

  // ─── uploadFichier ─────────────────────────────────────────────

  it('1. upload happy path : UPDATE (bytea + taille + mime + nom) + audit', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc());
    docRepo.save.mockImplementation(async (d: unknown) => d);
    const result = await service.uploadFichier(
      'doc-uuid-1',
      makeFile(),
      'finance@bru.ne',
    );
    expect(docRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        fichierContenu: expect.any(Buffer),
        fichierMime: 'application/pdf',
        fichierJointNom: 'lettre.pdf',
        fichierTaille: expect.any(Number),
      }),
    );
    expect(auditLogRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        typeAction: 'EDITER_DOCUMENT',
        payloadApres: expect.objectContaining({ action: 'UPLOAD_FICHIER' }),
      }),
    );
    expect(result.fichierNom).toBe('lettre.pdf');
  });

  it('2. statut SIGNE → 409 ConflictException', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc({ statut: 'SIGNE' }));
    await expect(
      service.uploadFichier('doc-uuid-1', makeFile(), 'finance@bru.ne'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(docRepo.save).not.toHaveBeenCalled();
  });

  it('3. non-émetteur → 403 ForbiddenException', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc({ fkUserEmetteur: '99' }));
    // dataSource.query retourne id=23 pour finance@bru.ne → pas '99'
    await expect(
      service.uploadFichier('doc-uuid-1', makeFile(), 'finance@bru.ne'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(docRepo.save).not.toHaveBeenCalled();
  });

  it('4. fichier non-PDF (magic bytes) → 400 BadRequestException', async () => {
    const fake = makeFile({
      buffer: Buffer.from('PK\x03\x04 ZIP not PDF', 'utf-8'),
      size: 20,
    });
    docRepo.findOne.mockResolvedValue(makeDoc());
    await expect(
      service.uploadFichier('doc-uuid-1', fake, 'finance@bru.ne'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(docRepo.save).not.toHaveBeenCalled();
  });

  it('5. remplacement (fichier déjà présent) → audit REMPLACER_FICHIER', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({
        fichierJointNom: 'ancien.pdf',
        fichierMime: 'application/pdf',
      }),
    );
    docRepo.save.mockImplementation(async (d: unknown) => d);
    await service.uploadFichier('doc-uuid-1', makeFile(), 'finance@bru.ne');
    expect(auditLogRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadApres: expect.objectContaining({ action: 'REMPLACER_FICHIER' }),
      }),
    );
  });

  // ─── telechargerFichier ───────────────────────────────────────

  it('6. telechargerFichier happy : Readable + nom + mimeType', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({
        fichierJointNom: 'lettre-cadrage-2026.pdf',
        fichierMime: 'application/pdf',
      }),
    );
    const result = await service.telechargerFichier(
      'doc-uuid-1',
      'finance@bru.ne',
    );
    expect(result.stream).toBeInstanceOf(Readable);
    expect(result.fichierNom).toBe('lettre-cadrage-2026.pdf');
    expect(result.mimeType).toBe('application/pdf');
  });

  it('7. contenu absent (ligne legacy disque non migrée) → 404 NotFound', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({
        fichierJointNom: 'orphelin.pdf',
        fichierMime: 'application/pdf',
      }),
    );
    blobRow = { fichier_contenu: null }; // le SELECT du blob renvoie NULL
    await expect(
      service.telechargerFichier('doc-uuid-1', 'finance@bru.ne'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
