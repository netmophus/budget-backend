/**
 * Tests unitaires PvApprobationService (Lot 8.3.D P1).
 *
 * Pattern strictement aligné `note-preparatoire.service.spec.ts`
 * (Lot 8.3.C) — seul `typeDocument` change (D11_PV_APPROBATION).
 * Mocks DataSource + repos. Pas de pg-mem.
 *
 * 8 cas couvrent :
 *  1. lireDetail — happy path : retourne l'entité
 *  2. lireDetail — pas de détail → retourne null
 *  3. creerOuMettreAJour — INSERT premier appel (utilisateurCreation)
 *  4. creerOuMettreAJour — UPDATE deuxième appel (utilisateurModification)
 *  5. creerOuMettreAJour — type ≠ D11_PV_APPROBATION → 409
 *  6. creerOuMettreAJour — statut document ≠ BROUILLON → 409
 *  7. creerOuMettreAJour — user ≠ émetteur → 403
 *  8. creerOuMettreAJour — document introuvable → 404
 */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';

import { CreerOuMettreAJourPvApprobationDetailDto } from '../dto/pv-approbation-detail.dto';
import { PvApprobationService } from '../services/pv-approbation.service';

interface FakeDoc {
  id: string;
  typeDocument: string;
  statut: string;
  fkUserEmetteur: string;
}

function makeDoc(over: Partial<FakeDoc> = {}): FakeDoc {
  return {
    id: 'doc-uuid-1',
    typeDocument: 'D11_PV_APPROBATION',
    statut: 'BROUILLON',
    fkUserEmetteur: '23',
    ...over,
  };
}

const dtoMinimal: CreerOuMettreAJourPvApprobationDetailDto = {
  numeroResolution: 'CA-BSIC-2027-007',
  dateSeanceCa: '2027-12-18',
  lieuSeance: 'Salle CA — Siège BSIC NIGER',
  nbAdministrateursPresents: 8,
  nbAdministrateursTotal: 10,
  quorumAtteint: true,
  voteResultat: 'UNANIMITE',
};

describe('PvApprobationService (Lot 8.3.D P1)', () => {
  let service: PvApprobationService;
  let docRepo: { findOne: jest.Mock };
  let padRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let dataSource: {
    getRepository: jest.Mock;
    query: jest.Mock;
  };

  beforeEach(async () => {
    docRepo = { findOne: jest.fn() };
    padRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto: unknown) => dto),
      save: jest.fn().mockImplementation(async (d: unknown) => d),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([{ id: '23' }]), // lookupUserIdByEmail
      getRepository: jest.fn((entity: { name: string }) => {
        switch (entity.name) {
          case 'DocumentOfficiel':
            return docRepo;
          case 'PvApprobationDetail':
            return padRepo;
          default:
            throw new Error(`Unmocked entity: ${entity.name}`);
        }
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PvApprobationService,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();
    service = moduleRef.get(PvApprobationService);
  });

  // ─── lireDetail ────────────────────────────────────────────────

  it("1. lireDetail — happy path : retourne l'entité existante", async () => {
    const fake = { id: 'pad-1', fkDocument: 'doc-uuid-1' };
    padRepo.findOne.mockResolvedValue(fake);
    const result = await service.lireDetail('doc-uuid-1');
    expect(result).toBe(fake);
    expect(padRepo.findOne).toHaveBeenCalledWith({
      where: { fkDocument: 'doc-uuid-1' },
    });
  });

  it('2. lireDetail — pas de détail → retourne null', async () => {
    padRepo.findOne.mockResolvedValue(null);
    const result = await service.lireDetail('doc-uuid-1');
    expect(result).toBeNull();
  });

  // ─── creerOuMettreAJour : happy paths INSERT + UPDATE ─────────

  it('3. creerOuMettreAJour — INSERT premier appel (utilisateurCreation rempli)', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc()); // émetteur = '23'
    padRepo.findOne.mockResolvedValue(null); // pas de détail existant

    const result = await service.creerOuMettreAJour(
      'doc-uuid-1',
      dtoMinimal,
      'dg@bsic.ne',
    );

    expect(padRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fkDocument: 'doc-uuid-1',
        utilisateurCreation: 'dg@bsic.ne',
        numeroResolution: 'CA-BSIC-2027-007',
        nbAdministrateursPresents: 8,
        nbAdministrateursTotal: 10,
        quorumAtteint: true,
        voteResultat: 'UNANIMITE',
      }),
    );
    expect(padRepo.save).toHaveBeenCalled();
    expect(
      (result as { utilisateurCreation: string }).utilisateurCreation,
    ).toBe('dg@bsic.ne');
  });

  it('4. creerOuMettreAJour — UPDATE deuxième appel (audit préservé)', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc());
    const existant = {
      id: 'pad-1',
      fkDocument: 'doc-uuid-1',
      numeroResolution: 'ANCIEN',
      utilisateurCreation: 'dg@bsic.ne',
      utilisateurModification: null,
    };
    padRepo.findOne.mockResolvedValue(existant);

    const result = await service.creerOuMettreAJour(
      'doc-uuid-1',
      { numeroResolution: 'NOUVEAU' },
      'dg@bsic.ne',
    );

    // create N'EST PAS appelé (UPDATE, pas INSERT)
    expect(padRepo.create).not.toHaveBeenCalled();
    expect(padRepo.save).toHaveBeenCalled();
    // L'entité a été mutée puis sauvegardée — audit préservé
    expect(existant.numeroResolution).toBe('NOUVEAU');
    expect(existant.utilisateurModification).toBe('dg@bsic.ne');
    // utilisateurCreation conservé tel quel (pas écrasé)
    expect(existant.utilisateurCreation).toBe('dg@bsic.ne');
    expect(result).toBe(existant);
  });

  // ─── Erreurs métier ────────────────────────────────────────────

  it('5. creerOuMettreAJour — type document ≠ D11_PV_APPROBATION → 409', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({ typeDocument: 'D3_NOTE_ORIENTATION' }),
    );
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(padRepo.save).not.toHaveBeenCalled();
  });

  it('6. creerOuMettreAJour — statut document ≠ BROUILLON → 409', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc({ statut: 'SIGNE' }));
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(padRepo.save).not.toHaveBeenCalled();
  });

  it('7. creerOuMettreAJour — user ≠ émetteur → 403', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({ fkUserEmetteur: '99' }), // émetteur ≠ id '23' du mock dataSource.query
    );
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(padRepo.save).not.toHaveBeenCalled();
  });

  it('8. creerOuMettreAJour — document introuvable → 404', async () => {
    docRepo.findOne.mockResolvedValue(null);
    await expect(
      service.creerOuMettreAJour(
        'doc-uuid-inexistante',
        dtoMinimal,
        'dg@bsic.ne',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(padRepo.save).not.toHaveBeenCalled();
  });
});
