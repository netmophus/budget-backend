/**
 * Tests unitaires LettreMobilisationService (Lot 8.3.B P1).
 *
 * Pattern strictement aligné `note-orientation.service.spec.ts`
 * (Lot 8.3.A) — seul `typeDocument` change (D5_LETTRE_MOBILISATION).
 * Mocks DataSource + repos. Pas de pg-mem.
 *
 * 8 cas couvrent :
 *  1. lireDetail — happy path : retourne l'entité
 *  2. lireDetail — pas de détail → retourne null
 *  3. creerOuMettreAJour — INSERT premier appel (utilisateurCreation)
 *  4. creerOuMettreAJour — UPDATE deuxième appel (utilisateurModification)
 *  5. creerOuMettreAJour — type ≠ D5_LETTRE_MOBILISATION → 409
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

import { CreerOuMettreAJourLettreMobilisationDetailDto } from '../dto/lettre-mobilisation-detail.dto';
import { LettreMobilisationService } from '../services/lettre-mobilisation.service';

interface FakeDoc {
  id: string;
  typeDocument: string;
  statut: string;
  fkUserEmetteur: string;
}

function makeDoc(over: Partial<FakeDoc> = {}): FakeDoc {
  return {
    id: 'doc-uuid-1',
    // Identifiant technique projet : D5_LETTRE_DG (cohérent enum
    // creer-document.dto.ts + frontend). Label métier "Lettre de
    // mobilisation" via TYPE_DOCUMENT_LABEL.
    typeDocument: 'D5_LETTRE_DG',
    statut: 'BROUILLON',
    fkUserEmetteur: '23',
    ...over,
  };
}

const dtoMinimal: CreerOuMettreAJourLettreMobilisationDetailDto = {
  referenceLettre: 'DG/BSIC-NIGER/2028/MOBIL-01',
  exerciceConcerne: 2028,
  pnbConsolideMfcfa: '14500.00',
  nbObjectifsPrioritaires: 12,
};

describe('LettreMobilisationService (Lot 8.3.B P1)', () => {
  let service: LettreMobilisationService;
  let docRepo: { findOne: jest.Mock };
  let lmdRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let dataSource: {
    getRepository: jest.Mock;
    query: jest.Mock;
  };

  beforeEach(async () => {
    docRepo = { findOne: jest.fn() };
    lmdRepo = {
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
          case 'LettreMobilisationDetail':
            return lmdRepo;
          default:
            throw new Error(`Unmocked entity: ${entity.name}`);
        }
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LettreMobilisationService,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();
    service = moduleRef.get(LettreMobilisationService);
  });

  // ─── lireDetail ────────────────────────────────────────────────

  it("1. lireDetail — happy path : retourne l'entité existante", async () => {
    const fake = { id: 'lmd-1', fkDocument: 'doc-uuid-1' };
    lmdRepo.findOne.mockResolvedValue(fake);
    const result = await service.lireDetail('doc-uuid-1');
    expect(result).toBe(fake);
    expect(lmdRepo.findOne).toHaveBeenCalledWith({
      where: { fkDocument: 'doc-uuid-1' },
    });
  });

  it('2. lireDetail — pas de détail → retourne null', async () => {
    lmdRepo.findOne.mockResolvedValue(null);
    const result = await service.lireDetail('doc-uuid-1');
    expect(result).toBeNull();
  });

  // ─── creerOuMettreAJour : happy paths INSERT + UPDATE ─────────

  it('3. creerOuMettreAJour — INSERT premier appel (utilisateurCreation rempli)', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc()); // émetteur = '23'
    lmdRepo.findOne.mockResolvedValue(null); // pas de détail existant

    const result = await service.creerOuMettreAJour(
      'doc-uuid-1',
      dtoMinimal,
      'dg@bsic.ne',
    );

    expect(lmdRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fkDocument: 'doc-uuid-1',
        utilisateurCreation: 'dg@bsic.ne',
        referenceLettre: 'DG/BSIC-NIGER/2028/MOBIL-01',
        exerciceConcerne: 2028,
        pnbConsolideMfcfa: '14500.00',
        nbObjectifsPrioritaires: 12,
      }),
    );
    expect(lmdRepo.save).toHaveBeenCalled();
    expect(
      (result as { utilisateurCreation: string }).utilisateurCreation,
    ).toBe('dg@bsic.ne');
  });

  it('4. creerOuMettreAJour — UPDATE deuxième appel (audit préservé)', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc());
    const existant = {
      id: 'lmd-1',
      fkDocument: 'doc-uuid-1',
      referenceLettre: 'ANCIEN',
      utilisateurCreation: 'dg@bsic.ne',
      utilisateurModification: null,
    };
    lmdRepo.findOne.mockResolvedValue(existant);

    const result = await service.creerOuMettreAJour(
      'doc-uuid-1',
      { referenceLettre: 'NOUVEAU' },
      'dg@bsic.ne',
    );

    // create N'EST PAS appelé (UPDATE, pas INSERT)
    expect(lmdRepo.create).not.toHaveBeenCalled();
    expect(lmdRepo.save).toHaveBeenCalled();
    // L'entité a été mutée puis sauvegardée — audit préservé
    expect(existant.referenceLettre).toBe('NOUVEAU');
    expect(existant.utilisateurModification).toBe('dg@bsic.ne');
    // utilisateurCreation conservé tel quel (pas écrasé)
    expect(existant.utilisateurCreation).toBe('dg@bsic.ne');
    expect(result).toBe(existant);
  });

  // ─── Erreurs métier ────────────────────────────────────────────

  it('5. creerOuMettreAJour — type document ≠ D5_LETTRE_DG → 409', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({ typeDocument: 'D3_NOTE_ORIENTATION' }),
    );
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(lmdRepo.save).not.toHaveBeenCalled();
  });

  it('6. creerOuMettreAJour — statut document ≠ BROUILLON → 409', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc({ statut: 'SIGNE' }));
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(lmdRepo.save).not.toHaveBeenCalled();
  });

  it('7. creerOuMettreAJour — user ≠ émetteur → 403', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({ fkUserEmetteur: '99' }), // émetteur ≠ id '23' du mock dataSource.query
    );
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(lmdRepo.save).not.toHaveBeenCalled();
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
    expect(lmdRepo.save).not.toHaveBeenCalled();
  });
});
