/**
 * Tests unitaires CampagnesController (Lot 8.1.C Palier 3).
 *
 * Pattern aligné sur reporting.controller.spec.ts (Lot 7.6) — mock du
 * service via Test.createTestingModule + check decorators metadata
 * (les guards globaux ne sont pas actifs dans le testing module, donc
 * on prouve l'application des @RequirePermissions via Reflect).
 */
import { Test } from '@nestjs/testing';

import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import {
  PERMISSIONS_KEY,
  type PermissionsMetadata,
} from '../../auth/decorators/require-permissions.decorator';
import { CampagnesController } from '../controllers/campagnes.controller';
import { CampagneService } from '../services/campagne.service';

const mockUser: AuthUser = { userId: '23', email: 'dg@bsic.ne' };

describe('CampagnesController (Lot 8.1.C Palier 3)', () => {
  let controller: CampagnesController;
  let service: {
    creerCampagne: jest.Mock;
    listerCampagnes: jest.Mock;
    detailCampagne: jest.Mock;
    ajouterMembreComite: jest.Mock;
    lancerCampagne: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      creerCampagne: jest.fn(),
      listerCampagnes: jest.fn(),
      detailCampagne: jest.fn(),
      ajouterMembreComite: jest.fn(),
      lancerCampagne: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [CampagnesController],
      providers: [{ provide: CampagneService, useValue: service }],
    }).compile();
    controller = moduleRef.get(CampagnesController);
  });

  // ─── RBAC decorators metadata ──────────────────────────────────

  it('@RequirePermissions(CAMPAGNE.GERER) sur POST / (creer)', () => {
    const meta = Reflect.getMetadata(
      PERMISSIONS_KEY,
      controller.creer,
    ) as PermissionsMetadata;
    expect(meta.permissions).toContain('CAMPAGNE.GERER');
  });

  it('@RequirePermissions(DOCUMENT.LIRE) sur GET / (lister)', () => {
    const meta = Reflect.getMetadata(
      PERMISSIONS_KEY,
      controller.lister,
    ) as PermissionsMetadata;
    expect(meta.permissions).toContain('DOCUMENT.LIRE');
  });

  it('@RequirePermissions(CAMPAGNE.GERER) sur POST /:id/membres', () => {
    const meta = Reflect.getMetadata(
      PERMISSIONS_KEY,
      controller.ajouterMembre,
    ) as PermissionsMetadata;
    expect(meta.permissions).toContain('CAMPAGNE.GERER');
  });

  it('@RequirePermissions(CAMPAGNE.GERER) sur POST /:id/lancer', () => {
    const meta = Reflect.getMetadata(
      PERMISSIONS_KEY,
      controller.lancer,
    ) as PermissionsMetadata;
    expect(meta.permissions).toContain('CAMPAGNE.GERER');
  });

  // ─── Appels service corrects ───────────────────────────────────

  it('creer passe dto + user.email au service', async () => {
    const dto = {
      code: 'CAMP_2027',
      exerciceFiscal: 2027,
      libelle: 'C',
      fkUserSignataireDefaut: '23',
    };
    service.creerCampagne.mockResolvedValue({ id: 'camp-1' });
    await controller.creer(dto, mockUser);
    expect(service.creerCampagne).toHaveBeenCalledWith(dto, 'dg@bsic.ne');
  });

  it('ajouterMembre passe (campagneId, dto, user.email)', async () => {
    const dto = { fkUser: '24', libelleFonction: 'DGA Ops' };
    service.ajouterMembreComite.mockResolvedValue({ id: 'm-1' });
    await controller.ajouterMembre('camp-uuid-1', dto, mockUser);
    expect(service.ajouterMembreComite).toHaveBeenCalledWith(
      'camp-uuid-1',
      dto,
      'dg@bsic.ne',
    );
  });
});
