import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('MIZNAS — Module Budgétaire Bancaire UEMOA — API')
    .setDescription('API du module budgétaire bancaire UEMOA')
    .setVersion('1.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    useGlobalPrefix: false,
  });
}
