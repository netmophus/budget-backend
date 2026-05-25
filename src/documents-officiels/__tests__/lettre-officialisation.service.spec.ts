/**
 * Tests unitaires LettreOfficialisationService (Lot 8.3.E P1).
 *
 * Pattern strictement aligné `pv-approbation.service.spec.ts`
 * (Lot 8.3.D) — seul `typeDocument` change (D12_LETTRE_OFFICIALISATION).
 * Mocks DataSource + repos. Pas de pg-mem.
 *
 * 8 cas couvrent :
 *  1. lireDetail — happy path : retourne l'entité
 *  2. lireDetail — pas de détail → retourne null
 *  3. creerOuMettreAJour — INSERT premier appel (utilisateurCreation)
 *  4. creerOuMettreAJour — UPDATE deuxième appel (utilisateurModification)
 *  5. creerOuMettreAJour — type ≠ D12_LETTRE_OFFICIALISATION → 409
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

import { CreerOuMettreAJourLettreOfficialisationDetailDto } from '../dto/lettre-officialisation-detail.dto';
import { LettreOfficialisationService } from '../services/lettre-officialisation.service';

interface FakeDoc {
  id: string;
  typeDocument: string;
  statut: string;
  fkUserEmetteur: string;
}

function makeDoc(over: Partial<FakeDoc> = {}): FakeDoc {
  return {
    id: 'doc-uuid-1',
    typeDocument: 'D12_LETTRE_OFFICIALISATION',
    statut: 'BROUILLON',
    fkUserEmetteur: '23',
    ...over,
  };
}

const dtoMinimal: CreerOuMettreAJourLettreOfficialisationDetailDto = {
  numeroLettre: 'LOFF-BSIC-2027-001',
  dateEmission: '2027-12-22',
  objet: 'Officialisation du budget 2028 approuvé par le CA',
  referencePvCa: 'CA-BSIC-2027-007',
  signataire: 'M. Issoufou BARRY (Directeur Général)',
  dateEntreeVigueur: '2028-01-01',
  cachetAppose: true,
};

describe('LettreOfficialisationService (Lot 8.3.E P1)', () => {
  let service: LettreOfficialisationService;
  let docRepo: { findOne: jest.Mock };
  let lodRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let dataSource: {
    getRepository: jest.Mock;
    query: jest.Mock;
  };

  beforeEach(async () => {
    docRepo = { findOne: jest.fn() };
    lodRepo = {
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
          case 'LettreOfficialisationDetail':
            return lodRepo;
          default:
            throw new Error(`Unmocked entity: ${entity.name}`);
        }
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LettreOfficialisationService,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();
    service = moduleRef.get(LettreOfficialisationService);
  });

  // ─── lireDetail ────────────────────────────────────────────────

  it("1. lireDetail — happy path : retourne l'entité existante", async () => {
    const fake = { id: 'lod-1', fkDocument: 'doc-uuid-1' };
    lodRepo.findOne.mockResolvedValue(fake);
    const result = await service.lireDetail('doc-uuid-1');
    expect(result).toBe(fake);
    expect(lodRepo.findOne).toHaveBeenCalledWith({
      where: { fkDocument: 'doc-uuid-1' },
    });
  });

  it('2. lireDetail — pas de détail → retourne null', async () => {
    lodRepo.findOne.mockResolvedValue(null);
    const result = await service.lireDetail('doc-uuid-1');
    expect(result).toBeNull();
  });

  // ─── creerOuMettreAJour : happy paths INSERT + UPDATE ─────────

  it('3. creerOuMettreAJour — INSERT premier appel (utilisateurCreation rempli)', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc()); // émetteur = '23'
    lodRepo.findOne.mockResolvedValue(null); // pas de détail existant

    const result = await service.creerOuMettreAJour(
      'doc-uuid-1',
      dtoMinimal,
      'dg@bsic.ne',
    );

    expect(lodRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fkDocument: 'doc-uuid-1',
        utilisateurCreation: 'dg@bsic.ne',
        numeroLettre: 'LOFF-BSIC-2027-001',
        referencePvCa: 'CA-BSIC-2027-007',
        cachetAppose: true,
      }),
    );
    expect(lodRepo.save).toHaveBeenCalled();
    expect(
      (result as { utilisateurCreation: string }).utilisateurCreation,
    ).toBe('dg@bsic.ne');
  });

  it('4. creerOuMettreAJour — UPDATE deuxième appel (audit préservé)', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc());
    const existant = {
      id: 'lod-1',
      fkDocument: 'doc-uuid-1',
      numeroLettre: 'ANCIEN',
      utilisateurCreation: 'dg@bsic.ne',
      utilisateurModification: null,
    };
    lodRepo.findOne.mockResolvedValue(existant);

    const result = await service.creerOuMettreAJour(
      'doc-uuid-1',
      { numeroLettre: 'NOUVEAU' },
      'dg@bsic.ne',
    );

    // create N'EST PAS appelé (UPDATE, pas INSERT)
    expect(lodRepo.create).not.toHaveBeenCalled();
    expect(lodRepo.save).toHaveBeenCalled();
    // L'entité a été mutée puis sauvegardée — audit préservé
    expect(existant.numeroLettre).toBe('NOUVEAU');
    expect(existant.utilisateurModification).toBe('dg@bsic.ne');
    // utilisateurCreation conservé tel quel (pas écrasé)
    expect(existant.utilisateurCreation).toBe('dg@bsic.ne');
    expect(result).toBe(existant);
  });

  // ─── Erreurs métier ────────────────────────────────────────────

  it('5. creerOuMettreAJour — type document ≠ D12_LETTRE_OFFICIALISATION → 409', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({ typeDocument: 'D11_PV_APPROBATION' }),
    );
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(lodRepo.save).not.toHaveBeenCalled();
  });

  it('6. creerOuMettreAJour — statut document ≠ BROUILLON → 409', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc({ statut: 'SIGNE' }));
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(lodRepo.save).not.toHaveBeenCalled();
  });

  it('7. creerOuMettreAJour — user ≠ émetteur → 403', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({ fkUserEmetteur: '99' }), // émetteur ≠ id '23' du mock dataSource.query
    );
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(lodRepo.save).not.toHaveBeenCalled();
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
    expect(lodRepo.save).not.toHaveBeenCalled();
  });
});
