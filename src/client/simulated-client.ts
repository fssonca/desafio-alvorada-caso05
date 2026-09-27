import type { Note, Operation, OperationResult, SyncService } from '../application/contracts.js';

export interface SimulatedClient {
  editLocal(noteId: string, text: string): void;
  prepareOutbox(): readonly Operation[];
  applyResults(ops: readonly Operation[], results: readonly OperationResult[]): void;
  refresh(noteId: string): Note | null;
  resolveConflict(noteId: string, chosenText: string): void;
}

export type SimulatedClientOptions = Readonly<{
  service: SyncService;
  nextId: () => string;
}>;

/** Deterministic generator: 'A-1', 'A-2', ... One counter per generator, nothing global. */
export function createIdGenerator(prefix: string): () => string {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

type Draft = { text: string; base_revision: number };

type NoteState = {
  confirmed: Note | null;
  draft: Draft | null;
  conflict: { operation: Operation; server_note: Note | null; refreshedAfter: boolean } | null;
  blocked: { operation: Operation; status: 'invalida' | 'id_reutilizado' } | null;
};

function copyNote(note: Note): Note {
  return { id: note.id, text: note.text, revision: note.revision };
}

function frozenCopy(op: Operation): Operation {
  return Object.freeze({
    op_id: op.op_id,
    note_id: op.note_id,
    base_revision: op.base_revision,
    text: op.text,
  });
}

function sameOperation(a: Operation, b: Operation): boolean {
  return (
    a.op_id === b.op_id &&
    a.note_id === b.note_id &&
    a.base_revision === b.base_revision &&
    a.text === b.text
  );
}

function emptyState(): NoteState {
  return { confirmed: null, draft: null, conflict: null, blocked: null };
}

export function createSimulatedClient(options: SimulatedClientOptions): SimulatedClient {
  const service = options.service;
  const nextId = options.nextId;
  const states = new Map<string, NoteState>();
  const outbox = new Map<string, Operation>();

  function refresh(noteId: string): Note | null {
    const remote = service.getNote(noteId);
    const found = states.get(noteId);
    const state = found === undefined ? emptyState() : found;
    if (found === undefined) {
      states.set(noteId, state);
    }
    state.confirmed = remote === null ? null : copyNote(remote);
    if (state.conflict !== null) {
      state.conflict.refreshedAfter = true;
    }
    return remote === null ? null : copyNote(remote);
  }

  function editLocal(noteId: string, text: string): void {
    const state = states.get(noteId);
    if (state === undefined) {
      throw new Error('Consulte a nota com refresh antes de editar.');
    }
    if (outbox.has(noteId)) {
      throw new Error('Há uma operação pendente para esta nota; aguarde o resultado.');
    }
    if (state.conflict !== null) {
      throw new Error('Conflito não resolvido; use resolveConflict.');
    }
    if (state.blocked !== null) {
      throw new Error('Proposta bloqueada por resultado inesperado; correção manual necessária.');
    }
    if (state.draft !== null) {
      state.draft = { text, base_revision: state.draft.base_revision };
    } else {
      state.draft = { text, base_revision: state.confirmed?.revision ?? 0 };
    }
  }

  function prepareOutbox(): readonly Operation[] {
    for (const entry of states) {
      const noteId = entry[0];
      const state = entry[1];
      if (
        state.draft !== null &&
        !outbox.has(noteId) &&
        state.conflict === null &&
        state.blocked === null
      ) {
        const draft = state.draft;
        const operation = Object.freeze({
          op_id: nextId(),
          note_id: noteId,
          base_revision: draft.base_revision,
          text: draft.text,
        });
        outbox.set(noteId, operation);
        state.draft = null;
      }
    }
    return [...outbox.values()].map(frozenCopy);
  }

  function applyResults(ops: readonly Operation[], results: readonly OperationResult[]): void {
    if (ops.length !== results.length) {
      throw new Error('applyResults: ops e results devem ter o mesmo tamanho.');
    }
    const seen = new Set<string>();
    for (const entry of ops.entries()) {
      const index = entry[0];
      const op = entry[1];
      const result = results[index];
      if (op === undefined || result === undefined) {
        throw new Error('applyResults: operação não corresponde à pendente da nota.');
      }
      if (seen.has(op.note_id)) {
        throw new Error('applyResults: operação não corresponde à pendente da nota.');
      }
      seen.add(op.note_id);
      const pending = outbox.get(op.note_id);
      if (pending === undefined || !sameOperation(pending, op)) {
        throw new Error('applyResults: operação não corresponde à pendente da nota.');
      }
      if (result.status === 'sucesso' || result.status === 'conflito') {
        if (result.operation.op_id !== op.op_id) {
          throw new Error('applyResults: operação não corresponde à pendente da nota.');
        }
      } else if (result.status === 'id_reutilizado') {
        if (result.op_id !== op.op_id) {
          throw new Error('applyResults: operação não corresponde à pendente da nota.');
        }
      }
    }
    for (const entry of ops.entries()) {
      const index = entry[0];
      const op = entry[1];
      const result = results[index];
      if (op === undefined || result === undefined) {
        throw new Error('applyResults: operação não corresponde à pendente da nota.');
      }
      const pending = outbox.get(op.note_id);
      if (pending === undefined) {
        throw new Error('applyResults: operação não corresponde à pendente da nota.');
      }
      const state = states.get(op.note_id);
      if (state === undefined) {
        throw new Error('applyResults: operação não corresponde à pendente da nota.');
      }
      if (result.status === 'sucesso') {
        state.confirmed = copyNote(result.note);
        outbox.delete(op.note_id);
      } else if (result.status === 'conflito') {
        state.conflict = {
          operation: pending,
          server_note: result.server_note === null ? null : copyNote(result.server_note),
          refreshedAfter: false,
        };
        outbox.delete(op.note_id);
      } else {
        state.blocked = { operation: pending, status: result.status };
        outbox.delete(op.note_id);
      }
    }
  }

  function resolveConflict(noteId: string, chosenText: string): void {
    const state = states.get(noteId);
    if (state === undefined || state.conflict === null) {
      throw new Error('Não há conflito registrado para esta nota.');
    }
    if (!state.conflict.refreshedAfter) {
      throw new Error('Consulte a nota com refresh antes de resolver o conflito.');
    }
    state.conflict = null;
    state.draft = { text: chosenText, base_revision: state.confirmed?.revision ?? 0 };
  }

  return { editLocal, prepareOutbox, applyResults, refresh, resolveConflict };
}
