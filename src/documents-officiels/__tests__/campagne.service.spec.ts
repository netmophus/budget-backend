/**
 * Tests unitaires CampagneService (Lot 8.1.B).
 *
 * Mocks legers via Test.createTestingModule + getRepositoryToken
 * (pattern projet, cf. budget/services/versions-resume.service.spec.ts).
 * Pas de pg-mem — les 3 méthodes sont des CRUD simples.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import type { Repository, SelectQueryBuilder } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { User } from '../../users/entities/user.entity';
import type { CreerCampagneDto } from '../dto/creer-campagne.dto';
import { CampagneBudgetaire } from '../entities/campagne-budgetaire.entity';
import { CampagneComiteMembre } from '../entities/campagne-comite-membre.entity';
import { CampagneService } from '../services/campagne.service';

const mockUser = {
  id: '23',
  email: 'dg@bsic.ne',
  nom: 'BARRY',
  prenom: 'Issoufou',
} as User;

const mockCampagne = (
  over: Partial<CampagneBudgetaire> = {},
): CampagneBudgetaire =>
  ({
    id: 'camp-uuid-1',
    code: 'CAMPAGNE_2027',
    exerciceFiscal: 2027,
    libelle: 'Campagne 2027',
    statut: 'PARAMETRAGE',
    modeVisaDefaut: 'PARALLELE',
    fkUserSignataireDefaut: '23',
    utilisateurCreation: 'dg@bsic.ne',
    dateCreation: new Date(),
    dateLancement: null,
    dateFin: null,
    utilisateurModification: null,
    dateModification: null,
    ...over,
  }) as CampagneBudgetaire;

const dtoCreer: CreerCampagneDto = {
  code: 'CAMPAGNE_2027',
  exerciceFiscal: 2027,
  libelle: 'Campagne 2027',
  fkUserSignataireDefaut: '23',
};

describe('CampagneService (Lot 8.1.B)', () => {
  let service: CampagneService;
  let campagneRepo: jest.Mocked<Repository<CampagneBudgetaire>>;
  let comiteRepo: jest.Mocked<Repository<CampagneComiteMembre>>;
  let userRepo: jest.Mocked<Repository<User>>;
  let auditService: { log: jest.Mock };

  beforeEach(async () => {
    const repoMock = (): Record<string, jest.Mock> => ({
      findOne: jest.fn(),
      create: jest.fn((dto: unknown) => dto),
      save: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    });
    const campagneRepoMock = repoMock();
    const comiteRepoMock = repoMock();
    const userRepoMock = repoMock();
    auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CampagneService,
        {
          provide: getRepositoryToken(CampagneBudgetaire),
          useValue: campagneRepoMock,
        },
        {
          provide: getRepositoryToken(CampagneComiteMembre),
          useValue: comiteRepoMock,
        },
        { provide: getRepositoryToken(User), useValue: userRepoMock },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = moduleRef.get(CampagneService);
    campagneRepo = campagneRepoMock as unknown as jest.Mocked<
      Repository<CampagneBudgetaire>
    >;
    comiteRepo = comiteRepoMock as unknown as jest.Mocked<
      Repository<CampagneComiteMembre>
    >;
    userRepo = userRepoMock as unknown as jest.Mocked<Repository<User>>;
  });

  // ─── creerCampagne ──────────────────────────────────────────────

  it('creerCampagne — happy path : crée en PARAMETRAGE + audit logué', async () => {
    userRepo.findOne.mockResolvedValue(mockUser);
    campagneRepo.findOne.mockResolvedValue(null); // exercice libre
    campagneRepo.save.mockImplementation(async (c) =>
      mockCampagne({ ...(c as object) }),
    );

    const result = await service.creerCampagne(dtoCreer, 'dg@bsic.ne');

    expect(result.statut).toBe('PARAMETRAGE');
    expect(result.code).toBe('CAMPAGNE_2027');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        utilisateur: 'dg@bsic.ne',
        typeAction: 'CREER_DOCUMENT',
        entiteCible: 'campagne_budgetaire',
        statut: 'success',
      }),
    );
  });

  it('creerCampagne — exercice déjà existant → 409', async () => {
    userRepo.findOne.mockResolvedValue(mockUser);
    campagneRepo.findOne.mockResolvedValue(mockCampagne()); // exercice pris

    await expect(
      service.creerCampagne(dtoCreer, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(auditService.log).not.toHaveBeenCalled();
  });

  // ─── ajouterMembreComite ────────────────────────────────────────

  it('ajouterMembreComite — happy path : ordre auto = MAX(ordre) + 1', async () => {
    campagneRepo.findOne.mockResolvedValue(mockCampagne()); // PARAMETRAGE
    comiteRepo.findOne.mockResolvedValue(null); // pas déjà membre
    // Simule MAX(ordre) = 1 → nouveau membre à 2
    const qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ maxOrdre: '1' }),
    } as unknown as SelectQueryBuilder<CampagneComiteMembre>;
    comiteRepo.createQueryBuilder.mockReturnValue(qb);
    comiteRepo.save.mockImplementation(async (m) => m as CampagneComiteMembre);

    const result = await service.ajouterMembreComite(
      'camp-uuid-1',
      { fkUser: '24', libelleFonction: 'DGA Ops' },
      'dg@bsic.ne',
    );

    expect(result.ordre).toBe(2);
    expect(result.fkUser).toBe('24');
    expect(result.estObligatoire).toBe(true); // défaut
  });

  it('ajouterMembreComite — campagne en EN_COURS → 409', async () => {
    campagneRepo.findOne.mockResolvedValue(
      mockCampagne({ statut: 'EN_COURS' }),
    );

    await expect(
      service.ajouterMembreComite(
        'camp-uuid-1',
        { fkUser: '24' },
        'dg@bsic.ne',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // ─── lancerCampagne ─────────────────────────────────────────────

  it('lancerCampagne — comité sans membre obligatoire → 409', async () => {
    campagneRepo.findOne.mockResolvedValue(mockCampagne()); // PARAMETRAGE
    comiteRepo.count.mockResolvedValue(0); // aucun membre obligatoire

    await expect(
      service.lancerCampagne('camp-uuid-1', 'dg@bsic.ne'),
    ).rejects.toThrow(/aucun membre Comité obligatoire/);
  });

  // ─── Sanity check NotFound ──────────────────────────────────────

  it('creerCampagne — signataire introuvable → 404', async () => {
    userRepo.findOne.mockResolvedValue(null);
    await expect(
      service.creerCampagne(dtoCreer, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
