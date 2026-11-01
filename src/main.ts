import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { NextFunction, Request, Response } from 'express';
import {
  GOOGLE_ACCESS_COOKIE,
  GOOGLE_REFRESH_COOKIE,
  readSessionCookie,
} from './auth/google-session';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const apiPrefix = configService.get<string>('API_PREFIX', '/api');
  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
  const simulatorUrl = configService.get<string>('SIMULATOR_URL', 'http://localhost:5175');

  // Security Middleware
  app.use(helmet());

  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigins = [frontendUrl, simulatorUrl];
  if (!isProduction) {
    corsOrigins.push(
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5175',
      'http://127.0.0.1:5175',
    );
  }

  // CORS Configuration
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  const cookieOrigins = new Set([frontendUrl]);
  if (!isProduction) {
    cookieOrigins.add('http://localhost:5173');
    cookieOrigins.add('http://127.0.0.1:5173');
  }
  const googlePath = `/${apiPrefix.replace(/^\/+|\/+$/g, '')}/auth/google`.toLowerCase();
  app.use((req: Request, res: Response, next: NextFunction) => {
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const path = req.path.toLowerCase();
    const googleEndpoint = path === googlePath || path.startsWith(`${googlePath}/`);
    const hasGoogleCookie =
      !!readSessionCookie(req, GOOGLE_ACCESS_COOKIE) ||
      !!readSessionCookie(req, GOOGLE_REFRESH_COOKIE);
    const untrustedOrigin = !!req.headers.origin && !cookieOrigins.has(req.headers.origin);
    if (
      (unsafe && (googleEndpoint || hasGoogleCookie) && !req.headers.origin) ||
      ((googleEndpoint || hasGoogleCookie) && untrustedOrigin)
    ) {
      res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Origin not allowed' });
      return;
    }
    next();
  });

  // Global Prefix
  app.setGlobalPrefix(apiPrefix.replace(/^\//, ''));

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger OpenAPI Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('TMEC - Racehorse Training & Stable Management API')
    .setDescription(
      'RESTful API Contract for TMEC Racehorse Management System supporting 5 roles: Club Manager, Head Trainer, Veterinarian, Groom, and Horse Owner.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter your JWT Bearer token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Health & System', 'System health checks, database probes and metrics')
    .addTag('Authentication', 'Login, registration, password reset and invitation APIs')
    .addTag('Horses', 'Horse identification, profile and ownership management')
    .addTag('Stalls & Facility', 'Barn layout, stalls, and groom allocation')
    .addTag('Training & Workouts', 'Phased training plans and daily workouts')
    .addTag('Veterinary & Medical', 'Medical records, 2D injuries and Medical Lock enforcement')
    .addTag('Tournaments', 'Race registrations and official results')
    .addTag('Financials', 'Owner invoicing and prize distribution')
    .addTag('AI Services', 'AI training recommendation and assistant queries')
    .addTag('Audit Logs', 'Immutable governance audit trails')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'TMEC API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(port);
  logger.log(`=======================================================`);
  logger.log(` TMEC Backend is running on: http://localhost:${port}`);
  logger.log(` API Endpoints: http://localhost:${port}/${apiPrefix.replace(/^\//, '')}`);
  logger.log(` Swagger OpenAPI Documentation: http://localhost:${port}/api/docs`);
  logger.log(
    ` Health Check Probe: http://localhost:${port}/${apiPrefix.replace(/^\//, '')}/health`,
  );
  logger.log(`=======================================================`);
}

bootstrap();
