# Caso 05 — Sincronização de notas offline

> Em construção. Este README será completado na fase 5.

## Registro de execução do agente

Tempos medidos pelo agente de IA com `date -Iseconds`. Não incluem revisão humana.

| Fase | Início | Fim | Observação |
|---|---|---|---|
| Fase 0 — setup | 2026-09-27T16:36:20-03:00 | 2026-09-27T16:37:08-03:00 | Toolchain OK (tsc 7.0.2, vitest 5.0.2, tsx 4.23.15); sem lógica de protocolo. |
| Fase 1 — servidor e entrada | 2026-09-27T16:38:46-03:00 | 2026-09-27T16:40:01-03:00 | Protocolo completo + T10, T11, T18, T19 (31 testes). |
| Fase 1 — correções da revisão | não registrado | 2026-09-27T16:45:09-03:00 | Validação do comprimento do lote, remoção de casts, T19 mais estrito. |
| Fase 2 — testes do protocolo | 2026-09-27T16:47:19-03:00 | 2026-09-27T16:48:13-03:00 | T00–T09, T12–T17, T20, T21 (49 testes no total). |
| Fase 2 — correções da revisão | 2026-09-27T16:51:15-03:00 | 2026-09-27T16:51:41-03:00 | T16 mais estrito (replay mutado) + verificação por mutação do resend. |
| Fase 3 — cliente simulado | 2026-09-27T16:52:36-03:00 | 2026-09-27T16:53:46-03:00 | T22–T23 (55 testes no total). |
| Fase 3 — correções da revisão | 2026-09-27T16:56:08-03:00 | 2026-09-27T16:57:41-03:00 | applyResults atômico (Set), T23f–T23h + 3 mutações revertidas. |
| Fase 4 — demo CLI | 2026-09-27T18:29:24-03:00 | 2026-09-27T18:30:22-03:00 | 8 passos, demo e smoke com exit 0. |

Tempo humano (revisão, gravação, envio): **PENDENTE — preenchido pelo candidato.**
