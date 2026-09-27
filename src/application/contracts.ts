import type { Note, Operation } from '../domain/types.js';

export type { Note, Operation };

export type ValidationError = Readonly<{ field: string; code: string; message: string }>;

export type Receipt =
  | Readonly<{ status: 'sucesso'; operation: Operation; note: Note }>
  | Readonly<{ status: 'conflito'; operation: Operation; server_note: Note | null }>;

export type OperationResult =
  | Receipt
  | Readonly<{ status: 'id_reutilizado'; op_id: string }>
  | Readonly<{ status: 'invalida'; errors: readonly ValidationError[] }>;

export interface SyncService {
  processOperation(input: unknown): OperationResult;
  processBatch(inputs: readonly unknown[]): readonly OperationResult[];
  getNote(noteId: string): Note | null;
}
