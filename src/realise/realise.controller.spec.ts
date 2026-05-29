/**
 * Tests unitaires RealiseController (Lot 5.1) — vérifient le routage
 * et la transmission correcte des paramètres aux services.
 *
 * La logique RBAC fine et le filtrage périmètre sont déjà couverts
 * par les tests RealiseService. Ici on vérifie la couche transport.
 */
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { RealiseController } from './realise.controller';
import { RealiseImportService } from './services/realise-import.service';
import { RealiseService } from './services/realise.service';
import { RealiseTemplateService } from './services/realise-template.service';

describe('RealiseController', () => {
  let controller: RealiseController;
  let svc: jest.Mocked<RealiseService>;
  let importSvc: jest.Mocked<RealiseImportService>;
  let templateSvc: jest.Mocked<RealiseTemplateService>;
  const auteur = { userId: '10', email: 'admin@test.local' };

  beforeEach(async () => {
    svc = {
      lister: jest.fn(),
      getGrille: jest.fn(),
      findOne: jest.fn(),
      creer: jest.fn(),
      modifier: jest.fn(),
      supprimer: jest.fn(),
      valider: jest.fn(),
    } as unknown as jest.Mocked<RealiseService>;
    importSvc = {
      importFichier: jest.fn(),
    } as unknown as jest.Mocked<RealiseImportService>;
    templateSvc = {
      genererTemplateXlsx: jest.fn(),
    } as unknown as jest.Mocked<RealiseTemplateService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [RealiseController],
      providers: [
        { provide: RealiseService, useValue: svc },
        { provide: RealiseImportService, useValue: importSvc },
        { provide: RealiseTemplateService, useValue: templateSvc },
      ],
    }).compile();
    controller = moduleRef.get(RealiseController);
  });

  it('GET /realise délègue à svc.lister avec query', async () => {
    svc.lister.mockResolvedValue({ items: [], total: 0 });
    const q = { statut: 'IMPORTE' as const, page: 1, limit: 20 };
    await controller.lister(q);
    expect(svc.lister).toHaveBeenCalledWith(q);
  });

  it('GET /realise/grille rejette 400 si paramètres manquants', () => {
    expect(() => controller.getGrille('', '', '')).toThrow(BadRequestException);
  });

  it('GET /realise/grille appelle le service avec les params', async () => {
    svc.getGrille.mockResolvedValue([]);
    await controller.getGrille('1', '2027-01', '2027-12');
    expect(svc.getGrille).toHaveBeenCalledWith({
      crId: '1',
      moisDebut: '2027-01',
      moisFin: '2027-12',
    });
  });

  it('POST /realise délègue à svc.creer avec dto + user', async () => {
    svc.creer.mockResolvedValue({} as never);
    const dto = {
      fkCentreResponsabilite: '1',
      fkCompte: '2',
      fkLigneMetier: '3',
      fkTemps: '4',
      fkDevise: '5',
      montant: 1000,
    } as never;
    await controller.creer(dto, auteur);
    expect(svc.creer).toHaveBeenCalledWith(dto, auteur);
  });

  it('PATCH /realise/:id délègue à svc.modifier', async () => {
    svc.modifier.mockResolvedValue({} as never);
    await controller.modifier('42', { montant: 500 } as never, auteur);
    expect(svc.modifier).toHaveBeenCalledWith('42', { montant: 500 }, auteur);
  });

  it('DELETE /realise/:id délègue à svc.supprimer + retourne {supprime:true}', async () => {
    svc.supprimer.mockResolvedValue();
    const r = await controller.supprimer('42', auteur);
    expect(r).toEqual({ supprime: true });
    expect(svc.supprimer).toHaveBeenCalledWith('42', auteur);
  });

  it('POST /realise/valider délègue ids au service', async () => {
    svc.valider.mockResolvedValue({ nbValidees: 3 });
    const r = await controller.valider({ ids: ['1', '2', '3'] }, auteur);
    expect(r.nbValidees).toBe(3);
    expect(svc.valider).toHaveBeenCalledWith(['1', '2', '3'], auteur);
  });

  it('POST /realise/import sans fichier → 400', async () => {
    await expect(
      controller.importer(undefined as never, auteur),
    ).rejects.toThrow(BadRequestException);
  });

  it('POST /realise/import refuse fichier > 10 MB', async () => {
    const tooBig = {
      buffer: Buffer.alloc(0),
      originalname: 'big.csv',
      mimetype: 'text/csv',
      size: 20 * 1024 * 1024,
    };
    await expect(controller.importer(tooBig as never, auteur)).rejects.toThrow(
      /trop volumineux/,
    );
  });

  it('POST /realise/import délègue au service avec file + user', async () => {
    importSvc.importFichier.mockResolvedValue({
      nbLignesTraitees: 1,
      nbLignesCreees: 1,
      nbLignesMisesAJour: 0,
      nbLignesIgnorees: 0,
      nbErreurs: 0,
      erreurs: [],
      lignesIgnorees: [],
      // Lot 8.5.G — nouveaux champs du rapport.
      nbLignesSansBudget: 0,
      lignesSansBudget: [],
    });
    const file = {
      buffer: Buffer.from('x'),
      originalname: 'test.csv',
      mimetype: 'text/csv',
      size: 1,
    };
    await controller.importer(file as never, auteur);
    expect(importSvc.importFichier).toHaveBeenCalledWith(file, auteur);
  });

  it('GET /realise/template-xlsx (Lot 8.5.D) stream le buffer avec headers XLSX', async () => {
    const fakeBuffer = Buffer.from('FAKE_XLSX_CONTENT');
    templateSvc.genererTemplateXlsx.mockResolvedValue(fakeBuffer);
    const setHeader = jest.fn();
    const send = jest.fn();
    const res = { setHeader, send } as never;
    await controller.downloadTemplate(res);
    expect(templateSvc.genererTemplateXlsx).toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="MIZNAS_Realise_Template.xlsx"',
    );
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Length',
      String(fakeBuffer.length),
    );
    expect(send).toHaveBeenCalledWith(fakeBuffer);
  });
});
