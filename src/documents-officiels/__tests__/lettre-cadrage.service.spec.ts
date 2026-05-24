/**
 * Tests unitaires LettreCadrageService (Lot 8.2.C P1).
 *
 * Mocks DataSource + repos (pattern projet, cf.
 * `document-fichier.service.spec.ts` Lot 8.1.D). Pas de pg-mem —
 * les contraintes SQL (ck_pnb_positif, ck_ratios_dans_plage) sont
 * couvertes par la migration et seraient testées en intégration E2E.
 *
 * 6 cas couvrent :
 *  1. lireDetail — happy path : retourne l'entité
 *  2. lireDetail — pas de détail → retourne null
 *  3. creerOuMettreAJour — INSERT premier appel (utilisateurCreation rempli)
 *  4. creerOuMettreAJour — UPDATE deuxième appel (utilisateurModification rempli)
 *  5. creerOuMettreAJour — type document ≠ D2_LETTRE_CADRAGE → 409
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

import { CreerOuMettreAJourLettreCadrageDetailDto } from '../dto/lettre-cadrage-detail.dto';
import { LettreCadrageService } from '../services/lettre-cadrage.service';

interface FakeDoc {
  id: string;
  typeDocument: string;
  statut: string;
  fkUserEmetteur: string;
}

function makeDoc(over: Partial<FakeDoc> = {}): FakeDoc {
  return {
    id: 'doc-uuid-1',
    typeDocument: 'D2_LETTRE_CADRAGE',
    statut: 'BROUILLON',
    fkUserEmetteur: '23',
    ...over,
  };
}

const dtoMinimal: CreerOuMettreAJourLettreCadrageDetailDto = {
  referenceHolding: 'CA/BSIC-HOLDING/2025/047',
  pnbCibleMfcfa: '12500.00',
};

describe('LettreCadrageService (Lot 8.2.C P1)', () => {
  let service: LettreCadrageService;
  let docRepo: { findOne: jest.Mock };
  let lcdRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let dataSource: {
    getRepository: jest.Mock;
    query: jest.Mock;
  };

  beforeEach(async () => {
    docRepo = { findOne: jest.fn() };
    lcdRepo = {
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
          case 'LettreCadrageDetail':
            return lcdRepo;
          default:
            throw new Error(`Unmocked entity: ${entity.name}`);
        }
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LettreCadrageService,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();
    service = moduleRef.get(LettreCadrageService);
  });

  // ─── lireDetail ────────────────────────────────────────────────

  it("1. lireDetail — happy path : retourne l'entité existante", async () => {
    const fake = { id: 'lcd-1', fkDocument: 'doc-uuid-1' };
    lcdRepo.findOne.mockResolvedValue(fake);
    const result = await service.lireDetail('doc-uuid-1');
    expect(result).toBe(fake);
    expect(lcdRepo.findOne).toHaveBeenCalledWith({
      where: { fkDocument: 'doc-uuid-1' },
    });
  });

  it('2. lireDetail — pas de détail → retourne null', async () => {
    lcdRepo.findOne.mockResolvedValue(null);
    const result = await service.lireDetail('doc-uuid-1');
    expect(result).toBeNull();
  });

  // ─── creerOuMettreAJour : happy paths INSERT + UPDATE ─────────

  it('3. creerOuMettreAJour — INSERT premier appel (utilisateurCreation rempli)', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc()); // émetteur = '23'
    lcdRepo.findOne.mockResolvedValue(null); // pas de détail existant

    const result = await service.creerOuMettreAJour(
      'doc-uuid-1',
      dtoMinimal,
      'finance@bsic.ne',
    );

    expect(lcdRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fkDocument: 'doc-uuid-1',
        utilisateurCreation: 'finance@bsic.ne',
        referenceHolding: 'CA/BSIC-HOLDING/2025/047',
        pnbCibleMfcfa: '12500.00',
      }),
    );
    expect(lcdRepo.save).toHaveBeenCalled();
    expect(
      (result as { utilisateurCreation: string }).utilisateurCreation,
    ).toBe('finance@bsic.ne');
  });

  it('4. creerOuMettreAJour — UPDATE deuxième appel (utilisateurModification rempli)', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc());
    const existant = {
      id: 'lcd-1',
      fkDocument: 'doc-uuid-1',
      referenceHolding: 'ANCIEN',
      utilisateurCreation: 'finance@bsic.ne',
      utilisateurModification: null,
    };
    lcdRepo.findOne.mockResolvedValue(existant);

    const result = await service.creerOuMettreAJour(
      'doc-uuid-1',
      { referenceHolding: 'NOUVEAU' },
      'finance@bsic.ne',
    );

    // create NE doit PAS être appelé (UPDATE, pas INSERT)
    expect(lcdRepo.create).not.toHaveBeenCalled();
    expect(lcdRepo.save).toHaveBeenCalled();
    // L'entité a été mutée puis sauvegardée
    expect(existant.referenceHolding).toBe('NOUVEAU');
    expect(existant.utilisateurModification).toBe('finance@bsic.ne');
    expect(result).toBe(existant);
  });

  // ─── Erreurs métier ────────────────────────────────────────────

  it('5. creerOuMettreAJour — type document ≠ D2_LETTRE_CADRAGE → 409', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({ typeDocument: 'D3_NOTE_ORIENTATION' }),
    );
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'finance@bsic.ne'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(lcdRepo.save).not.toHaveBeenCalled();
  });

  it('6. creerOuMettreAJour — statut document ≠ BROUILLON → 409', async () => {
    docRepo.findOne.mockResolvedValue(makeDoc({ statut: 'SIGNE' }));
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'finance@bsic.ne'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(lcdRepo.save).not.toHaveBeenCalled();
  });

  it('7. creerOuMettreAJour — user ≠ émetteur → 403', async () => {
    docRepo.findOne.mockResolvedValue(
      makeDoc({ fkUserEmetteur: '99' }), // émetteur ≠ id '23' du mock dataSource.query
    );
    await expect(
      service.creerOuMettreAJour('doc-uuid-1', dtoMinimal, 'finance@bsic.ne'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(lcdRepo.save).not.toHaveBeenCalled();
  });

  it('8. creerOuMettreAJour — document introuvable → 404', async () => {
    docRepo.findOne.mockResolvedValue(null);
    await expect(
      service.creerOuMettreAJour(
        'doc-uuid-inexistante',
        dtoMinimal,
        'finance@bsic.ne',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(lcdRepo.save).not.toHaveBeenCalled();
  });
});
