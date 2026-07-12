import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService, SessionResult } from './auth.service.js';
import { TokenService } from './token.service.js';
import { SignupDto, LoginDto } from './dto/auth.dto.js';
import { Public } from './decorators/public.decorator.js';
import { CurrentUser, AuthUser } from './decorators/current-user.decorator.js';

const REFRESH_COOKIE = 'refresh_token';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('signup')
  @ApiOperation({ summary: '회원가입 (+기본 가구 생성, owner)' })
  async signup(
    @Body() dto: SignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.signup(dto, req.headers['user-agent']);
    return this.respondWithSession(session, res);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: '로그인 → Access + Refresh' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.login(dto, req.headers['user-agent']);
    return this.respondWithSession(session, res);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Refresh 회전 → 새 Access + Refresh' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { refreshToken?: string },
  ) {
    const token = this.readRefresh(req, body);
    if (!token) throw new UnauthorizedException('UNAUTHENTICATED');
    const session = await this.auth.refresh(token, req.headers['user-agent']);
    return this.respondWithSession(session, res);
  }

  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({ summary: '현재 Refresh 폐기' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { refreshToken?: string },
  ) {
    await this.auth.logout(this.readRefresh(req, body));
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    return { ok: true };
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: '내 프로필 + 소속 가구/역할' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }

  // ── helpers ──
  private readRefresh(
    req: Request,
    body?: { refreshToken?: string },
  ): string | undefined {
    return (
      (req.cookies?.[REFRESH_COOKIE] as string | undefined) ??
      body?.refreshToken
    );
  }

  private respondWithSession(session: SessionResult, res: Response) {
    const isProd = this.config.get('NODE_ENV') === 'production';
    res.cookie(REFRESH_COOKIE, session.refresh.token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: this.tokens.refreshTtlMs(),
      expires: session.refresh.expiresAt,
    });
    return {
      accessToken: session.accessToken,
      user: session.user,
      household: session.household,
    };
  }
}
