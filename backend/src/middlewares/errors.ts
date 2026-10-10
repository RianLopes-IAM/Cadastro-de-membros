import { z } from 'zod';
import type { Request } from 'express';

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly fields?: Record<string, string[] | undefined>) {
    super(message);
  }
}

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, 'Confira os dados informados.', z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>);
  }
  return parsed.data;
}

export function routeParam(req: Request, name = 'id'): string {
  const value = req.params[name];
  if (typeof value !== 'string') throw new HttpError(400, 'Parâmetro inválido.');
  return value;
}

export function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && (
    ('errcode' in error && error.errcode === 2067) ||
    ('code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE')
  );
}
