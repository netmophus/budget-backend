/**
 * Tests Lot 5.2-fix2 — normalisation crIds / ligneMetierIds
 * (scalaire → array d'1 élément).
 *
 * Couvre :
 *   1. transformation pure via class-transformer (plainToInstance)
 *   2. validation bout-en-bout via ValidationPipe avec la même
 *      configuration qu'en prod (`main.ts`) : whitelist +
 *      forbidNonWhitelisted + transform + enableImplicitConversion.
 *      C'est l'équivalent fonctionnel d'un test e2e sur le DTO du
 *      controller — si le pipe accepte la requête, le controller
 *      reçoit un FiltresEcartsDto valide et répond 200.
 */
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import { FiltresEcartsDto } from './tableau-bord.dto';

const FILTRES_BASE = {
  versionId: '1',
  scenarioId: '1',
  moisDebut: '2027-01',
  moisFin: '2027-03',
};

describe('FiltresEcartsDto — transformation crIds / ligneMetierIds', () => {
  it('crIds scalaire ("14") est normalisé en ["14"]', () => {
    const dto = plainToInstance(FiltresEcartsDto, {
      ...FILTRES_BASE,
      crIds: '14',
    });
    expect(dto.crIds).toEqual(['14']);
  });

  it('crIds array (["14","15"]) reste ["14","15"]', () => {
    const dto = plainToInstance(FiltresEcartsDto, {
      ...FILTRES_BASE,
      crIds: ['14', '15'],
    });
    expect(dto.crIds).toEqual(['14', '15']);
  });

  it('crIds absent reste undefined', () => {
    const dto = plainToInstance(FiltresEcartsDto, FILTRES_BASE);
    expect(dto.crIds).toBeUndefined();
  });

  it('crIds chaîne vide est traité comme absent (undefined)', () => {
    const dto = plainToInstance(FiltresEcartsDto, {
      ...FILTRES_BASE,
      crIds: '',
    });
    expect(dto.crIds).toBeUndefined();
  });

  it('ligneMetierIds applique la même normalisation scalaire→array', () => {
    const dto = plainToInstance(FiltresEcartsDto, {
      ...FILTRES_BASE,
      ligneMetierIds: '101',
    });
    expect(dto.ligneMetierIds).toEqual(['101']);
  });
});

describe('FiltresEcartsDto — ValidationPipe (équivalent comportement controller en prod)', () => {
  // Même config qu'en prod (main.ts:20-26)
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  function transformQuery(rawQuery: Record<string, unknown>): Promise<unknown> {
    return pipe.transform(rawQuery, {
      type: 'query',
      metatype: FiltresEcartsDto,
      data: '',
    });
  }

  it("?crIds=14 (scalaire) passe la validation et le DTO contient ['14'] (cas Aïcha — pas de 400)", async () => {
    const dto = (await transformQuery({
      ...FILTRES_BASE,
      crIds: '14',
    })) as FiltresEcartsDto;
    expect(dto.crIds).toEqual(['14']);
  });

  it('?crIds=14&crIds=15 passe la validation et le DTO contient ["14","15"]', async () => {
    const dto = (await transformQuery({
      ...FILTRES_BASE,
      crIds: ['14', '15'],
    })) as FiltresEcartsDto;
    expect(dto.crIds).toEqual(['14', '15']);
  });

  it('absence de crIds passe la validation', async () => {
    const dto = (await transformQuery(FILTRES_BASE)) as FiltresEcartsDto;
    expect(dto.crIds).toBeUndefined();
  });

  it("?ligneMetierIds=101 (scalaire) passe la validation et le DTO contient ['101']", async () => {
    const dto = (await transformQuery({
      ...FILTRES_BASE,
      ligneMetierIds: '101',
    })) as FiltresEcartsDto;
    expect(dto.ligneMetierIds).toEqual(['101']);
  });

  it("rejette le format brackets ?crIds[]=14 (forbidNonWhitelisted) — protège contre une régression du fix1", async () => {
    await expect(
      transformQuery({
        ...FILTRES_BASE,
        'crIds[]': '14',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette un moisDebut au mauvais format', async () => {
    await expect(
      transformQuery({
        ...FILTRES_BASE,
        moisDebut: '2027/01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
