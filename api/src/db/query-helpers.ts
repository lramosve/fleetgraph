import { pool } from './client.js';
import type { QueryResultRow } from 'pg';

/**
 * Type-safe query helpers that prevent unsafe .rows[0] access
 * and provide proper generic typing for query results.
 */

/** Execute a query expecting exactly one row. Returns null if not found. */
export async function queryOne<T extends QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const result = await pool.query<T>(text, params);
  return result.rows[0] ?? null;
}

/** Execute a query expecting multiple rows. Always returns a typed array. */
export async function queryMany<T extends QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/** Execute a query expecting exactly one row. Throws if not found. */
export async function queryOneOrThrow<T extends QueryResultRow>(
  text: string,
  params?: unknown[],
  errorMessage = 'Record not found'
): Promise<T> {
  const row = await queryOne<T>(text, params);
  if (!row) {
    const error = new Error(errorMessage) as Error & { status: number };
    error.status = 404;
    throw error;
  }
  return row;
}
