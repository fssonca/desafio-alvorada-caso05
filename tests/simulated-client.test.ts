import { describe, expect, it } from 'vitest';
import {
  createIdGenerator,
  createSimulatedClient,
  createSyncService,
} from '../src/index.js';
import type { SimulatedClient } from '../src/index.js';

function setup() {
  const service = createSyncService();
  const a = createSimulatedClient({ service, nextId: createIdGenerator('A') });
  const b = createSimulatedClient({ service, nextId: createIdGenerator('B') });
  const send = (client: SimulatedClient) => {
    const ops = client.prepareOutbox();
    const results = service.processBatch(ops);
    client.applyResults(ops, results);
    return results;
  };
  return { service, a, b, send };
}

describe('cliente simulado', () => {
  it('T22: limitação — presumir revisão sobrescreve o trabalho de outro dispositivo', () => {
    // characterizes the limitation; the server follows the protocol, prevention belongs to the client (T23)
    const { service } = setup();
    service.processOperation({ op_id: 'C0', note_id: 'N', base_revision: 0, text: 'início' });
    expect(service.processOperation({ op_id: 'B1', note_id: 'N', base_revision: 1, text: 'trabalho de B' })).toStrictEqual({
      status: 'sucesso',
      operation: { op_id: 'B1', note_id: 'N', base_revision: 1, text: 'trabalho de B' },
      note: { id: 'N', text: 'trabalho de B', revision: 2 },
    });
    const results = service.processBatch([
      { op_id: 'A1', note_id: 'N', base_revision: 1, text: 'A1' },
      { op_id: 'A2', note_id: 'N', base_revision: 2, text: 'A2' },
    ]);
    expect(results).toStrictEqual([
      {
        status: 'conflito',
        operation: { op_id: 'A1', note_id: 'N', base_revision: 1, text: 'A1' },
        server_note: { id: 'N', text: 'trabalho de B', revision: 2 },
      },
      {
        status: 'sucesso',
        operation: { op_id: 'A2', note_id: 'N', base_revision: 2, text: 'A2' },
        note: { id: 'N', text: 'A2', revision: 3 },
      },
    ]);
    expect(service.getNote('N')).toStrictEqual({ id: 'N', text: 'A2', revision: 3 });
  });

  it('T23a: edições locais repetidas viram um rascunho com base confirmada', () => {
    const { service, a, send } = setup();
    expect(a.refresh('N')).toBeNull();
    a.editLocal('N', 'v1');
    send(a);
    expect(service.getNote('N')).toStrictEqual({ id: 'N', text: 'v1', revision: 1 });
    a.editLocal('N', 'x1');
    a.editLocal('N', 'x2');
    const ops = a.prepareOutbox();
    expect(ops).toStrictEqual([{ op_id: 'A-2', note_id: 'N', base_revision: 1, text: 'x2' }]);
    expect(a.prepareOutbox()).toStrictEqual(ops);
    expect(() => a.editLocal('N', 'x3')).toThrow(/pendente/);
  });

  it('T23b: refresh não muda a base de um rascunho existente', () => {
    const { service, a, b, send } = setup();
    a.refresh('N');
    a.editLocal('N', 'v1');
    send(a);
    b.refresh('N');
    a.editLocal('N', 'de A');
    b.editLocal('N', 'de B');
    send(b);
    expect(a.refresh('N')).toStrictEqual({ id: 'N', text: 'de B', revision: 2 });
    const ops = a.prepareOutbox();
    expect(ops.length).toBe(1);
    expect(ops[0]).toMatchObject({ base_revision: 1, text: 'de A' });
    const results = service.processBatch(ops);
    a.applyResults(ops, results);
    expect(results[0]).toMatchObject({ status: 'conflito' });
    expect(service.getNote('N')).toStrictEqual({ id: 'N', text: 'de B', revision: 2 });
  });

  it('T23c: conflito bloqueia até refresh e escolha explícita', () => {
    const { service, a, b, send } = setup();
    a.refresh('N');
    a.editLocal('N', 'v1');
    send(a);
    b.refresh('N');
    a.editLocal('N', 'de A');
    b.editLocal('N', 'de B');
    send(b);
    a.refresh('N');
    const ops = a.prepareOutbox();
    const results = service.processBatch(ops);
    a.applyResults(ops, results);
    expect(a.prepareOutbox()).toStrictEqual([]);
    expect(() => a.editLocal('N', 'y')).toThrow(/Conflito/);
    expect(() => a.resolveConflict('N', 'final')).toThrow(/refresh/);
    a.refresh('N');
    a.resolveConflict('N', 'final');
    const ops2 = a.prepareOutbox();
    expect(ops2.length).toBe(1);
    expect(ops2[0]?.op_id).not.toBe(ops[0]?.op_id);
    expect(ops2[0]).toMatchObject({ note_id: 'N', base_revision: 2, text: 'final' });
    const results2 = service.processBatch(ops2);
    a.applyResults(ops2, results2);
    expect(results2[0]).toMatchObject({ status: 'sucesso' });
    expect(service.getNote('N')).toStrictEqual({ id: 'N', text: 'final', revision: 3 });
  });

  it('T23d: editar sem consultar antes é erro local', () => {
    const { a } = setup();
    expect(() => a.editLocal('Z', 't')).toThrow(/refresh/);
  });

  it('T23e: nota ausente começa com base 0', () => {
    const { service, a, send } = setup();
    expect(a.refresh('nova')).toBeNull();
    a.editLocal('nova', 't');
    expect(a.prepareOutbox()).toStrictEqual([{ op_id: 'A-1', note_id: 'nova', base_revision: 0, text: 't' }]);
    send(a);
    expect(service.getNote('nova')).toStrictEqual({ id: 'nova', text: 't', revision: 1 });
  });

  it('T23f: segunda edição após refresh mantém a base confirmada', () => {
    const ctx = setup();
    ctx.a.refresh('N');
    ctx.a.editLocal('N', 'v1');
    ctx.send(ctx.a);
    ctx.b.refresh('N');
    ctx.a.editLocal('N', 'primeira edição');
    ctx.b.editLocal('N', 'de B');
    ctx.send(ctx.b);
    ctx.a.refresh('N');
    ctx.a.editLocal('N', 'segunda edição');
    expect(ctx.a.prepareOutbox()).toStrictEqual([
      { op_id: 'A-2', note_id: 'N', base_revision: 1, text: 'segunda edição' },
    ]);
  });

  it('T23g: applyResults rejeita sem aplicar nada', () => {
    // Duplicated pair: it applied N and then threw, leaving M pending.
    const ctx1 = setup();
    ctx1.a.refresh('N');
    ctx1.a.refresh('M');
    ctx1.a.editLocal('N', 'tn');
    ctx1.a.editLocal('M', 'tm');
    const ops = ctx1.a.prepareOutbox();
    const results = ctx1.service.processBatch(ops);
    const opN = ops[0];
    const opM = ops[1];
    const resN = results[0];
    const resM = results[1];
    if (opN === undefined || opM === undefined || resN === undefined || resM === undefined) {
      throw new Error('falha na montagem do teste T23g.');
    }
    expect(() => ctx1.a.applyResults([opN, opN, opM], [resN, resN, resM])).toThrow(/não corresponde/);
    expect(ctx1.a.prepareOutbox()).toStrictEqual(ops);

    // Result with an op_id different from the operation.
    const ctx2 = setup();
    ctx2.a.refresh('N');
    ctx2.a.editLocal('N', 't');
    const ops2 = ctx2.a.prepareOutbox();
    const op2 = ops2[0];
    if (op2 === undefined) {
      throw new Error('falha na montagem do teste T23g.');
    }
    expect(() => ctx2.a.applyResults([op2], [{ status: 'id_reutilizado', op_id: 'outro-id' }])).toThrow(
      /não corresponde/,
    );
    expect(ctx2.a.prepareOutbox()).toStrictEqual(ops2);

    // Operation that is not pending.
    const ctx3 = setup();
    ctx3.a.refresh('N');
    ctx3.a.editLocal('N', 't');
    const ops3 = ctx3.a.prepareOutbox();
    const results3 = ctx3.service.processBatch(ops3);
    const res3 = results3[0];
    if (res3 === undefined) {
      throw new Error('falha na montagem do teste T23g.');
    }
    const fakeOp = { op_id: 'A-999', note_id: 'N', base_revision: 1, text: 'falsa' };
    expect(() => ctx3.a.applyResults([fakeOp], [res3])).toThrow(/não corresponde/);
    expect(ctx3.a.prepareOutbox()).toStrictEqual(ops3);
  });

  it('T23h: resultado inesperado bloqueia a nota até correção manual', () => {
    const ctx1 = setup();
    ctx1.a.refresh('N');
    ctx1.a.editLocal('N', 't');
    const ops1 = ctx1.a.prepareOutbox();
    ctx1.a.applyResults(ops1, [{ status: 'invalida', errors: [] }]);
    expect(ctx1.a.prepareOutbox()).toStrictEqual([]);
    expect(() => ctx1.a.editLocal('N', 'x')).toThrow(/bloqueada/);

    const ctx2 = setup();
    ctx2.a.refresh('N');
    ctx2.a.editLocal('N', 't');
    const ops2 = ctx2.a.prepareOutbox();
    const op2 = ops2[0];
    if (op2 === undefined) {
      throw new Error('falha na montagem do teste T23h.');
    }
    ctx2.a.applyResults(ops2, [{ status: 'id_reutilizado', op_id: op2.op_id }]);
    expect(ctx2.a.prepareOutbox()).toStrictEqual([]);
    expect(() => ctx2.a.editLocal('N', 'x')).toThrow(/bloqueada/);
  });
});
