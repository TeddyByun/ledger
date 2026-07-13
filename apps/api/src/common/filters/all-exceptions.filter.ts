import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

/** HTTP 상태 → 기본 에러 코드 (API_CONVENTIONS_DESIGN §2.2). */
const STATUS_CODE: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  500: 'INTERNAL',
};

const CODE_RE = /^[A-Z][A-Z0-9_]+$/;

interface ErrorDetail {
  message: string;
  field?: string;
}

/**
 * 전역 예외 필터 → 표준 에러 봉투 (API_CONVENTIONS_DESIGN §2).
 * { error: { code, message, details?, traceId } }
 * - 분기는 문구/상태코드가 아닌 error.code 기준.
 * - 서비스가 SCREAMING_SNAKE 문자열을 throw 하면 그대로 code 로 사용.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId = (req.headers['x-trace-id'] as string) ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL';
    let message = '일시적인 오류가 발생했습니다.';
    let details: ErrorDetail[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODE[status] ?? 'ERROR';
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: unknown; error?: unknown };
        // class-validator: message 가 문자열 배열 → 필드 검증 실패
        if (Array.isArray(b.message)) {
          code = 'VALIDATION_FAILED';
          message = '입력값 검증에 실패했습니다.';
          details = b.message.map((m) => ({ message: String(m) }));
        } else if (typeof b.message === 'string') {
          message = b.message;
        }
      }
      // 서비스가 던진 코드형 문자열(예: EMAIL_TAKEN)이면 code 로 승격
      if (CODE_RE.test(message)) {
        code = message;
      }
    } else {
      // 예상 못 한 오류 → 내부 상세는 숨기고 로그+traceId 로만
      this.logger.error(
        `[${traceId}] ${(exception as Error)?.message ?? exception}`,
        (exception as Error)?.stack,
      );
    }

    res.setHeader('X-Trace-Id', traceId);
    res.status(status).json({ error: { code, message, details, traceId } });
  }
}
