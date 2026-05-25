/**
 * Tests unitaires NotePreparatoireService (Lot 8.3.C P1).
 *
 * Pattern strictement aligné `lettre-mobilisation.service.spec.ts`
 * (Lot 8.3.B) — seul `typeDocument` change (D1_NOTE_PREPARATOIRE).
 * Mocks DataSource + repos. Pas de pg-mem.
 *
 * 8 cas couvrent :
 *  1. lireDetail — happy path : retourne l'entité
 *  2. lireDetail — pas de détail → retourne null
 *  3. creerOuMettreAJour — INSERT premier appel (utilisateurCreation)
 *  4. creerOuMettreAJour — UPDATE deuxième appel (utilisateurModification)
 *  5. creerOuMettreAJour — type ≠ D1_NOTE_PREPARATOIRE → 409
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

import { CreerOuMettreAJourNotePreparatoireDetailDto } from '../dto/note-preparatoire-detail.dto';
import { NotePreparatoireService } from '../services/note-preparatoire.service';

interface FakeDoc {
  id: string;
  typeDocument: string;
  statut: string;
  fkUserEmetteur: string;
}

function makeDoc(over: Partial<FakeDoc> = {}): FakeDoc {
  return {
    id: 'doc-uuid-1',
    typeDocument: 'D1_NOTE_PREPARATOIRE',
    statut: 'BROUILLON',
    fkUserEmetteur: '23',
    ...over,
  };
}

const dtoMinimal: CreerOuMettreAJourNotePreparatoireDetailDto = {
  referenceNote: 'DG/BSIC-NIGER/2028/PREP-01',
  exerciceConcerne: 2028,
  lieuReunion: 'Salle CODIR — Siège BSIC NIGER',
  pointsClesDebattre: 'Priorités investissement IT 2028.',
};

describe('NotePreparatoireService (Lot 8.3.C P1)', () => {
  let service: NotePreparatoireService;
  let docRepo: { findOne: jest.Mock };
  let npdRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let dataSource: {
    getRepository: jest.Mock;
    query: jest.Mock;
  };

  beforeEach(async () => {
    docRepo = { findOne: jest.fn() };
    npdRepo = {
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
          case 'NotePreparatoireDetail':
            return npdRepo;
          default:
            throw new Error(`Unmocked entity: ${entity.name}`);
        }
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotePreparatoireService,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();
    service = moduleRef.get(NotePreparatoireService);
  });

  // ─── lireDetail ────────────────────────────────────────────────

  it("1. lireDetail — happy path : retourne l'entité existante", async () => {
    const fake = { id: 'npd-1', fkDocument: 'doc-uuid-1' };
    npdRepo.findOne.mockResolvedValue(fake);
    const result = await service.lireDetail('doc-uuid-1');
    expect(result).toBe(fake);
    expect(npdRepo.findOne).toHaveBeenCalledWith({
      where: { fkDocument: 'doc-uuid-1' },
    });
  });

  it('2. lireDetail — pas de détail → retourne null', async () => {
    npdRepo.findOne.mockResolvedValue(null);
    const result = await service.lireDetail('doc-uuid-1');
    expect(result).toBeNull();
  });

  // ─── creerOuMettreAJour : happy paths INSERT + UPDATE ─────────

  it('3. creerOuMettreAJour — INSERT premier appel (utilisateurCreation rempli)', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc()); // émetteur = '23'
    npdRepo.findOne.mockResolvedValue(null); // pas de détail existant

    const result = await service.creerOuMettreAJour(
      'doc-uuid-1',
      dtoMinimal,
      'dg@bsic.ne',
    );

    expect(npdRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fkDocument: 'doc-uuid-1',
        utilisateurCreation: 'dg@bsic.ne',
        referenceNote: 'DG/BSIC-NIGER/2028/PREP-01',
        exerciceConcerne: 2028,
        lieuReunion: 'Salle CODIR — Siège BSIC NIGER',
        pointsClesDebattre: 'Priorités investissement IT 2028.',
      }),
    );
    expect(npdRepo.save).toHaveBeenCalled();
    expect(
      (result as { utilisateurCreation: string }).utilisateurCreation,
    ).toBe('dg@bsic.ne');
  });

  it('4. creerOuMettreAJour — UPDATE deuxième appel (audit préservé)', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc());
    const existant = {
      id: 'npd-1',
      fkDocument: 'doc-uuid-1',
      referenceNote: 'ANCIEN',
      utilisateurCreation: 'dg@bsic.ne',
      utilisateurModification: null,
    };
    npdRepo.findOne.mockResolvedValue(existant);

    const result = await service.creerOuMettreAJour(
      'doc-uuid-1',
      { referenceNote: 'NOUVEAU' },
      'dg@bsic.ne',
    );

    // create N'EST PAS appelé (UPDATE, pas INSERT)
    expect(npdRepo.create).not.toHaveBeenCalled();
    expect(npdRepo.save).toHaveBeenCalled();
    // L'entité a été mutée puis sauvegardée — audit préservé
    expect(existant.referenceNote).toBe('NOUVEAU');
    expect(existant.utilisateurModification).toBe('dg@bsic.ne');
    // utilisateurCreation conservé tel quel (pas écrasé)
    expect(existant.utilisateurCreation).toBe('dg@bsic.ne');
    expect(result).toBe(existant);
  });

  // ─── Erreurs métier ────────────────────────────────────────────

  it('5. creerOuMettreAJour — type document ≠ D1_NOTE_PREPARATOIRE → 409', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({ typeDocument: 'D3_NOTE_ORIENTATION' }),
    );
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(npdRepo.save).not.toHaveBeenCalled();
  });

  it('6. creerOuMettreAJour — statut document ≠ BROUILLON → 409', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc({ statut: 'SIGNE' }));
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(npdRepo.save).not.toHaveBeenCalled();
  });

  it('7. creerOuMettreAJour — user ≠ émetteur → 403', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({ fkUserEmetteur: '99' }), // émetteur ≠ id '23' du mock dataSource.query
    );
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(npdRepo.save).not.toHaveBeenCalled();
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
    expect(npdRepo.save).not.toHaveBeenCalled();
  });
});
