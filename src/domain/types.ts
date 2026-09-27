export type Note = Readonly<{ id: string; text: string; revision: number }>;

export type Operation = Readonly<{
  op_id: string;
  note_id: string;
  base_revision: number;
  text: string;
}>;

/** Result of the pure decision: apply the operation or declare a conflict. */
export type Decision =
  | Readonly<{ kind: 'apply'; note: Note }>
  | Readonly<{ kind: 'conflict'; server_note: Note | null }>;
