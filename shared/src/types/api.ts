// API types - discriminated union prevents invalid states
export type ApiResponse<T = unknown> =
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: ApiError };

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

