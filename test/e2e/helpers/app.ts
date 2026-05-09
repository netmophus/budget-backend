/**
 * Helper bootstrapApp : reproduit la configuration de `src/main.ts`
 * (prefix /api/v1, ValidationPipe global avec whitelist +
 * forbidNonWhitelisted + transform) afin que les e2e exercent la même
 * couche HTTP/DTO que la prod.
 *
 * Utilisé en `beforeAll` de chaque suite *.e2e-spec.ts.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';

import { AppModule } from '../../../src/app.module';

export async function bootstrapApp(): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();
  return app;
}
