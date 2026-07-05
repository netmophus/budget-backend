/**
 * Tests StructureOrganisationnelleService (Chantier A) — repos et
 * PerimetreService mockés. Vérifie le filtrage CR par périmètre + les LM
 * globales.
 */
import type { Repository } from 'typeorm';

import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import type { PerimetreService } from '../../budget/services/perimetre.service';
import type { DimCentreResponsabilite } from '../../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import type { DimLigneMetier } from '../../referentiels/ligne-metier/entities/dim-ligne-metier.entity';
import { StructureOrganisationnelleService } from './structure-organisationnelle.service';

const USER = { userId: '1', email: 'a@miznas.local' } as AuthUser;

function make(getCr: jest.Mock) {
  const crRepo = {
    find: jest.fn().mockResolvedValue([
      { codeCr: 'CR_A', libelle: 'Agence A' },
      { codeCr: 'CR_B', libelle: 'Agence B' },
    ]),
  } as unknown as Repository<DimCentreResponsabilite>;
  const lmRepo = {
    find: jest
      .fn()
      .mockResolvedValue([
        { codeLigneMetier: 'LM_1', libelle: 'Particuliers' },
      ]),
  } as unknown as Repository<DimLigneMetier>;
  const perim = {
    getCrAutorisesPourUser: getCr,
  } as unknown as PerimetreService;
  return new StructureOrganisationnelleService(crRepo, lmRepo, perim);
}

describe('StructureOrganisationnelleService (Chantier A)', () => {
  it('getCentresResponsabilite : filtre par périmètre user', async () => {
    const svc = make(jest.fn().mockResolvedValue(['CR_A']));
    const crs = await svc.getCentresResponsabilite(USER);
    expect(crs).toEqual([{ code: 'CR_A', libelle: 'Agence A' }]);
  });

  it('getCentresResponsabilite : périmètre global (null) → tous les CR', async () => {
    const svc = make(jest.fn().mockResolvedValue(null));
    const crs = await svc.getCentresResponsabilite(USER);
    expect(crs).toHaveLength(2);
    expect(crs.map((c) => c.code)).toEqual(['CR_A', 'CR_B']);
  });

  it('getLignesMetier : liste globale (pas de filtrage périmètre)', async () => {
    const svc = make(jest.fn());
    const lms = await svc.getLignesMetier();
    expect(lms).toEqual([{ code: 'LM_1', libelle: 'Particuliers' }]);
  });
});
