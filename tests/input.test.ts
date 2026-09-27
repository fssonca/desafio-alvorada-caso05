import { describe, expect, it } from 'vitest';
import { createSyncService } from '../src/index.js';

const op = (op_id: string, note_id: string, base_revision: number, text: string) => ({
  op_id,
  note_id,
  base_revision,
  text,
});

class Foo {
  op_id = 'x';
  note_id = 'n';
  base_revision = 0;
  text = 'a';
}

describe('fronteira de entrada', () => {
  it('T10: operação inválida seguida da corrigida com mesmo ID permite processar a corrigida', () => {
    const service = createSyncService();
    const invalid = service.processOperation({ op_id: 'x', note_id: 'n', base_revision: -1, text: 'a' });
    expect(invalid.status).toBe('invalida');
    if (invalid.status === 'invalida') {
      expect(invalid.errors).toContainEqual(
        expect.objectContaining({ field: 'base_revision', code: 'invalid_revision' }),
      );
    }
    expect(service.getNote('n')).toBeNull();
    expect(service.processOperation(op('x', 'n', 0, 'a'))).toStrictEqual({
      status: 'sucesso',
      operation: op('x', 'n', 0, 'a'),
      note: { id: 'n', text: 'a', revision: 1 },
    });
  });

  it('T11: payload inválido com ID conhecido retorna invalida antes de deduplicar', () => {
    const service = createSyncService();
    const first = service.processOperation(op('x', 'n', 0, 'a'));
    const invalid = service.processOperation({
      op_id: 'x',
      note_id: 'n',
      base_revision: '0',
      text: 'a',
    });
    expect(invalid.status).toBe('invalida');
    if (invalid.status === 'invalida') {
      expect(invalid.errors).toContainEqual(
        expect.objectContaining({ field: 'base_revision', code: 'invalid_type' }),
      );
    }
    expect(service.getNote('n')).toStrictEqual({ id: 'n', text: 'a', revision: 1 });
    expect(service.processOperation(op('x', 'n', 0, 'a'))).toStrictEqual(first);
  });

  it('T18: ordem de campos e campos extras não alteram a identidade', () => {
    const service = createSyncService();
    const first = service.processOperation(op('x', 'n', 0, 'a'));
    const reordered = {
      text: 'a',
      extra: 123,
      base_revision: 0,
      note_id: 'n',
      op_id: 'x',
      get trap(): never {
        throw new Error('campo extra não deveria ser lido');
      },
    };
    expect(service.processOperation(reordered)).toStrictEqual(first);
    if (first.status === 'sucesso') {
      expect(Object.keys(first.operation)).toStrictEqual([
        'op_id',
        'note_id',
        'base_revision',
        'text',
      ]);
    } else {
      expect.unreachable('primeira operação deveria ter sucesso');
    }
  });

  describe('T19: validação por tipos e limites', () => {
    const invalidCases: ReadonlyArray<{
      name: string;
      input: unknown;
      field: string;
      code: string;
    }> = [
      { name: 'nulo', input: null, field: 'operation', code: 'not_object' },
      { name: 'string', input: 'texto', field: 'operation', code: 'not_object' },
      { name: 'array', input: [], field: 'operation', code: 'not_object' },
      { name: 'date', input: new Date(), field: 'operation', code: 'not_object' },
      { name: 'instância de classe', input: new Foo(), field: 'operation', code: 'not_object' },
      { name: 'objeto vazio', input: {}, field: 'op_id', code: 'missing_field' },
      { name: 'op_id vazio', input: op('', 'n', 0, 'a'), field: 'op_id', code: 'empty_id' },
      { name: 'op_id só espaços', input: op('   ', 'n', 0, 'a'), field: 'op_id', code: 'empty_id' },
      {
        name: 'op_id número',
        input: { op_id: 42, note_id: 'n', base_revision: 0, text: 'a' },
        field: 'op_id',
        code: 'invalid_type',
      },
      { name: 'note_id vazio', input: op('x', '', 0, 'a'), field: 'note_id', code: 'empty_id' },
      {
        name: 'note_id nulo',
        input: { op_id: 'x', note_id: null, base_revision: 0, text: 'a' },
        field: 'note_id',
        code: 'invalid_type',
      },
      {
        name: 'text número',
        input: { op_id: 'x', note_id: 'n', base_revision: 0, text: 42 },
        field: 'text',
        code: 'invalid_type',
      },
      {
        name: 'text nulo',
        input: { op_id: 'x', note_id: 'n', base_revision: 0, text: null },
        field: 'text',
        code: 'invalid_type',
      },
      {
        name: 'base string',
        input: { op_id: 'x', note_id: 'n', base_revision: '1', text: 'a' },
        field: 'base_revision',
        code: 'invalid_type',
      },
      {
        name: 'base negativa',
        input: { op_id: 'x', note_id: 'n', base_revision: -1, text: 'a' },
        field: 'base_revision',
        code: 'invalid_revision',
      },
      {
        name: 'base fracionária',
        input: { op_id: 'x', note_id: 'n', base_revision: 1.5, text: 'a' },
        field: 'base_revision',
        code: 'invalid_revision',
      },
      {
        name: 'base NaN',
        input: { op_id: 'x', note_id: 'n', base_revision: NaN, text: 'a' },
        field: 'base_revision',
        code: 'invalid_revision',
      },
      {
        name: 'base Infinity',
        input: { op_id: 'x', note_id: 'n', base_revision: Infinity, text: 'a' },
        field: 'base_revision',
        code: 'invalid_revision',
      },
      {
        name: 'base MAX_SAFE_INTEGER',
        input: { op_id: 'x', note_id: 'n', base_revision: Number.MAX_SAFE_INTEGER, text: 'a' },
        field: 'base_revision',
        code: 'invalid_revision',
      },
    ];

    it.each(invalidCases)('T19: entrada inválida ($name) retorna invalida', ({ input, field, code }) => {
      const service = createSyncService();
      const result = service.processOperation(input);
      expect(result.status).toBe('invalida');
      if (result.status === 'invalida') {
        expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field, code })]));
        if (code === 'not_object') {
          expect(result.errors).toHaveLength(1);
          expect(result.errors[0]).toMatchObject({ field: 'operation', code: 'not_object' });
        }
      }
      expect(service.getNote('n')).toBeNull();
    });

    it('T19: objeto vazio retorna 4 erros missing_field', () => {
      const service = createSyncService();
      const result = service.processOperation({});
      expect(result.status).toBe('invalida');
      if (result.status === 'invalida') {
        expect(result.errors).toHaveLength(4);
        for (const field of ['op_id', 'note_id', 'base_revision', 'text']) {
          expect(result.errors).toContainEqual(expect.objectContaining({ field, code: 'missing_field' }));
        }
      }
    });

    it('T19: texto vazio cria nota com texto vazio', () => {
      const service = createSyncService();
      const result = service.processOperation(op('x', 'n', 0, ''));
      expect(result.status).toBe('sucesso');
      expect(service.getNote('n')).toStrictEqual({ id: 'n', text: '', revision: 1 });
    });

    it('T19: texto com espaços e unicode é preservado exatamente', () => {
      const service = createSyncService();
      service.processOperation(op('x', 'n', 0, '  olá  🌱\n'));
      expect(service.getNote('n')).toStrictEqual({ id: 'n', text: '  olá  🌱\n', revision: 1 });
    });

    it('T19: op_id com espaços é preservado exatamente no recibo', () => {
      const service = createSyncService();
      const result = service.processOperation(op(' a ', 'n', 0, 'a'));
      expect(result.status).toBe('sucesso');
      if (result.status === 'sucesso') {
        expect(result.operation.op_id).toBe(' a ');
      }
    });

    it('T19: IDs com caixa diferente são IDs diferentes', () => {
      const service = createSyncService();
      expect(service.processOperation(op('Op', 'n1', 0, 'a')).status).toBe('sucesso');
      expect(service.processOperation(op('op', 'n2', 0, 'a')).status).toBe('sucesso');
    });

    it('T19: objeto com protótipo nulo é aceito', () => {
      const service = createSyncService();
      const input = Object.assign(Object.create(null), op('x', 'n', 0, 'a'));
      const result = service.processOperation(input);
      expect(result.status).toBe('sucesso');
    });

    it('T19: base MAX_SAFE_INTEGER - 1 em nota ausente é válida e conflita com null', () => {
      const service = createSyncService();
      const result = service.processOperation(
        op('x', 'n', Number.MAX_SAFE_INTEGER - 1, 'a'),
      );
      expect(result).toStrictEqual({
        status: 'conflito',
        operation: op('x', 'n', Number.MAX_SAFE_INTEGER - 1, 'a'),
        server_note: null,
      });
    });

    it('T19: valor lido uma vez é o valor validado e usado', () => {
      const service = createSyncService();
      const reads = { op_id: 0, note_id: 0, base_revision: 0, text: 0 };
      const input = {
        get op_id(): string {
          reads.op_id++;
          return 'r1';
        },
        get note_id(): string {
          reads.note_id++;
          return 'n1';
        },
        get base_revision(): number | string {
          reads.base_revision++;
          return reads.base_revision === 1 ? 0 : 'mudou';
        },
        get text(): string | number {
          reads.text++;
          return reads.text === 1 ? 'primeira' : 42;
        },
      };
      const result = service.processOperation(input);
      expect(result.status).toBe('sucesso');
      if (result.status === 'sucesso') {
        expect(result.note.text).toBe('primeira');
        expect(result.note.revision).toBe(1);
      }
      expect(reads).toStrictEqual({ op_id: 1, note_id: 1, base_revision: 1, text: 1 });
    });

    it('T19: leitura que lança retorna unreadable_input sem expor a exceção', () => {
      const service = createSyncService();
      const input = {
        get op_id(): never {
          throw new Error('boom');
        },
        note_id: 'n',
        base_revision: 0,
        text: 'a',
      };
      const result = service.processOperation(input);
      expect(result.status).toBe('invalida');
      if (result.status === 'invalida') {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ field: 'operation', code: 'unreadable_input' });
      }
      expect(JSON.stringify(result)).not.toContain('boom');
    });
  });
});
