import { CookieOptions, Request, Response } from 'express';
import { RefreshTokenResponseDto } from './dto/auth-response.dto';

export const GOOGLE_ACCESS_COOKIE = 'equiflow_google_access';
export const GOOGLE_REFRESH_COOKIE = 'equiflow_google_refresh';

export function readSessionCookie(req: Request, name: string): string | null {
  const pair = req.headers.cookie
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : null;
}

function cookieOptions(): CookieOptions {
  const secure = process.env.NODE_ENV === 'production';
  return { httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', path: '/' };
}

export function setGoogleSession(res: Response, tokens: RefreshTokenResponseDto): void {
  res.setHeader('Cache-Control', 'no-store');
  res.cookie(GOOGLE_ACCESS_COOKIE, tokens.accessToken, {
    ...cookieOptions(),
    maxAge: tokens.expiresIn * 1000,
  });
  res.cookie(GOOGLE_REFRESH_COOKIE, tokens.refreshToken, {
    ...cookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearGoogleSession(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.clearCookie(GOOGLE_ACCESS_COOKIE, cookieOptions());
  res.clearCookie(GOOGLE_REFRESH_COOKIE, cookieOptions());
}
