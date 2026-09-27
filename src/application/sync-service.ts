import { decideOperation } from '../domain/decide-operation.js';
import type { Note, Operation } from '../domain/types.js';
import type { OperationResult, Receipt, SyncService } from './contracts.js';
import { readOperation, unreadableError } from './read-operation.js';

function copyNote(note: Note): Note {
  return { id: note.id, text: note.text, revision: note.revision };
}

function copyOperation(op: Operation): Operation {
  return { op_id: op.op_id, note_id: op.note_id, base_revision: op.base_revision, text: op.text };
}

function copyReceipt(receipt: Receipt): Receipt {
  if (receipt.status === 'sucesso') {
    return { status: 'sucesso', operation: copyOperation(receipt.operation), note: copyNote(receipt.note) };
  }
  return {
    status: 'conflito',
    operation: copyOperation(receipt.operation),
    server_note: receipt.server_note === null ? null : copyNote(receipt.server_note),
  };
}

function readBatchLength(inputs: unknown): number {
  let isArray: boolean;
  let length: unknown;
  try {
    isArray = Array.isArray(inputs);
    if (Array.isArray(inputs)) {
      length = inputs.length;
    }
  } catch {
    throw new TypeError('processBatch: não foi possível ler o lote.');
  }
  if (!isArray) {
    throw new TypeError('processBatch espera um array.');
  }
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
    throw new TypeError('processBatch: não foi possível ler o lote.');
  }
  return length;
}

export function createSyncService(): SyncService {
  const notes = new Map<string, Note>(); // current state
  const receipts = new Map<string, Receipt>(); // first result of each valid op_id

  function processOperation(input: unknown): OperationResult {
    const read = readOperation(input);
    if (!read.ok) {
      return {
        status: 'invalida',
        errors: read.errors.map((e) => ({ field: e.field, code: e.code, message: e.message })),
      };
    }
    const op = read.operation;

    const existing = receipts.get(op.op_id);
    if (existing !== undefined) {
      const same =
        existing.operation.op_id === op.op_id &&
        existing.operation.note_id === op.note_id &&
        existing.operation.base_revision === op.base_revision &&
        existing.operation.text === op.text;
      if (same) {
        return copyReceipt(existing);
      }
      return { status: 'id_reutilizado', op_id: op.op_id };
    }

    const current = notes.get(op.note_id) ?? null;
    const decision = decideOperation(current, op);
    let receipt: Receipt;
    if (decision.kind === 'apply') {
      receipt = { status: 'sucesso', operation: op, note: decision.note };
    } else {
      receipt = { status: 'conflito', operation: op, server_note: decision.server_note };
    }
    if (receipt.status === 'sucesso') {
      notes.set(op.note_id, receipt.note);
    }
    receipts.set(op.op_id, receipt);
    return copyReceipt(receipt);
  }

  function processBatch(inputs: readonly unknown[]): readonly OperationResult[] {
    const length = readBatchLength(inputs); // throws TypeError if it is not a readable array
    const results: OperationResult[] = [];
    for (let index = 0; index < length; index++) {
      let item: unknown;
      try {
        item = inputs[index]; // only reading the position is inside the try
      } catch {
        results.push({ status: 'invalida', errors: [unreadableError()] });
        continue;
      }
      results.push(processOperation(item)); // OUTSIDE the try
    }
    return results;
  }

  function getNote(noteId: string): Note | null {
    const found = notes.get(noteId);
    if (found === undefined) {
      return null;
    }
    return copyNote(found);
  }

  return { processOperation, processBatch, getNote };
}
