/**
 * Tests unitaires NoteOrientationService (Lot 8.3.A P1).
 *
 * Pattern strictement aligné `lettre-cadrage.service.spec.ts`
 * (Lot 8.2.C). Mocks DataSource + repos. Pas de pg-mem — les
 * contraintes SQL (ck_exercice_plausible, ck_taux_directeur_plausible,
 * ck_parts_marche_plausibles, etc.) sont couvertes par la migration
 * et testées en intégration E2E si besoin.
 *
 * 7 cas couvrent :
 *  1. lireDetail — happy path : retourne l'entité
 *  2. lireDetail — pas de détail → retourne null
 *  3. creerOuMettreAJour — INSERT premier appel (utilisateurCreation)
 *  4. creerOuMettreAJour — UPDATE deuxième appel (utilisateurModification)
 *  5. creerOuMettreAJour — type document ≠ D3_NOTE_ORIENTATION → 409
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

import { CreerOuMettreAJourNoteOrientationDetailDto } from '../dto/note-orientation-detail.dto';
import { NoteOrientationService } from '../services/note-orientation.service';

interface FakeDoc {
  id: string;
  typeDocument: string;
  statut: string;
  fkUserEmetteur: string;
}

function makeDoc(over: Partial<FakeDoc> = {}): FakeDoc {
  return {
    id: 'doc-uuid-1',
    typeDocument: 'D3_NOTE_ORIENTATION',
    statut: 'BROUILLON',
    fkUserEmetteur: '23',
    ...over,
  };
}

const dtoMinimal: CreerOuMettreAJourNoteOrientationDetailDto = {
  numeroNote: 'DG/BSIC-NIGER/2027/ORIENT-01',
  exerciceConcerne: 2027,
  tauxDirecteurBceaoPct: '5.50',
};

describe('NoteOrientationService (Lot 8.3.A P1)', () => {
  let service: NoteOrientationService;
  let docRepo: { findOne: jest.Mock };
  let nodRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let dataSource: {
    getRepository: jest.Mock;
    query: jest.Mock;
  };

  beforeEach(async () => {
    docRepo = { findOne: jest.fn() };
    nodRepo = {
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
          case 'NoteOrientationDetail':
            return nodRepo;
          default:
            throw new Error(`Unmocked entity: ${entity.name}`);
        }
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NoteOrientationService,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();
    service = moduleRef.get(NoteOrientationService);
  });

  // ─── lireDetail ────────────────────────────────────────────────

  it("1. lireDetail — happy path : retourne l'entité existante", async () => {
    const fake = { id: 'nod-1', fkDocument: 'doc-uuid-1' };
    nodRepo.findOne.mockResolvedValue(fake);
    const result = await service.lireDetail('doc-uuid-1');
    expect(result).toBe(fake);
    expect(nodRepo.findOne).toHaveBeenCalledWith({
      where: { fkDocument: 'doc-uuid-1' },
    });
  });

  it('2. lireDetail — pas de détail → retourne null', async () => {
    nodRepo.findOne.mockResolvedValue(null);
    const result = await service.lireDetail('doc-uuid-1');
    expect(result).toBeNull();
  });

  // ─── creerOuMettreAJour : happy paths INSERT + UPDATE ─────────

  it('3. creerOuMettreAJour — INSERT premier appel (utilisateurCreation rempli)', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc()); // émetteur = '23'
    nodRepo.findOne.mockResolvedValue(null); // pas de détail existant

    const result = await service.creerOuMettreAJour(
      'doc-uuid-1',
      dtoMinimal,
      'dg@bsic.ne',
    );

    expect(nodRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fkDocument: 'doc-uuid-1',
        utilisateurCreation: 'dg@bsic.ne',
        numeroNote: 'DG/BSIC-NIGER/2027/ORIENT-01',
        exerciceConcerne: 2027,
        tauxDirecteurBceaoPct: '5.50',
      }),
    );
    expect(nodRepo.save).toHaveBeenCalled();
    expect(
      (result as { utilisateurCreation: string }).utilisateurCreation,
    ).toBe('dg@bsic.ne');
  });

  it('4. creerOuMettreAJour — UPDATE deuxième appel (audit utilisateurModification)', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc());
    const existant = {
      id: 'nod-1',
      fkDocument: 'doc-uuid-1',
      numeroNote: 'ANCIEN',
      utilisateurCreation: 'dg@bsic.ne',
      utilisateurModification: null,
    };
    nodRepo.findOne.mockResolvedValue(existant);

    const result = await service.creerOuMettreAJour(
      'doc-uuid-1',
      { numeroNote: 'NOUVEAU' },
      'dg@bsic.ne',
    );

    // create N'EST PAS appelé (UPDATE, pas INSERT)
    expect(nodRepo.create).not.toHaveBeenCalled();
    expect(nodRepo.save).toHaveBeenCalled();
    // L'entité a été mutée puis sauvegardée — audit préservé
    expect(existant.numeroNote).toBe('NOUVEAU');
    expect(existant.utilisateurModification).toBe('dg@bsic.ne');
    // utilisateurCreation conservé tel quel (pas écrasé)
    expect(existant.utilisateurCreation).toBe('dg@bsic.ne');
    expect(result).toBe(existant);
  });

  // ─── Erreurs métier ────────────────────────────────────────────

  it('5. creerOuMettreAJour — type document ≠ D3_NOTE_ORIENTATION → 409', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({ typeDocument: 'D2_LETTRE_CADRAGE' }),
    );
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(nodRepo.save).not.toHaveBeenCalled();
  });

  it('6. creerOuMettreAJour — statut document ≠ BROUILLON → 409', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc({ statut: 'SIGNE' }));
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(nodRepo.save).not.toHaveBeenCalled();
  });

  it('7. creerOuMettreAJour — user ≠ émetteur → 403', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({ fkUserEmetteur: '99' }), // émetteur ≠ id '23' du mock dataSource.query
    );
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'dg@bsic.ne'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(nodRepo.save).not.toHaveBeenCalled();
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
    expect(nodRepo.save).not.toHaveBeenCalled();
  });
});
