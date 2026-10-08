import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  requestId?: string;
  timestamp: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();

    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';

    let error = HttpStatus[statusCode] ?? 'Error';
    let message: string | string[] = statusCode >= 500 ? 'Internal server error' : 'Request failed';

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const body = exceptionResponse as { error?: unknown; message?: unknown };
      if (typeof body.error === 'string') error = body.error;
      if (
        typeof body.message === 'string' ||
        (Array.isArray(body.message) && body.message.every((item) => typeof item === 'string'))
      ) {
        message = body.message;
      }
    }

    const requestIdHeader = request.headers['x-request-id'];
    const body: ErrorResponseBody = {
      statusCode,
      error,
      message,
      path: request.originalUrl || request.url,
      requestId: typeof requestIdHeader === 'string' ? requestIdHeader : undefined,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(body);
  }
}
