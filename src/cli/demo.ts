import { isDeepStrictEqual } from 'node:util';
import { createIdGenerator, createSimulatedClient, createSyncService } from '../index.js';

let failures = 0; // allowed: CLI script, not library code

function step(title: string): void {
  console.log(`\n== ${title} ==`);
}

function info(message: string): void {
  console.log(`   ${message}`);
}

function check(label: string, expected: unknown, observed: unknown): void {
  const ok = isDeepStrictEqual(expected, observed);
  if (!ok) failures++;
  console.log(`${ok ? '[OK]     ' : '[FALHOU] '}${label}`);
  console.log(`   esperado:  ${JSON.stringify(expected)}`);
  console.log(`   observado: ${JSON.stringify(observed)}`);
}

const service = createSyncService();
const a = createSimulatedClient({ service, nextId: createIdGenerator('A') });
const b = createSimulatedClient({ service, nextId: createIdGenerator('B') });

step('Passo 1 — Criar compras e viagem');
a.refresh('compras');
a.refresh('viagem');
a.editLocal('compras', 'leite');
a.editLocal('viagem', 'passagens');
const ops1 = a.prepareOutbox();
const res1 = service.processBatch(ops1);
a.applyResults(ops1, res1);
check(
  'operações criadas por A',
  [
    { op_id: 'A-1', note_id: 'compras', base_revision: 0, text: 'leite' },
    { op_id: 'A-2', note_id: 'viagem', base_revision: 0, text: 'passagens' },
  ],
  ops1,
);
check('ambas criadas', ['sucesso', 'sucesso'], res1.map((r) => r.status));
check('B consulta compras', { id: 'compras', text: 'leite', revision: 1 }, b.refresh('compras'));
check('B consulta viagem', { id: 'viagem', text: 'passagens', revision: 1 }, b.refresh('viagem'));

step('Passo 2 — A edita offline');
a.editLocal('compras', 'leite, pão');
a.editLocal('compras', 'leite, pão, café');
a.editLocal('viagem', 'passagens, hotel');
info('A está offline: nada foi enviado. Compras foi editada 2 vezes, mas vira um único rascunho com base 1.');

step('Passo 3 — B atualiza compras');
b.editLocal('compras', 'leite, ovos');
const opsB = b.prepareOutbox();
const resB = service.processBatch(opsB);
b.applyResults(opsB, resB);
check(
  'B atualiza compras',
  [
    {
      status: 'sucesso',
      operation: { op_id: 'B-1', note_id: 'compras', base_revision: 1, text: 'leite, ovos' },
      note: { id: 'compras', text: 'leite, ovos', revision: 2 },
    },
  ],
  resB,
);

step('Passo 4 — A reconecta e o transporte duplica viagem');
const opsA = a.prepareOutbox();
check(
  'A prepara 2 operações com base confirmada 1',
  [
    { op_id: 'A-3', note_id: 'compras', base_revision: 1, text: 'leite, pão, café' },
    { op_id: 'A-4', note_id: 'viagem', base_revision: 1, text: 'passagens, hotel' },
  ],
  opsA,
);
info('Injeção: o transporte entrega a operação de viagem duas vezes.');
const viagemDup = opsA[1];
if (viagemDup === undefined) {
  throw new Error('demo inconsistente: operação de viagem ausente.');
}
const resA = service.processBatch([...opsA, viagemDup]);
check(
  'compras conflita',
  {
    status: 'conflito',
    operation: { op_id: 'A-3', note_id: 'compras', base_revision: 1, text: 'leite, pão, café' },
    server_note: { id: 'compras', text: 'leite, ovos', revision: 2 },
  },
  resA[0],
);
check(
  'viagem é aceita',
  {
    status: 'sucesso',
    operation: { op_id: 'A-4', note_id: 'viagem', base_revision: 1, text: 'passagens, hotel' },
    note: { id: 'viagem', text: 'passagens, hotel', revision: 2 },
  },
  resA[1],
);
check('entrega duplicada devolve o mesmo recibo', resA[1], resA[2]);
check('viagem teve um só efeito', 2, service.getNote('viagem')?.revision);
a.applyResults(opsA, resA.slice(0, 2));
check('compras bloqueada até escolha explícita; nada a enviar', [], a.prepareOutbox());

step('Passo 5 — Injeção direta: inválida e corrigida com mesmo ID');
info('Injeção direta no servidor: a primeira operação é inválida (base_revision como texto).');
const res5 = service.processBatch([
  { op_id: 'INJ-1', note_id: 'lembretes', base_revision: '0', text: 'regar plantas' },
  { op_id: 'INJ-1', note_id: 'lembretes', base_revision: 0, text: 'regar plantas' },
]);
check('inválida não ocupa o ID', ['invalida', 'sucesso'], res5.map((r) => r.status));
check(
  'corrigida cria lembretes',
  { id: 'lembretes', text: 'regar plantas', revision: 1 },
  service.getNote('lembretes'),
);
const first5 = res5[0];
if (first5 !== undefined && first5.status === 'invalida') {
  info(`posição 0 no lote: ${JSON.stringify(first5.errors)}`);
}

step('Passo 6 — A consulta e mantém o texto remoto');
check(
  'A consulta compras',
  { id: 'compras', text: 'leite, ovos', revision: 2 },
  a.refresh('compras'),
);
a.resolveConflict('compras', 'leite, ovos');
const ops6 = a.prepareOutbox();
check(
  'nova proposta: novo ID, base atual',
  [{ op_id: 'A-5', note_id: 'compras', base_revision: 2, text: 'leite, ovos' }],
  ops6,
);
const res6 = service.processBatch(ops6);
a.applyResults(ops6, res6);
const first6 = res6[0];
check(
  'mesmo texto também incrementa a revisão',
  { id: 'compras', text: 'leite, ovos', revision: 3 },
  first6 !== undefined && first6.status === 'sucesso' ? first6.note : null,
);

step('Passo 7 — Recibo histórico vs estado atual');
const opCompras = opsA[0];
if (opCompras === undefined) {
  throw new Error('demo inconsistente: operação de compras ausente.');
}
const replay = service.processOperation(opCompras);
check('reenvio do conflito antigo devolve o recibo original (revisão 2)', resA[0], replay);
check(
  'consulta mostra o estado atual (revisão 3)',
  { id: 'compras', text: 'leite, ovos', revision: 3 },
  service.getNote('compras'),
);

step('Passo 8 — Reutilização de ID');
const opViagem = opsA[1];
if (opViagem === undefined) {
  throw new Error('demo inconsistente: operação de viagem ausente.');
}
const reused = service.processOperation({ ...opViagem, text: 'outro texto' });
check('mesmo ID com outro texto é rejeitado', { status: 'id_reutilizado', op_id: 'A-4' }, reused);
check(
  'viagem continua inalterada',
  { id: 'viagem', text: 'passagens, hotel', revision: 2 },
  service.getNote('viagem'),
);

console.log(`\n${failures === 0 ? 'Todas as verificações passaram.' : `${failures} verificação(ões) falharam.`}`);
process.exitCode = failures === 0 ? 0 : 1;
