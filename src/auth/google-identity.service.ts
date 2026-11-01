import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createPublicKey } from 'crypto';
import { apiError } from '../common/exceptions/api-error';

interface GoogleClaims {
  sub: string;
  email: string;
  email_verified: boolean;
}

interface GoogleKey {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

@Injectable()
export class GoogleIdentityService {
  private keys: GoogleKey[] = [];
  private keysExpireAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  async verify(credential: string): Promise<GoogleClaims> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      throw apiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'GOOGLE_LOGIN_UNAVAILABLE',
        'Google sign-in is unavailable',
      );
    }

    try {
      const decoded = this.jwt.decode(credential, { complete: true });
      if (
        !decoded ||
        typeof decoded !== 'object' ||
        decoded.header.alg !== 'RS256' ||
        !decoded.header.kid
      ) {
        throw new Error('Invalid token header');
      }
      const kid = decoded.header.kid;
      let key = (await this.getKeys()).find((item) => item.kid === kid);
      if (!key) key = (await this.getKeys(true)).find((item) => item.kid === kid);
      if (
        !key ||
        key.kty !== 'RSA' ||
        key.use !== 'sig' ||
        key.alg !== 'RS256' ||
        !key.n ||
        !key.e
      ) {
        throw new Error('Invalid signing key');
      }
      const publicKey = createPublicKey({
        key: { kty: key.kty, n: key.n, e: key.e },
        format: 'jwk',
      });
      const claims = await this.jwt.verifyAsync<GoogleClaims & { exp?: number }>(credential, {
        secret: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        algorithms: ['RS256'],
        audience: clientId,
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
      });
      if (
        !claims.exp ||
        !claims.sub ||
        typeof claims.email !== 'string' ||
        claims.email_verified !== true
      ) {
        throw new Error('Invalid identity claims');
      }
      return { sub: claims.sub, email: claims.email.toLowerCase(), email_verified: true };
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() >= 500) throw error;
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        'GOOGLE_LOGIN_FAILED',
        'Google sign-in could not be completed',
      );
    }
  }

  private async getKeys(force = false): Promise<GoogleKey[]> {
    if (!force && this.keysExpireAt > Date.now()) return this.keys;
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('Could not fetch Google signing keys');
      const body = (await response.json()) as { keys?: GoogleKey[] };
      if (!Array.isArray(body.keys) || !body.keys.length)
        throw new Error('Invalid Google signing keys');
      const maxAge = Number(
        response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 300,
      );
      this.keys = body.keys;
      this.keysExpireAt = Date.now() + Math.min(maxAge, 86400) * 1000;
      return this.keys;
    } catch {
      throw apiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'GOOGLE_LOGIN_UNAVAILABLE',
        'Google sign-in is unavailable',
      );
    }
  }
}
