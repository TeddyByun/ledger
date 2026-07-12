import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 전역 입력 검증 (DTO + class-validator)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // API 버전 prefix
  app.setGlobalPrefix('api/v1');
  app.enableCors();

  // OpenAPI 문서 — 코드가 단일 진실원. /api/v1/docs 에서 UI, /docs-json 에서 스펙.
  const config = new DocumentBuilder()
    .setTitle('Ledger API')
    .setDescription('가계부 서비스 REST API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/v1/docs', app, document, {
    jsonDocumentUrl: 'api/v1/docs-json',
  });

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🟢 ledger API on http://localhost:${port}/api/v1 (docs: /api/v1/docs)`);
}

void bootstrap();
