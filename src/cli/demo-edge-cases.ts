import { isDeepStrictEqual } from 'node:util';
import { createIdGenerator, createSimulatedClient, createSyncService } from '../index.js';
import type { Operation, SimulatedClient } from '../index.js';

function main(): void {
  let checks = 0;
  let failures = 0;

  function step(title: string, explanation: string): void {
    console.log(`\n== ${title} ==\n   ${explanation}`);
  }

  function check(label: string, expected: unknown, observed: unknown): void {
    checks++;
    const ok = isDeepStrictEqual(expected, observed);
    if (!ok) failures++;
    console.log(`${ok ? '[OK]' : '[FALHOU]'} ${label}`);
    console.log(`   esperado:  ${JSON.stringify(expected)}`);
    console.log(`   observado: ${JSON.stringify(observed)}`);
  }

  function checkError(label: string, expected: string, action: () => void): void {
    let observed: string | null = null;
    try {
      action();
    } catch (error) {
      observed = error instanceof Error ? error.message : String(error);
    }
    check(label, expected, observed);
  }

  const service = createSyncService();
  const a = createSimulatedClient({ service, nextId: createIdGenerator('A') });
  const b = createSimulatedClient({ service, nextId: createIdGenerator('B') });
  const op = (op_id: string, note_id: string, base_revision: number, text: string): Operation =>
    ({ op_id, note_id, base_revision, text });
  const note = (id: string, text: string, revision: number) => ({ id, text, revision });

  function send(client: SimulatedClient) {
    const ops = client.prepareOutbox();
    const results = service.processBatch(ops);
    client.applyResults(ops, results);
    return results;
  }

  step('Passo 1 — Proposta chega antes da criação',
    'Uma oficina ainda não tem roteiro. Base 1 deve conflitar com ausência e reservar o ID.');
  const early = op('ANT-1', 'roteiro', 1, 'abrir às 9h');
  check('consulta inicial não encontra a nota', null, service.getNote('roteiro'));
  check('base positiva em nota ausente preserva a proposta', {
    status: 'conflito', operation: early, server_note: null,
  }, service.processOperation(early));

  step('Passo 2 — Dois dispositivos tentam criar a mesma nota',
    'Ambos consultam ausência. A cria com texto vazio; sua resposta se perde. B deve conflitar.');
  check('A consulta ausência', null, a.refresh('roteiro'));
  check('B consulta ausência', null, b.refresh('roteiro'));
  a.editLocal('roteiro', '');
  b.editLocal('roteiro', 'abrir às 10h');
  const createA = a.prepareOutbox();
  const createB = b.prepareOutbox();
  check('A prepara criação com texto vazio', [op('A-1', 'roteiro', 0, '')], createA);
  check('B também prepara base 0', [op('B-1', 'roteiro', 0, 'abrir às 10h')], createB);
  // The server receives A's operation, but A never receives this first response.
  check('texto vazio é aceito como revisão 1', [{
    status: 'sucesso', operation: op('A-1', 'roteiro', 0, ''), note: note('roteiro', '', 1),
  }], service.processBatch(createA));
  const conflictB = service.processBatch(createB);
  check('a segunda criação preserva ambos os textos', [{
    status: 'conflito', operation: op('B-1', 'roteiro', 0, 'abrir às 10h'),
    server_note: note('roteiro', '', 1),
  }], conflictB);
  b.applyResults(createB, conflictB);
  check('ANT-1 continua em conflito por ausência, mesmo com base 1 agora atual', {
    status: 'conflito', operation: early, server_note: null,
  }, service.processOperation(early));
  check('o reenvio antigo não altera a nota recém-criada', note('roteiro', '', 1),
    service.getNote('roteiro'));

  step('Passo 3 — Resposta perdida e reenvio manual',
    'A mantém a operação pendente. Reenviar deve repetir o ID e confirmar somente um efeito.');
  checkError('editar durante pendência é bloqueado',
    'Há uma operação pendente para esta nota; aguarde o resultado.',
    () => a.editLocal('roteiro', 'edição prematura'));
  check('a operação pendente mantém ID e conteúdo', [op('A-1', 'roteiro', 0, '')],
    a.prepareOutbox());
  check('o reenvio confirma o recibo original', [{
    status: 'sucesso', operation: op('A-1', 'roteiro', 0, ''), note: note('roteiro', '', 1),
  }], send(a));
  check('pendência confirmada sai da fila', [], a.prepareOutbox());
  a.editLocal('roteiro', '  oficina de cerâmica 🏺\n');
  check('espaços, Unicode e quebra de linha são preservados', [{
    status: 'sucesso', operation: op('A-2', 'roteiro', 1, '  oficina de cerâmica 🏺\n'),
    note: note('roteiro', '  oficina de cerâmica 🏺\n', 2),
  }], send(a));
  check('recibo de criação continua com texto vazio e revisão 1', {
    status: 'sucesso', operation: op('A-1', 'roteiro', 0, ''), note: note('roteiro', '', 1),
  }, service.processOperation(op('A-1', 'roteiro', 0, '')));
  check('consulta atual mostra revisão 2', note('roteiro', '  oficina de cerâmica 🏺\n', 2),
    service.getNote('roteiro'));

  step('Passo 4 — A nota muda enquanto B resolve o conflito',
    'B consulta a revisão 2 e escolhe um texto. A publica revisão 3 antes do envio de B.');
  checkError('resolver sem consultar após o conflito é bloqueado',
    'Consulte a nota com refresh antes de resolver o conflito.',
    () => b.resolveConflict('roteiro', 'abrir às 10h; oficina de cerâmica'));
  check('B consulta revisão 2', note('roteiro', '  oficina de cerâmica 🏺\n', 2),
    b.refresh('roteiro'));
  b.resolveConflict('roteiro', 'abrir às 10h; oficina de cerâmica');
  const resolutionB = b.prepareOutbox();
  check('a resolução usa novo ID e base consultada',
    [op('B-2', 'roteiro', 2, 'abrir às 10h; oficina de cerâmica')], resolutionB);
  a.editLocal('roteiro', 'oficina adiada para 11h');
  check('A publica antes da resolução de B', [{
    status: 'sucesso', operation: op('A-3', 'roteiro', 2, 'oficina adiada para 11h'),
    note: note('roteiro', 'oficina adiada para 11h', 3),
  }], send(a));
  const secondConflict = service.processBatch(resolutionB);
  check('a resolução também pode conflitar', [{
    status: 'conflito', operation: op('B-2', 'roteiro', 2, 'abrir às 10h; oficina de cerâmica'),
    server_note: note('roteiro', 'oficina adiada para 11h', 3),
  }], secondConflict);
  b.applyResults(resolutionB, secondConflict);
  check('B não reenvia automaticamente o conflito', [], b.prepareOutbox());
  checkError('o segundo conflito exige outra consulta',
    'Consulte a nota com refresh antes de resolver o conflito.',
    () => b.resolveConflict('roteiro', 'abrir às 11h; oficina de cerâmica'));

  step('Passo 5 — Escolha explícita e dois recibos históricos',
    'B consulta novamente e escolhe o texto final. Os dois conflitos anteriores ficam intactos.');
  check('B consulta revisão 3', note('roteiro', 'oficina adiada para 11h', 3), b.refresh('roteiro'));
  b.resolveConflict('roteiro', 'abrir às 11h; oficina de cerâmica');
  check('nova resolução confirma revisão 4', [{
    status: 'sucesso', operation: op('B-3', 'roteiro', 3, 'abrir às 11h; oficina de cerâmica'),
    note: note('roteiro', 'abrir às 11h; oficina de cerâmica', 4),
  }], send(b));
  check('primeiro conflito ainda mostra revisão 1', {
    status: 'conflito', operation: op('B-1', 'roteiro', 0, 'abrir às 10h'),
    server_note: note('roteiro', '', 1),
  }, service.processOperation(op('B-1', 'roteiro', 0, 'abrir às 10h')));
  check('segundo conflito ainda mostra revisão 3', {
    status: 'conflito', operation: op('B-2', 'roteiro', 2, 'abrir às 10h; oficina de cerâmica'),
    server_note: note('roteiro', 'oficina adiada para 11h', 3),
  }, service.processOperation(op('B-2', 'roteiro', 2, 'abrir às 10h; oficina de cerâmica')));
  check('consulta mostra o texto escolhido na revisão 4',
    note('roteiro', 'abrir às 11h; oficina de cerâmica', 4), service.getNote('roteiro'));

  step('Passo 6 — Lote misto com erros e correções',
    'Injeções diretas no servidor: ID reutilizado, base inválida e leitura que lança não bloqueiam os próximos itens.');
  const mixed = service.processBatch([
    op('A-1', 'roteiro', 0, 'outro texto'),
    { op_id: 'MAT-1', note_id: 'materiais', base_revision: '0', text: '' },
    op('MAT-1', 'materiais', 0, ''),
    op('A-1', 'roteiro', -1, ''),
    {
      op_id: 'AV-1', note_id: 'avisos', base_revision: 0,
      get text(): never { throw new Error('detalhe interno da leitura'); },
    },
    op('AV-1', 'avisos', 0, 'trazer avental'),
    op('MAT-2', 'materiais', 1, ''),
  ]);
  const expectedMixed = [
    { status: 'id_reutilizado', op_id: 'A-1' },
    { status: 'invalida', errors: [{
      field: 'base_revision', code: 'invalid_type', message: 'Tipo inválido para o campo.',
    }] },
    { status: 'sucesso', operation: op('MAT-1', 'materiais', 0, ''), note: note('materiais', '', 1) },
    { status: 'invalida', errors: [{
      field: 'base_revision', code: 'invalid_revision', message: 'Revisão base inválida.',
    }] },
    { status: 'invalida', errors: [{
      field: 'operation', code: 'unreadable_input', message: 'Não foi possível ler a operação.',
    }] },
    { status: 'sucesso', operation: op('AV-1', 'avisos', 0, 'trazer avental'),
      note: note('avisos', 'trazer avental', 1) },
    { status: 'sucesso', operation: op('MAT-2', 'materiais', 1, ''), note: note('materiais', '', 2) },
  ];
  check('lote devolve um resultado por posição', 7, mixed.length);
  for (const [index, expected] of expectedMixed.entries()) {
    check(`posição ${index}: ${expected.status}`, expected, mixed[index]);
  }
  check('a mensagem da exceção não aparece nos resultados', false,
    JSON.stringify(mixed).includes('detalhe interno da leitura'));
  check('texto idêntico e vazio também incrementa a revisão', note('materiais', '', 2),
    service.getNote('materiais'));
  check('a operação corrigida após leitura ilegível cria a nota', note('avisos', 'trazer avental', 1),
    service.getNote('avisos'));
  check('erros com A-1 não substituem seu recibo original', {
    status: 'sucesso', operation: op('A-1', 'roteiro', 0, ''), note: note('roteiro', '', 1),
  }, service.processOperation(op('A-1', 'roteiro', 0, '')));

  step('Passo 7 — Base futura e reutilização de um ID de conflito',
    'Base 99 conflita com revisão 4. Alterar a nota de destino sob o mesmo ID deve ser rejeitado.');
  const future = op('FUT-1', 'roteiro', 99, 'roteiro futuro');
  check('base futura preserva o estado atual', {
    status: 'conflito', operation: future,
    server_note: note('roteiro', 'abrir às 11h; oficina de cerâmica', 4),
  }, service.processOperation(future));
  check('ID de conflito também não pode ser usado para outra nota',
    { status: 'id_reutilizado', op_id: 'FUT-1' },
    service.processOperation(op('FUT-1', 'outra-nota', 0, 'roteiro futuro')));
  check('a outra nota não foi criada', null, service.getNote('outra-nota'));
  check('o conflito original ainda pode ser reenviado', {
    status: 'conflito', operation: future,
    server_note: note('roteiro', 'abrir às 11h; oficina de cerâmica', 4),
  }, service.processOperation(future));
  check('estado final do roteiro permanece na revisão 4',
    note('roteiro', 'abrir às 11h; oficina de cerâmica', 4), service.getNote('roteiro'));

  console.log(`\n${checks - failures}/${checks} verificações passaram.`);
  console.log(failures === 0 ? 'Todas as verificações passaram.' : `${failures} verificação(ões) falharam.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
