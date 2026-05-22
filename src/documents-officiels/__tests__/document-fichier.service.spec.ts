/**
 * Tests unitaires DocumentFichierService (Lot 8.1.D).
 *
 * Mocks fs/promises + DataSource pour ne pas toucher au vrai disque.
 * 6 cas couvrent : upload happy/SIGNE/non-emetteur/non-PDF/remplacement
 * + telechargement happy.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';

import {
  DocumentFichierService,
  type UploadedPdfFile,
} from '../services/document-fichier.service';

// Mock fs/promises + fs.createReadStream. **CRITIQUE** : on préserve
// `jest.requireActual('fs')` pour ne pas casser TypeORM interne qui
// utilise `fs.realpath.native` via path-scurry/glob → crash module load
// si on remplace tout l'export `fs`.
const mockWriteFile = jest.fn().mockResolvedValue(undefined);
const mockUnlink = jest.fn().mockResolvedValue(undefined);
const mockMkdir = jest.fn().mockResolvedValue(undefined);
jest.mock('fs/promises', () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));
const mockCreateReadStream = jest.fn();
jest.mock('fs', () => ({
  ...(jest.requireActual('fs') as object),
  createReadStream: (...args: unknown[]) => mockCreateReadStream(...args),
}));

interface FakeDoc {
  id: string;
  codeDocument: string;
  fkCampagne: string | null;
  fkUserEmetteur: string;
  fkUserSignataire: string;
  statut: 'BROUILLON' | 'SOUMIS_VISA' | 'VISE' | 'SIGNE' | 'ARCHIVE';
  fichierJointPath: string | null;
  fichierJointNom: string | null;
}

function makeDoc(over: Partial<FakeDoc> = {}): FakeDoc {
  return {
    id: 'doc-uuid-1',
    codeDocument: 'LETTRE_CADRAGE_2026',
    fkCampagne: 'camp-uuid-1',
    fkUserEmetteur: '23',
    fkUserSignataire: '24',
    statut: 'BROUILLON',
    fichierJointPath: null,
    fichierJointNom: null,
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

describe('DocumentFichierService (Lot 8.1.D)', () => {
  let service: DocumentFichierService;
  let docRepo: { findOne: jest.Mock; save: jest.Mock };
  let visaRepo: { find: jest.Mock };
  let campagneRepo: { findOne: jest.Mock };
  let auditLogRepo: { insert: jest.Mock };
  let dataSource: { getRepository: jest.Mock; query: jest.Mock };

  beforeEach(async () => {
    mockWriteFile.mockClear();
    mockUnlink.mockClear();
    mockMkdir.mockClear();
    mockCreateReadStream.mockReset();

    docRepo = { findOne: jest.fn(), save: jest.fn() };
    visaRepo = { find: jest.fn().mockResolvedValue([]) };
    campagneRepo = {
      findOne: jest.fn().mockResolvedValue({ exerciceFiscal: 2026 }),
    };
    auditLogRepo = { insert: jest.fn().mockResolvedValue({ identifiers: [] }) };

    dataSource = {
      query: jest.fn().mockResolvedValue([{ id: '23' }]), // lookupUserIdByEmail
      getRepository: jest.fn((entity: { name: string }) => {
        switch (entity.name) {
          case 'DocumentOfficiel':
            return docRepo;
          case 'DocumentVisa':
            return visaRepo;
          case 'CampagneBudgetaire':
            return campagneRepo;
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
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('./uploads/documents') },
        },
      ],
    }).compile();
    service = moduleRef.get(DocumentFichierService);
  });

  // ─── uploadFichier ─────────────────────────────────────────────

  it('1. upload happy path : mkdir + writeFile + UPDATE + audit', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc());
    docRepo.save.mockImplementation(async (d: unknown) => d);
    const result = await service.uploadFichier(
      'doc-uuid-1',
      makeFile(),
      'finance@bsic.ne',
    );
    expect(mockMkdir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalled();
    expect(docRepo.save).toHaveBeenCalled();
    expect(auditLogRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        typeAction: 'EDITER_DOCUMENT',
      }),
    );
    expect(result.fichierNom).toBe('lettre.pdf');
  });

  it('2. statut SIGNE → 409 ConflictException', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc({ statut: 'SIGNE' }));
    await expect(
      service.uploadFichier('doc-uuid-1', makeFile(), 'finance@bsic.ne'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('3. non-émetteur → 403 ForbiddenException', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc({ fkUserEmetteur: '99' }));
    // dataSource.query retourne id=23 pour finance@bsic.ne → pas '99'
    await expect(
      service.uploadFichier('doc-uuid-1', makeFile(), 'finance@bsic.ne'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('4. fichier non-PDF (magic bytes) → 400 BadRequestException', async () => {
    const fake = makeFile({
      buffer: Buffer.from('PK\x03\x04 ZIP not PDF', 'utf-8'),
      size: 20,
    });
    docRepo.findOne.mockResolvedValue(makeDoc());
    await expect(
      service.uploadFichier('doc-uuid-1', fake, 'finance@bsic.ne'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('5. remplacement : unlink ancien fichier AVANT writeFile nouveau', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({
        fichierJointPath: '2026/ANCIEN.pdf',
        fichierJointNom: 'a.pdf',
      }),
    );
    docRepo.save.mockImplementation(async (d: unknown) => d);
    await service.uploadFichier('doc-uuid-1', makeFile(), 'finance@bsic.ne');
    expect(mockUnlink).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalled();
    // Vérifie l'ordre : unlink avant writeFile
    const unlinkOrder = mockUnlink.mock.invocationCallOrder[0];
    const writeOrder = mockWriteFile.mock.invocationCallOrder[0];
    expect(unlinkOrder).toBeLessThan(writeOrder);
  });

  // ─── telechargerFichier ───────────────────────────────────────

  it('6. telechargerFichier happy path : stream + nom + mimeType', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({
        fichierJointPath: '2026/LETTRE_CADRAGE_2026.pdf',
        fichierJointNom: 'lettre-cadrage-2026.pdf',
      }),
    );
    const fakeStream = { pipe: jest.fn() };
    mockCreateReadStream.mockReturnValue(fakeStream);
    const result = await service.telechargerFichier(
      'doc-uuid-1',
      'finance@bsic.ne',
    );
    expect(result.fichierNom).toBe('lettre-cadrage-2026.pdf');
    expect(result.mimeType).toBe('application/pdf');
    expect(mockCreateReadStream).toHaveBeenCalled();
  });
});
