import { describe, expect, it } from 'vitest';
import { createSyncService } from '../src/index.js';

const op = (op_id: string, note_id: string, base_revision: number, text: string) => ({
  op_id,
  note_id,
  base_revision,
  text,
});
const note = (id: string, text: string, revision: number) => ({ id, text, revision });

describe('protocolo do servidor', () => {
  it('T00: exemplo oficial completo com reenvios e reutilização', () => {
    const service = createSyncService();
    const r1 = service.processOperation(op('O1', 'N', 0, 'início'));
    expect(r1).toStrictEqual({ status: 'sucesso', operation: op('O1', 'N', 0, 'início'), note: note('N', 'início', 1) });
    const r2 = service.processOperation(op('O2', 'N', 1, 'edição A'));
    expect(r2).toStrictEqual({
      status: 'sucesso',
      operation: op('O2', 'N', 1, 'edição A'),
      note: note('N', 'edição A', 2),
    });
    const r3 = service.processOperation(op('O3', 'N', 1, 'edição B'));
    expect(r3).toStrictEqual({
      status: 'conflito',
      operation: op('O3', 'N', 1, 'edição B'),
      server_note: note('N', 'edição A', 2),
    });
    expect(service.processOperation(op('O2', 'N', 1, 'edição A'))).toStrictEqual(r2);
    const r4 = service.processOperation(op('O4', 'N', 2, 'A + B'));
    expect(r4).toStrictEqual({
      status: 'sucesso',
      operation: op('O4', 'N', 2, 'A + B'),
      note: note('N', 'A + B', 3),
    });
    expect(service.processOperation(op('O3', 'N', 1, 'edição B'))).toStrictEqual(r3);
    expect(service.getNote('N')).toStrictEqual(note('N', 'A + B', 3));
    expect(service.processOperation(op('O2', 'N', 1, 'outro texto'))).toStrictEqual({
      status: 'id_reutilizado',
      op_id: 'O2',
    });
    expect(service.getNote('N')).toStrictEqual(note('N', 'A + B', 3));
  });

  it('T01: servidor inicia vazio e base 0 cria revisão 1', () => {
    const service = createSyncService();
    expect(service.getNote('N')).toBeNull();
    expect(service.processOperation(op('c1', 'N', 0, 'olá'))).toStrictEqual({
      status: 'sucesso',
      operation: op('c1', 'N', 0, 'olá'),
      note: note('N', 'olá', 1),
    });
  });

  it('T02: atualização com base atual produz texto e revisão seguintes', () => {
    const service = createSyncService();
    service.processOperation(op('c1', 'N', 0, 'olá'));
    expect(service.processOperation(op('u1', 'N', 1, 'novo'))).toStrictEqual({
      status: 'sucesso',
      operation: op('u1', 'N', 1, 'novo'),
      note: note('N', 'novo', 2),
    });
    expect(service.getNote('N')).toStrictEqual(note('N', 'novo', 2));
  });

  it('T03: texto idêntico com novo ID também incrementa a revisão', () => {
    const service = createSyncService();
    service.processOperation(op('c1', 'N', 0, 'x'));
    expect(service.processOperation(op('u1', 'N', 1, 'x'))).toStrictEqual({
      status: 'sucesso',
      operation: op('u1', 'N', 1, 'x'),
      note: note('N', 'x', 2),
    });
  });

  it('T04: base antiga, futura ou zero em nota existente conflita e preserva estado', () => {
    const service = createSyncService();
    service.processOperation(op('c1', 'N', 0, 'v1'));
    service.processOperation(op('u1', 'N', 1, 'v2'));
    const bases: ReadonlyArray<{ id: string; base: number }> = [
      { id: 'k1', base: 1 },
      { id: 'k5', base: 5 },
      { id: 'k0', base: 0 },
    ];
    for (const { id, base } of bases) {
      expect(service.processOperation(op(id, 'N', base, 'outro'))).toStrictEqual({
        status: 'conflito',
        operation: op(id, 'N', base, 'outro'),
        server_note: note('N', 'v2', 2),
      });
    }
    expect(service.getNote('N')).toStrictEqual(note('N', 'v2', 2));
  });

  it('T05: base positiva em nota ausente conflita com server_note null', () => {
    const service = createSyncService();
    expect(service.processOperation(op('p1', 'ausente', 3, 't'))).toStrictEqual({
      status: 'conflito',
      operation: op('p1', 'ausente', 3, 't'),
      server_note: null,
    });
    expect(service.getNote('ausente')).toBeNull();
  });

  it('T06: reenvio de sucesso após mudanças devolve o recibo original', () => {
    const service = createSyncService();
    service.processOperation(op('O1', 'N', 0, 'v1'));
    const r2 = service.processOperation(op('O2', 'N', 1, 'v2'));
    service.processOperation(op('O3', 'N', 2, 'v3'));
    expect(service.processOperation(op('O2', 'N', 1, 'v2'))).toStrictEqual(r2);
    expect(service.getNote('N')).toStrictEqual(note('N', 'v3', 3));
  });

  it('T07: reenvio de conflito após resolução devolve o conflito original', () => {
    // detects a recomputed replay instead of the stored receipt
    const service = createSyncService();
    service.processOperation(op('C', 'N', 0, 'base'));
    service.processOperation(op('A', 'N', 1, 'de A'));
    const conflict = service.processOperation(op('B', 'N', 1, 'de B'));
    expect(conflict).toStrictEqual({
      status: 'conflito',
      operation: op('B', 'N', 1, 'de B'),
      server_note: note('N', 'de A', 2),
    });
    service.processOperation(op('R', 'N', 2, 'resolvido'));
    const replay = service.processOperation(op('B', 'N', 1, 'de B'));
    expect(replay).toStrictEqual(conflict);
    if (replay.status === 'conflito' && replay.server_note !== null) {
      expect(replay.server_note.revision).toBe(2);
      expect(replay.operation.text).toBe('de B');
    } else {
      expect.unreachable('reenvio deveria devolver o conflito original com revisão 2');
    }
    expect(service.getNote('N')).toStrictEqual(note('N', 'resolvido', 3));
  });

  it('T08: reenvio de conflito por ausência continua com null após criação', () => {
    const service = createSyncService();
    const first = service.processOperation(op('p', 'N', 2, 'cedo'));
    expect(first).toStrictEqual({ status: 'conflito', operation: op('p', 'N', 2, 'cedo'), server_note: null });
    service.processOperation(op('c', 'N', 0, 'agora'));
    expect(service.processOperation(op('p', 'N', 2, 'cedo'))).toStrictEqual(first);
  });

  it('T09: reutilizar ID com conteúdo diferente é rejeitado e preserva o original', () => {
    const service = createSyncService();
    const orig = service.processOperation(op('x', 'N', 0, 'a'));
    expect(service.processOperation(op('x', 'N', 0, 'b'))).toStrictEqual({
      status: 'id_reutilizado',
      op_id: 'x',
    });
    expect(service.processOperation(op('x', 'M', 0, 'a'))).toStrictEqual({
      status: 'id_reutilizado',
      op_id: 'x',
    });
    expect(service.processOperation(op('x', 'N', 1, 'a'))).toStrictEqual({
      status: 'id_reutilizado',
      op_id: 'x',
    });
    expect(service.getNote('M')).toBeNull();
    expect(service.getNote('N')).toStrictEqual(note('N', 'a', 1));
    expect(service.processOperation(op('x', 'N', 0, 'a'))).toStrictEqual(orig);
  });

  it('T12: lote continua após inválida, conflito e leituras que lançam', () => {
    const service = createSyncService();
    const batch: unknown[] = [
      op('v1', 'n1', 0, 'um'),
      {},
      op('c1', 'n1', 5, 'conflito'),
      {
        get op_id(): string {
          throw new Error('boom');
        },
        note_id: 'n9',
        base_revision: 0,
        text: 'x',
      },
    ];
    Object.defineProperty(batch, 4, {
      get(): unknown {
        throw new Error('boom no índice');
      },
      enumerable: true,
      configurable: true,
    });
    batch.push(op('v2', 'n2', 0, 'dois'));
    const results = service.processBatch(batch);
    expect(results.length).toBe(6);
    expect(results.map((r) => r.status)).toStrictEqual([
      'sucesso',
      'invalida',
      'conflito',
      'invalida',
      'invalida',
      'sucesso',
    ]);
    const third = results[3];
    const fourth = results[4];
    expect(third !== undefined && third.status).toBe('invalida');
    expect(fourth !== undefined && fourth.status).toBe('invalida');
    if (third !== undefined && third.status === 'invalida' && fourth !== undefined && fourth.status === 'invalida') {
      expect(third.errors).toContainEqual(expect.objectContaining({ code: 'unreadable_input' }));
      expect(fourth.errors).toContainEqual(expect.objectContaining({ code: 'unreadable_input' }));
    }
    expect(JSON.stringify(results)).not.toContain('boom');
    expect(service.getNote('n1')).toStrictEqual(note('n1', 'um', 1));
    expect(service.getNote('n2')).toStrictEqual(note('n2', 'dois', 1));
    expect(service.getNote('n9')).toBeNull();
  });

  it('T13: dois clientes com base 1 no mesmo lote — primeira aceita, segunda conflita', () => {
    const service = createSyncService();
    service.processOperation(op('c1', 'N', 0, 'v1'));
    const results = service.processBatch([op('a1', 'N', 1, 'de A'), op('b1', 'N', 1, 'de B')]);
    expect(results).toStrictEqual([
      { status: 'sucesso', operation: op('a1', 'N', 1, 'de A'), note: note('N', 'de A', 2) },
      { status: 'conflito', operation: op('b1', 'N', 1, 'de B'), server_note: note('N', 'de A', 2) },
    ]);
  });

  it('T14: resolução explícita com novo ID e base atual funciona', () => {
    const service = createSyncService();
    service.processOperation(op('c1', 'N', 0, 'v1'));
    service.processBatch([op('a1', 'N', 1, 'de A'), op('b1', 'N', 1, 'de B')]);
    expect(service.processOperation(op('b2', 'N', 2, 'texto escolhido'))).toStrictEqual({
      status: 'sucesso',
      operation: op('b2', 'N', 2, 'texto escolhido'),
      note: note('N', 'texto escolhido', 3),
    });
  });

  it('T15: mutar a entrada original após a chamada não altera o servidor', () => {
    const service = createSyncService();
    const input = { op_id: 'x', note_id: 'N', base_revision: 0, text: 'original' };
    const first = service.processOperation(input);
    input.text = 'mutado';
    input.base_revision = 99;
    expect(service.getNote('N')).toStrictEqual(note('N', 'original', 1));
    expect(service.processOperation(op('x', 'N', 0, 'original'))).toStrictEqual(first);
  });

  it('T16: mutar resultados e consultas não altera o estado interno', () => {
    // detects leaked internal references
    const service = createSyncService();
    const r1 = service.processOperation(op('x', 'N', 0, 'original'));
    expect(r1.status).toBe('sucesso');
    const mutableR1 = r1 as unknown as {
      note: { text: string; revision: number };
      operation: { text: string };
    };
    mutableR1.note.text = 'hack';
    mutableR1.note.revision = 99;
    mutableR1.operation.text = 'hack';
    const queried = service.getNote('N') as unknown as { text: string; revision: number } | null;
    expect(queried).not.toBeNull();
    if (queried !== null) {
      queried.text = 'hack';
      queried.revision = 99;
    }
    const conflict = service.processOperation(op('y', 'N', 0, 'z'));
    expect(conflict.status).toBe('conflito');
    const mutableConflict = conflict as unknown as { server_note: { text: string } | null };
    if (mutableConflict.server_note !== null) {
      mutableConflict.server_note.text = 'hack';
    }
    expect(service.getNote('N')).toStrictEqual(note('N', 'original', 1));
    expect(service.processOperation(op('x', 'N', 0, 'original'))).toStrictEqual({
      status: 'sucesso',
      operation: op('x', 'N', 0, 'original'),
      note: note('N', 'original', 1),
    });
    expect(service.processOperation(op('y', 'N', 0, 'z'))).toStrictEqual({
      status: 'conflito',
      operation: op('y', 'N', 0, 'z'),
      server_note: note('N', 'original', 1),
    });
    const replay = service.processOperation(op('x', 'N', 0, 'original'));
    const mutableReplay = replay as unknown as {
      note: { text: string; revision: number };
      operation: { text: string };
    };
    if (replay.status === 'sucesso') {
      mutableReplay.note.text = 'hack';
      mutableReplay.note.revision = 99;
      mutableReplay.operation.text = 'hack';
    } else {
      expect.unreachable('reenvio de x deveria devolver sucesso');
    }
    expect(service.getNote('N')).toStrictEqual(note('N', 'original', 1));
    expect(service.processOperation(op('x', 'N', 0, 'original'))).toStrictEqual({
      status: 'sucesso',
      operation: op('x', 'N', 0, 'original'),
      note: note('N', 'original', 1),
    });
  });

  it('T17: instâncias independentes e lote vazio funcionam', () => {
    const s1 = createSyncService();
    const s2 = createSyncService();
    s1.processOperation(op('x', 'N', 0, 'a'));
    expect(s2.getNote('N')).toBeNull();
    expect(s2.processOperation(op('x', 'N', 0, 'b'))).toStrictEqual({
      status: 'sucesso',
      operation: op('x', 'N', 0, 'b'),
      note: note('N', 'b', 1),
    });
    expect(s1.processBatch([])).toStrictEqual([]);
  });

  it('T20: operação duplicada no lote retorna replay com um só efeito', () => {
    const service = createSyncService();
    service.processOperation(op('c1', 'N', 0, 'v1'));
    const u = op('u', 'N', 1, 'novo');
    const results = service.processBatch([u, { ...u }]);
    const a = results[0];
    const b = results[1];
    expect(a).toStrictEqual({ status: 'sucesso', operation: u, note: note('N', 'novo', 2) });
    expect(b).toStrictEqual(a);
    expect(service.getNote('N')).toStrictEqual(note('N', 'novo', 2));
  });

  it('T21: mesmo ID com conteúdo diferente no lote retorna id_reutilizado', () => {
    const service = createSyncService();
    const results = service.processBatch([op('x', 'N', 0, 'a'), op('x', 'N', 0, 'b')]);
    expect(results).toStrictEqual([
      { status: 'sucesso', operation: op('x', 'N', 0, 'a'), note: note('N', 'a', 1) },
      { status: 'id_reutilizado', op_id: 'x' },
    ]);
    expect(service.getNote('N')).toStrictEqual(note('N', 'a', 1));
  });
});
