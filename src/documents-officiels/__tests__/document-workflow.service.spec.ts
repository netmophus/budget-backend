/**
 * Tests unitaires DocumentWorkflowService (Lot 8.1.B Palier 3).
 *
 * Mock DataSource avec getRepository + transaction. Le helper
 * `mockTransaction` execute le callback avec un manager qui re-route
 * vers les mêmes repos (preserve l'état entre transaction et hors-tx).
 *
 * 12 cas couvrent les 7 méthodes du workflow.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';

import { AuditLog } from '../../audit/entities/audit-log.entity';
import { User } from '../../users/entities/user.entity';
import { CampagneBudgetaire } from '../entities/campagne-budgetaire.entity';
import { CampagneComiteMembre } from '../entities/campagne-comite-membre.entity';
import { DocumentOfficiel } from '../entities/document-officiel.entity';
import { DocumentSignature } from '../entities/document-signature.entity';
import { DocumentVisa } from '../entities/document-visa.entity';
import { DocumentHashService } from '../services/document-hash.service';
import {
  type ActorContext,
  DocumentWorkflowService,
} from '../services/document-workflow.service';

jest.mock('bcrypt');

// ─── Helpers de mock ─────────────────────────────────────────────────

function makeRepoMock(): Record<string, jest.Mock> {
  return {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockImplementation(async (e: unknown) => e),
    insert: jest
      .fn()
      .mockResolvedValue({ identifiers: [{ id: 'audit-id-42' }] }),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    createQueryBuilder: jest.fn(),
    create: jest.fn((dto: unknown) => dto),
  };
}

interface ReposMock {
  doc: ReturnType<typeof makeRepoMock>;
  visa: ReturnType<typeof makeRepoMock>;
  signature: ReturnType<typeof makeRepoMock>;
  campagne: ReturnType<typeof makeRepoMock>;
  comite: ReturnType<typeof makeRepoMock>;
  user: ReturnType<typeof makeRepoMock>;
  auditLog: ReturnType<typeof makeRepoMock>;
}

function makeDataSourceMock(repos: ReposMock): {
  dataSource: {
    getRepository: jest.Mock;
    transaction: jest.Mock;
    manager: { getRepository: jest.Mock };
  };
} {
  const getRepository = jest.fn((entity: unknown) => {
    if (entity === DocumentOfficiel) return repos.doc;
    if (entity === DocumentVisa) return repos.visa;
    if (entity === DocumentSignature) return repos.signature;
    if (entity === CampagneBudgetaire) return repos.campagne;
    if (entity === CampagneComiteMembre) return repos.comite;
    if (entity === User) return repos.user;
    if (entity === AuditLog) return repos.auditLog;
    throw new Error(`Unmocked entity: ${String(entity)}`);
  });
  const manager = { getRepository };
  const transaction = jest.fn(async (cb: (mgr: unknown) => unknown) =>
    cb(manager),
  );
  return { dataSource: { getRepository, transaction, manager } };
}

const actor: ActorContext = {
  userId: '23',
  userEmail: 'dg@bsic.ne',
  isAdmin: false,
  ipAddress: '127.0.0.1',
  userAgent: 'jest-test',
};

const mockDoc = (over: Partial<DocumentOfficiel> = {}): DocumentOfficiel =>
  ({
    id: 'doc-uuid-1',
    codeDocument: 'LETTRE_CADRAGE_2026',
    typeDocument: 'D2_LETTRE_CADRAGE',
    fkCampagne: 'camp-uuid-1',
    titre: 'Lettre cadrage 2026',
    contenuHtml: '<p>Contenu</p>',
    contenuJson: null,
    referenceExterne: null,
    statut: 'BROUILLON',
    fkUserEmetteur: '23',
    fkUserSignataire: '24',
    fkVersionBudget: null,
    dateCreation: new Date(),
    dateModification: null,
    dateSoumissionVisa: null,
    dateVisaComplet: null,
    dateSignature: null,
    dateArchivage: null,
    hashContenuSigne: null,
    fichierJointPath: null,
    fichierJointNom: null,
    utilisateurCreation: 'dg@bsic.ne',
    utilisateurModification: null,
    ...over,
  }) as DocumentOfficiel;

const mockCampagne = (
  over: Partial<CampagneBudgetaire> = {},
): CampagneBudgetaire =>
  ({
    id: 'camp-uuid-1',
    code: 'CAMPAGNE_2026',
    exerciceFiscal: 2026,
    libelle: 'Campagne 2026',
    statut: 'EN_COURS',
    modeVisaDefaut: 'PARALLELE',
    ...over,
  }) as CampagneBudgetaire;

const mockMembre = (
  over: Partial<CampagneComiteMembre> = {},
): CampagneComiteMembre =>
  ({
    id: 'membre-uuid-1',
    fkCampagne: 'camp-uuid-1',
    fkUser: '24',
    ordre: 1,
    estObligatoire: true,
    libelleFonction: null,
    ...over,
  }) as CampagneComiteMembre;

const mockVisa = (over: Partial<DocumentVisa> = {}): DocumentVisa =>
  ({
    id: 'visa-uuid-1',
    fkDocument: 'doc-uuid-1',
    fkUserViseur: '24',
    ordreVisa: 1,
    estObligatoire: true,
    statut: 'EN_ATTENTE',
    dateDemande: new Date(),
    dateAction: null,
    commentaire: null,
    libelleFonction: null,
    ...over,
  }) as DocumentVisa;

// ─── Setup partagé ──────────────────────────────────────────────────

describe('DocumentWorkflowService (Lot 8.1.B Palier 3)', () => {
  let service: DocumentWorkflowService;
  let repos: ReposMock;

  beforeEach(async () => {
    repos = {
      doc: makeRepoMock(),
      visa: makeRepoMock(),
      signature: makeRepoMock(),
      campagne: makeRepoMock(),
      comite: makeRepoMock(),
      user: makeRepoMock(),
      auditLog: makeRepoMock(),
    };
    const { dataSource } = makeDataSourceMock(repos);
    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentWorkflowService,
        DocumentHashService,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();
    service = moduleRef.get(DocumentWorkflowService);
  });

  // ─── creerDocument ──────────────────────────────────────────────

  it('creerDocument — happy path : statut BROUILLON + audit logué', async () => {
    repos.campagne.findOne.mockResolvedValue(mockCampagne());
    repos.doc.findOne.mockResolvedValue(null); // code libre
    repos.user.findOne.mockResolvedValue({ id: '24', email: 's@b.ne' } as User);
    repos.doc.save.mockImplementation(async (d: unknown) =>
      mockDoc({ ...(d as object) }),
    );

    const result = await service.creerDocument(
      {
        codeDocument: 'LETTRE_CADRAGE_2026',
        typeDocument: 'D2_LETTRE_CADRAGE',
        fkCampagne: 'camp-uuid-1',
        titre: 'Lettre',
        contenuHtml: '<p>X</p>',
        fkUserSignataire: '24',
      },
      actor,
    );

    expect(result.statut).toBe('BROUILLON');
    expect(repos.auditLog.insert).toHaveBeenCalledWith(
      expect.objectContaining({ typeAction: 'CREER_DOCUMENT' }),
    );
  });

  it('creerDocument — campagne pas EN_COURS → 409', async () => {
    repos.campagne.findOne.mockResolvedValue(
      mockCampagne({ statut: 'PARAMETRAGE' }),
    );
    await expect(
      service.creerDocument(
        {
          codeDocument: 'X',
          typeDocument: 'D2_LETTRE_CADRAGE',
          fkCampagne: 'camp-uuid-1',
          titre: 'T',
          contenuHtml: '<p>X</p>',
          fkUserSignataire: '24',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creerDocument — code déjà existant → 409', async () => {
    repos.campagne.findOne.mockResolvedValue(mockCampagne());
    repos.doc.findOne.mockResolvedValue(mockDoc()); // code déjà pris
    await expect(
      service.creerDocument(
        {
          codeDocument: 'LETTRE_CADRAGE_2026',
          typeDocument: 'D2_LETTRE_CADRAGE',
          fkCampagne: 'camp-uuid-1',
          titre: 'T',
          contenuHtml: '<p>X</p>',
          fkUserSignataire: '24',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // ─── editerDocument ─────────────────────────────────────────────

  it('editerDocument — happy path (émetteur)', async () => {
    repos.doc.findOne.mockResolvedValue(mockDoc()); // emetteur = '23' = actor
    repos.doc.save.mockImplementation(async (d: unknown) => d);
    const result = await service.editerDocument(
      'doc-uuid-1',
      { titre: 'Nouveau' },
      actor,
    );
    expect(result.titre).toBe('Nouveau');
    expect(repos.auditLog.insert).toHaveBeenCalledWith(
      expect.objectContaining({ typeAction: 'EDITER_DOCUMENT' }),
    );
  });

  it('editerDocument — non-émetteur sans isAdmin → 403', async () => {
    repos.doc.findOne.mockResolvedValue(mockDoc({ fkUserEmetteur: '99' }));
    await expect(
      service.editerDocument('doc-uuid-1', { titre: 'X' }, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('editerDocument — statut SIGNE → 409', async () => {
    repos.doc.findOne.mockResolvedValue(mockDoc({ statut: 'SIGNE' }));
    await expect(
      service.editerDocument('doc-uuid-1', { titre: 'X' }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // ─── soumettreVisa ──────────────────────────────────────────────

  it('soumettreVisa — happy path : transition + N visas créés', async () => {
    repos.doc.findOne.mockResolvedValue(mockDoc()); // BROUILLON, emetteur
    repos.campagne.findOne.mockResolvedValue(mockCampagne()); // EN_COURS
    repos.comite.find.mockResolvedValue([
      mockMembre({ fkUser: '24', ordre: 1 }),
      mockMembre({ fkUser: '25', ordre: 2 }),
    ]);
    repos.doc.save.mockImplementation(async (d: unknown) => d);

    const result = await service.soumettreVisa('doc-uuid-1', {}, actor);

    expect(result.statut).toBe('SOUMIS_VISA');
    expect(repos.visa.insert).toHaveBeenCalledTimes(2);
    expect(repos.auditLog.insert).toHaveBeenCalledWith(
      expect.objectContaining({ typeAction: 'SOUMETTRE_DOCUMENT_VISA' }),
    );
  });

  it('soumettreVisa — campagne sans comité → 409', async () => {
    repos.doc.findOne.mockResolvedValue(mockDoc());
    repos.campagne.findOne.mockResolvedValue(mockCampagne());
    repos.comite.find.mockResolvedValue([]); // comité vide

    await expect(
      service.soumettreVisa('doc-uuid-1', {}, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // ─── apporterVisa ───────────────────────────────────────────────

  it('apporterVisa — VISER + tous obligatoires visés → document VISE auto', async () => {
    const viseur: ActorContext = { ...actor, userId: '24' };
    repos.doc.findOne.mockResolvedValue(mockDoc({ statut: 'SOUMIS_VISA' }));
    const monVisa = mockVisa({ fkUserViseur: '24', ordreVisa: 1 });
    // 1er find : visas avant action (pour trouver monVisa + check séquentiel)
    // 2eme find (dans transaction) : visas après pour check complétion
    repos.visa.find
      .mockResolvedValueOnce([monVisa])
      .mockResolvedValueOnce([{ ...monVisa, statut: 'VISE' } as DocumentVisa]);
    repos.campagne.findOne.mockResolvedValue(mockCampagne()); // PARALLELE
    repos.visa.save.mockImplementation(async (v: unknown) => v);
    repos.doc.save.mockImplementation(async (d: unknown) => d);

    const result = await service.apporterVisa(
      'doc-uuid-1',
      { action: 'VISER' },
      viseur,
    );

    expect(result.statut).toBe('VISE');
    expect(repos.auditLog.insert).toHaveBeenCalledWith(
      expect.objectContaining({ typeAction: 'VISER_DOCUMENT' }),
    );
  });

  it('apporterVisa — REJETER sans commentaire → 400', async () => {
    await expect(
      service.apporterVisa(
        'doc-uuid-1',
        { action: 'REJETER', commentaire: '   ' },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('apporterVisa — user pas dans comité → 403', async () => {
    repos.doc.findOne.mockResolvedValue(mockDoc({ statut: 'SOUMIS_VISA' }));
    repos.visa.find.mockResolvedValue([
      mockVisa({ fkUserViseur: '99' }), // autre user, pas actor=23
    ]);
    await expect(
      service.apporterVisa('doc-uuid-1', { action: 'VISER' }, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ─── signerDocument ─────────────────────────────────────────────

  it('signerDocument — mot de passe invalide → 401', async () => {
    repos.user.findOne.mockResolvedValue({
      id: '23',
      email: 'dg@bsic.ne',
      motDePasseHash: 'hash-attendu',
    } as User);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      service.signerDocument('doc-uuid-1', { motDePasse: 'mauvais' }, actor),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repos.signature.insert).not.toHaveBeenCalled();
  });

  // ─── Bonus : verifierIntegrite ──────────────────────────────────

  it('verifierIntegrite — pas de signature → signaturePresente=false', async () => {
    repos.doc.findOne.mockResolvedValue(mockDoc());
    repos.signature.findOne.mockResolvedValue(null);
    repos.visa.find.mockResolvedValue([]);

    const result = await service.verifierIntegrite('doc-uuid-1');
    expect(result.signaturePresente).toBe(false);
    expect(result.contenuIntact).toBe(false);
  });

  it('verifierIntegrite — signature OK + contenu intact → contenuIntact=true', async () => {
    const doc = mockDoc({ statut: 'SIGNE', contenuHtml: '<p>Original</p>' });
    repos.doc.findOne.mockResolvedValue(doc);
    repos.visa.find.mockResolvedValue([]);
    // Hash recalculable : on doit fournir le hash actuel comme valeur
    // stockée pour que le test passe.
    const hashService = new DocumentHashService();
    const hashAttendu = hashService.hashContenu(doc.contenuHtml);
    const hashVisasAttendu = hashService.hashVisas([]);
    repos.signature.findOne.mockResolvedValue({
      hashContenu: hashAttendu,
      hashVisas: hashVisasAttendu,
      dateSignature: new Date(),
      emailSignataire: 'dg@bsic.ne',
      nomSignataire: 'Issoufou BARRY',
    } as DocumentSignature);

    const result = await service.verifierIntegrite('doc-uuid-1');
    expect(result.signaturePresente).toBe(true);
    expect(result.contenuIntact).toBe(true);
    expect(result.visasIntacts).toBe(true);
  });
});
