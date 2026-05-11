/**
 * Tests unitaires DelegationsController (Lot 4.2.B).
 * Vérifie : routage, autorisation admin via PermissionsService,
 * sérialisation DTO, calcul de statut, propagation des warnings.
 */
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PermissionsService } from '../auth/permissions.service';
import { DelegationsController } from './delegations.controller';
import { DelegationsService } from './delegations.service';
import { Delegation } from './entities/delegation.entity';

function makeDelegation(overrides: Partial<Delegation> = {}): Delegation {
  return {
    id: '42',
    fkDelegant: '10',
    fkDelegataire: '11',
    perimetreUserPerimetreIds: ['1', '2'],
    permissions: ['VALIDATION'],
    motif: 'Mission',
    dateDebut: '2027-01-01',
    dateFin: '2027-01-31',
    actif: true,
    revoqueeLe: null,
    fkRevoquePar: null,
    motifRevocation: null,
    dateCreation: new Date('2027-01-01T10:00:00Z'),
    utilisateurCreation: 'delegant@miznas.local',
    dateModification: null,
    utilisateurModification: null,
    ...overrides,
  } as Delegation;
}

describe('DelegationsController', () => {
  let controller: DelegationsController;
  let svc: jest.Mocked<DelegationsService>;
  let perms: jest.Mocked<Pick<PermissionsService, 'hasPermission'>>;
  const currentUser = { userId: '10', email: 'delegant@miznas.local' };

  beforeEach(async () => {
    svc = {
      creer: jest.fn(),
      revoquer: jest.fn(),
      listerEnTantQueDelegataire: jest.fn(),
      listerEmises: jest.fn(),
      listerToutes: jest.fn(),
    } as unknown as jest.Mocked<DelegationsService>;

    perms = { hasPermission: jest.fn() } as unknown as jest.Mocked<
      Pick<PermissionsService, 'hasPermission'>
    >;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [DelegationsController],
      providers: [
        { provide: DelegationsService, useValue: svc },
        { provide: PermissionsService, useValue: perms },
      ],
    }).compile();
    controller = moduleRef.get(DelegationsController);
  });

  // ─── POST /delegations ───────────────────────────────────────────

  it('POST /delegations délègue au service avec currentUser et propage warnings', async () => {
    svc.creer.mockResolvedValue({
      delegation: makeDelegation(),
      warnings: [
        'Chevauchement avec délégation #5 (perms VALIDATION, 1 périmètre(s)).',
      ],
    });
    const dto = {
      fkDelegataire: '11',
      perimetreUserPerimetreIds: ['1'],
      permissions: ['VALIDATION'],
      motif: 'Mission BCEAO',
      dateDebut: '2027-01-01',
      dateFin: '2027-01-31',
    } as never;
    const r = await controller.creer(dto, currentUser);
    expect(svc.creer).toHaveBeenCalledWith(dto, currentUser);
    expect(r.id).toBe('42');
    expect(r.warnings).toHaveLength(1);
    expect(r.statut).toBe('ACTIVE');
  });

  it('POST /delegations renvoie EXPIREE si date_fin déjà passée', async () => {
    svc.creer.mockResolvedValue({
      delegation: makeDelegation({ dateFin: '2020-01-01' }),
      warnings: [],
    });
    const r = await controller.creer({} as never, currentUser);
    expect(r.statut).toBe('EXPIREE');
  });

  // ─── POST /delegations/:id/revoquer ──────────────────────────────

  it('POST /:id/revoquer : passe isAdmin=true si DELEGATION.GERER', async () => {
    perms.hasPermission.mockResolvedValue(true);
    svc.revoquer.mockResolvedValue(
      makeDelegation({
        actif: false,
        revoqueeLe: new Date(),
        motifRevocation: 'm',
      }),
    );
    const r = await controller.revoquer('42', { motif: 'm' }, currentUser);
    expect(perms.hasPermission).toHaveBeenCalledWith('10', [
      'DELEGATION.GERER',
    ]);
    expect(svc.revoquer).toHaveBeenCalledWith(
      '42',
      { motif: 'm' },
      currentUser,
      true, // isAdmin
    );
    expect(r.statut).toBe('REVOQUEE');
  });

  it('POST /:id/revoquer : isAdmin=false si pas DELEGATION.GERER', async () => {
    perms.hasPermission.mockResolvedValue(false);
    svc.revoquer.mockResolvedValue(
      makeDelegation({ actif: false, revoqueeLe: new Date() }),
    );
    await controller.revoquer('42', { motif: 'm' }, currentUser);
    expect(svc.revoquer).toHaveBeenCalledWith(
      '42',
      { motif: 'm' },
      currentUser,
      false,
    );
  });

  it('POST /:id/revoquer : propage ForbiddenException du service', async () => {
    perms.hasPermission.mockResolvedValue(false);
    svc.revoquer.mockRejectedValue(
      new ForbiddenException('Seul le délégant ou un administrateur'),
    );
    await expect(
      controller.revoquer('42', { motif: 'm' }, currentUser),
    ).rejects.toThrow(ForbiddenException);
  });

  // ─── GET /delegations/recues ─────────────────────────────────────

  it('GET /delegations/recues : appel avec userId courant', async () => {
    svc.listerEnTantQueDelegataire.mockResolvedValue([]);
    await controller.mesRecues({ actif: true } as never, {
      ...currentUser,
      userId: '11',
    });
    expect(svc.listerEnTantQueDelegataire).toHaveBeenCalledWith('11', {
      actif: true,
      dateRef: undefined,
    });
  });

  // ─── GET /delegations/emises ─────────────────────────────────────

  it('GET /delegations/emises : transmet le filtre statut', async () => {
    svc.listerEmises.mockResolvedValue([]);
    await controller.mesEmises({ statut: 'ACTIVE' } as never, currentUser);
    expect(svc.listerEmises).toHaveBeenCalledWith('10', {
      actif: undefined,
      statut: 'ACTIVE',
    });
  });

  // ─── GET /admin/delegations ──────────────────────────────────────

  it('GET /admin/delegations : passe les filtres au service listerToutes', async () => {
    svc.listerToutes.mockResolvedValue([]);
    const filters = {
      delegantId: '10',
      actif: true,
      page: 2,
      limit: 25,
    } as never;
    await controller.toutes(filters);
    expect(svc.listerToutes).toHaveBeenCalledWith(filters);
  });

  // ─── Sérialisation DTO ───────────────────────────────────────────

  it('sérialise les bigint en string et inclut delegantEmail/delegataireEmail', async () => {
    svc.creer.mockResolvedValue({
      delegation: makeDelegation({
        id: '99',
        fkDelegant: '10',
        fkDelegataire: '11',
      }),
      warnings: [],
    });
    const r = await controller.creer({} as never, currentUser);
    expect(typeof r.id).toBe('string');
    expect(r.id).toBe('99');
    expect(r.fkDelegant).toBe('10');
    expect(r.fkDelegataire).toBe('11');
  });
});
