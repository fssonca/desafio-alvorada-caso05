import type { Decision, Note, Operation } from './types.js';

export function decideOperation(current: Note | null, operation: Operation): Decision {
  if (current === null) {
    if (operation.base_revision === 0) {
      return { kind: 'apply', note: { id: operation.note_id, text: operation.text, revision: 1 } };
    }
    return { kind: 'conflict', server_note: null };
  }
  if (operation.base_revision === current.revision) {
    // Validation guarantees base_revision < Number.MAX_SAFE_INTEGER, so R + 1 is always safe.
    return {
      kind: 'apply',
      note: { id: current.id, text: operation.text, revision: current.revision + 1 },
    };
  }
  return { kind: 'conflict', server_note: current };
}
