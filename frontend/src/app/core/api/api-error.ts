import { HttpErrorResponse } from '@angular/common/http';
import { isNetworkError } from '../offline/network';

export interface ApiError {
  status: number;
  /** Código estable de la API (ej. 'NICKNAME_TAKEN') o 'NETWORK' si no hubo respuesta */
  code: string;
  /** Errores por campo cuando code === 'VALIDATION' */
  fields: Record<string, string>;
  details: Record<string, unknown>;
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof HttpErrorResponse) {
    if (isNetworkError(err)) return { status: 0, code: 'NETWORK', fields: {}, details: {} };
    const body = (typeof err.error === 'object' && err.error) || {};
    const { error, fields, ...details } = body as { error?: string; fields?: Record<string, string> };
    return { status: err.status, code: error ?? 'INTERNAL', fields: fields ?? {}, details };
  }
  return { status: 0, code: 'INTERNAL', fields: {}, details: {} };
}
