/**
 * Tests unitaires UsersAdminController (Lot Administration) — vérifient
 * le routage et la transmission correcte des paramètres au service.
 * Logique métier déjà couverte dans UsersAdminService.spec.ts.
 */
import { Test, TestingModule } from '@nestjs/testing';

import { UsersAdminController } from './users-admin.controller';
import { UsersAdminService } from '../services/users-admin.service';

describe('UsersAdminController', () => {
  let controller: UsersAdminController;
  let svc: jest.Mocked<UsersAdminService>;
  const auteur = { userId: '1', email: 'admin@test.local' };

  beforeEach(async () => {
    svc = {
      creer: jest.fn(),
      modifier: jest.fn(),
      desactiver: jest.fn(),
      reactiver: jest.fn(),
      resetPassword: jest.fn(),
      forcerDeconnexion: jest.fn(),
      getHistoriqueConnexion: jest.fn(),
      listerRoles: jest.fn(),
      attribuerRole: jest.fn(),
      retirerRole: jest.fn(),
    } as unknown as jest.Mocked<UsersAdminService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [UsersAdminController],
      providers: [{ provide: UsersAdminService, useValue: svc }],
    }).compile();
    controller = moduleRef.get(UsersAdminController);
  });

  it('POST /admin/users délègue creer avec dto + auteur', async () => {
    svc.creer.mockResolvedValue({} as never);
    const dto = {
      email: 'a@m.io',
      nom: 'X',
      prenom: 'Y',
      motDePasseInitial: 'PassWord!2026',
      fkRoles: ['1'],
    } as never;
    await controller.creer(dto, auteur);
    expect(svc.creer).toHaveBeenCalledWith(dto, auteur);
  });

  it('PATCH /admin/users/:id délègue modifier', async () => {
    svc.modifier.mockResolvedValue({} as never);
    await controller.modifier('42', { nom: 'Z' } as never, auteur);
    expect(svc.modifier).toHaveBeenCalledWith('42', { nom: 'Z' }, auteur);
  });

  it('POST /:id/desactiver délègue desactiver', async () => {
    svc.desactiver.mockResolvedValue({} as never);
    await controller.desactiver('42', auteur);
    expect(svc.desactiver).toHaveBeenCalledWith('42', auteur);
  });

  it('POST /:id/reactiver délègue reactiver', async () => {
    svc.reactiver.mockResolvedValue({} as never);
    await controller.reactiver('42', auteur);
    expect(svc.reactiver).toHaveBeenCalledWith('42', auteur);
  });

  it('POST /:id/reset-password renvoie success + message (Lot 6.4.C breaking change : mdp envoye par email, pas retourne)', async () => {
    svc.resetPassword.mockResolvedValue({
      success: true,
      message: 'Email de réinitialisation envoyé à user@miznas.local.',
    });
    const r = await controller.resetPassword('42', auteur);
    expect(r.success).toBe(true);
    expect(r.message).toContain('Email');
  });

  it('POST /:id/forcer-deconnexion délègue', async () => {
    svc.forcerDeconnexion.mockResolvedValue({ revoquees: true });
    const r = await controller.forcerDeconnexion('42', auteur);
    expect(r.revoquees).toBe(true);
    expect(svc.forcerDeconnexion).toHaveBeenCalledWith('42', auteur);
  });

  it('GET /:id/historique-connexion délègue', async () => {
    svc.getHistoriqueConnexion.mockResolvedValue([] as never);
    await controller.historiqueConnexion('42');
    expect(svc.getHistoriqueConnexion).toHaveBeenCalledWith('42');
  });

  it('GET /:id/roles délègue listerRoles', async () => {
    svc.listerRoles.mockResolvedValue([] as never);
    await controller.listerRoles('42');
    expect(svc.listerRoles).toHaveBeenCalledWith('42');
  });

  it('POST /:id/roles délègue attribuerRole', async () => {
    svc.attribuerRole.mockResolvedValue({} as never);
    await controller.attribuerRole('42', { fkRole: '3' } as never, auteur);
    expect(svc.attribuerRole).toHaveBeenCalledWith(
      '42',
      { fkRole: '3' },
      auteur,
    );
  });

  it('DELETE /:id/roles/:fkRole délègue retirerRole', async () => {
    svc.retirerRole.mockResolvedValue({ retire: true });
    await controller.retirerRole('42', '3', { motif: 'test' }, auteur);
    expect(svc.retirerRole).toHaveBeenCalledWith(
      '42',
      '3',
      { motif: 'test' },
      auteur,
    );
  });
});
