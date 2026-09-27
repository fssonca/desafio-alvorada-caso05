import type { Operation } from '../domain/types.js';
import type { ValidationError } from './contracts.js';

export type ReadResult =
  | Readonly<{ ok: true; operation: Operation }>
  | Readonly<{ ok: false; errors: readonly ValidationError[] }>;

const FIELDS = ['op_id', 'note_id', 'base_revision', 'text'] as const;
type FieldName = (typeof FIELDS)[number];

type Extracted =
  | { kind: 'not_object' }
  | { kind: 'fields'; values: Partial<Record<FieldName, unknown>>; missing: FieldName[] };

export function unreadableError(): ValidationError {
  return { field: 'operation', code: 'unreadable_input', message: 'Não foi possível ler a operação.' };
}

/**
 * The only part that touches the caller's input. It may throw (Proxy, getter),
 * which is why it is the only thing inside readOperation's try/catch.
 * Each field is read ONCE and stored in `values`.
 */
function extract(input: unknown): Extracted {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { kind: 'not_object' };
  }
  const proto: unknown = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) {
    return { kind: 'not_object' };
  }
  const values: Partial<Record<FieldName, unknown>> = {};
  const missing: FieldName[] = [];
  for (const field of FIELDS) {
    if (Object.hasOwn(input, field)) {
      values[field] = (input as Record<string, unknown>)[field]; // single read
    } else {
      missing.push(field);
    }
  }
  return { kind: 'fields', values, missing };
}

function validate(extracted: Extracted): ReadResult {
  if (extracted.kind === 'not_object') {
    return {
      ok: false,
      errors: [
        { field: 'operation', code: 'not_object', message: 'Operação deve ser um objeto válido.' },
      ],
    };
  }
  const errors: ValidationError[] = [];
  for (const field of extracted.missing) {
    errors.push({ field, code: 'missing_field', message: 'Campo obrigatório ausente.' });
  }
  const values = extracted.values;
  let opId: string | undefined;
  let noteId: string | undefined;
  let baseRevision: number | undefined;
  let textValue: string | undefined;

  if (!extracted.missing.includes('op_id')) {
    const value = values.op_id;
    if (typeof value !== 'string') {
      errors.push({ field: 'op_id', code: 'invalid_type', message: 'Tipo inválido para o campo.' });
    } else if (value.trim() === '') {
      errors.push({ field: 'op_id', code: 'empty_id', message: 'Identificador não pode ser vazio.' });
    } else {
      opId = value;
    }
  }

  if (!extracted.missing.includes('note_id')) {
    const value = values.note_id;
    if (typeof value !== 'string') {
      errors.push({ field: 'note_id', code: 'invalid_type', message: 'Tipo inválido para o campo.' });
    } else if (value.trim() === '') {
      errors.push({
        field: 'note_id',
        code: 'empty_id',
        message: 'Identificador não pode ser vazio.',
      });
    } else {
      noteId = value;
    }
  }

  if (!extracted.missing.includes('base_revision')) {
    const value = values.base_revision;
    if (typeof value !== 'number') {
      errors.push({
        field: 'base_revision',
        code: 'invalid_type',
        message: 'Tipo inválido para o campo.',
      });
    } else {
      const normalized = value === 0 ? 0 : value;
      if (
        !Number.isSafeInteger(normalized) ||
        normalized < 0 ||
        normalized >= Number.MAX_SAFE_INTEGER
      ) {
        errors.push({
          field: 'base_revision',
          code: 'invalid_revision',
          message: 'Revisão base inválida.',
        });
      } else {
        baseRevision = normalized;
      }
    }
  }

  if (!extracted.missing.includes('text')) {
    const value = values.text;
    if (typeof value !== 'string') {
      errors.push({ field: 'text', code: 'invalid_type', message: 'Tipo inválido para o campo.' });
    } else {
      textValue = value;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  if (
    opId === undefined ||
    noteId === undefined ||
    baseRevision === undefined ||
    textValue === undefined
  ) {
    // Unreachable: every field was present and valid, so all locals are set.
    throw new Error('validação interna inconsistente.');
  }
  return {
    ok: true,
    operation: { op_id: opId, note_id: noteId, base_revision: baseRevision, text: textValue },
  };
}

export function readOperation(input: unknown): ReadResult {
  let extracted: Extracted;
  try {
    extracted = extract(input);
  } catch {
    return { ok: false, errors: [unreadableError()] };
  }
  // From here on there are only already-extracted primitives: nothing should throw,
  // and if something does it is a bug and must surface (outside the catch).
  return validate(extracted);
}
