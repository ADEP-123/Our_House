import { beforeEach, describe, expect, it } from 'vitest';
import { suggestPrefix } from '../src/lib/import.js';
import { resetDb, setupFamily, type User } from './helpers.js';

type Row = Record<string, unknown>;
const run = (user: User, familyId: string, body: { accounts?: Row[]; categories?: Row[]; movements?: Row[] }, dryRun: boolean) =>
  user.agent.post(`/api/families/${familyId}/import`).send({ dryRun, accounts: [], categories: [], movements: [], ...body });

const mov = (row: number, m: Row): Row => ({ row, date: '2026-11-05', description: `Fila ${row}`, ...m });

async function accounts(user: User, familyId: string) {
  const list = (await user.agent.get(`/api/families/${familyId}/accounts`).expect(200)).body.accounts as { id: string; name: string; balance: number; prefix: string }[];
  return Object.fromEntries(list.map((a) => [a.name, a]));
}
async function codes(user: User, accountId: string) {
  const list = (await user.agent.get(`/api/accounts/${accountId}/movements`).expect(200)).body.movements as { code: string; kind: string; amount: number }[];
  return list.map((m) => `${m.code}:${m.kind}:${m.amount}`);
}

/** El archivo del ejemplo: dos cuentas nuevas, una categoría nueva y movimientos con y sin ID */
const file = {
  accounts: [
    { row: 2, name: 'Nu', prefix: 'T', kind: 'bank', description: 'Banco' },
    { row: 3, name: 'Visa', prefix: 'V', kind: 'credit', creditLimit: 1000 },
  ],
  categories: [
    { row: 2, name: 'Alimentación', icon: '🍽️', color: 'orange', active: true },
    { row: 3, name: 'Mascotas', icon: '🐶', color: 'teal', active: true },
  ],
  movements: [
    mov(2, { code: 'T0001', account: 'Nu', kind: 'opening', amount: 100, date: '2026-01-01', description: 'Saldo inicial' }),
    mov(3, { code: 'T0002', account: 'Nu', kind: 'in', amount: 1000, category: 'Ingresos' }),
    mov(4, { code: 'T0005', account: 'Nu', kind: 'out', amount: 30, category: 'alimentación' }),
    mov(5, { account: 'nu', kind: 'out', amount: 20, category: 'Mascotas' }),
    mov(6, { account: 'Nu', kind: 'transfer', amount: 200, destination: 'Visa', description: 'Pago Visa' }),
    mov(7, { account: 'Nu', kind: 'adjust', amount: -5 }),
    mov(8, { code: 'V0001', account: 'Visa', kind: 'opening', amount: -300, date: '2026-01-01', description: 'Saldo inicial' }),
  ],
};

describe('importar finanzas', () => {
  beforeEach(resetDb);

  async function setup() {
    const { familyId, users } = await setupFamily(['ana', 'beto']);
    await users.ana!.agent.get(`/api/families/${familyId}/categories`).expect(200); // categorías iniciales
    return { familyId, users };
  }

  it('vista previa sin guardar y luego importa con los IDs del archivo', async () => {
    const { familyId, users } = await setup();
    const preview = (await run(users.ana!, familyId, file, true).expect(200)).body;
    expect(preview.dryRun).toBe(true);
    expect(preview.counts.accounts).toMatchObject({ create: 2, error: 0 });
    expect(preview.counts.categories).toMatchObject({ create: 1, unchanged: 1 });
    expect(preview.counts.movements).toMatchObject({ create: 7, error: 0 });
    expect(preview.movements.map((m: { ref: string }) => m.ref)).toEqual(['T0001', 'T0002', 'T0005', 'T0006', 'T0007 → V0002', 'T0008', 'V0001']);
    expect(await accounts(users.ana!, familyId)).toEqual({});

    const done = (await run(users.ana!, familyId, file, false).expect(200)).body;
    expect(done.counts.movements).toMatchObject({ create: 7, error: 0 });
    const a = await accounts(users.ana!, familyId);
    expect(a.Nu!.balance).toBe(845);
    expect(a.Visa!.balance).toBe(-100);
    expect(await codes(users.ana!, a.Visa!.id)).toEqual(['V0001:opening:-300', 'V0002:transfer_in:200']);

    // Lo nuevo sigue después del mayor número
    const ocio = await categoryId(users.ana!, familyId, 'Ocio');
    await users.ana!.agent
      .post(`/api/accounts/${a.Nu!.id}/movements`)
      .send({ kind: 'out', amount: 1, date: '2026-11-06', description: 'Café', categoryId: ocio })
      .expect(201);
    expect((await codes(users.ana!, a.Nu!.id)).at(-1)).toBe('T0009:out:1');
  });

  it('volver a importar: sin cambios; lo que cambia se actualiza con historial', async () => {
    const { familyId, users } = await setup();
    await run(users.ana!, familyId, file, false).expect(200);
    const exported = (await users.ana!.agent.get(`/api/families/${familyId}/export`).expect(200)).body;
    const rows = exported.movements.map((m: Row, i: number) => ({ row: i + 2, ...m }));
    expect(rows.filter((m: Row) => m.kind === 'transfer')).toHaveLength(1);

    const again = (await run(users.ana!, familyId, { movements: rows }, true).expect(200)).body;
    expect(again.counts.movements).toMatchObject({ unchanged: 7, create: 0, update: 0, error: 0 });

    const changed = rows.map((m: Row) =>
      m.code === 'T0005' ? { ...m, amount: 35, category: 'Mascotas' } : m.kind === 'transfer' ? { ...m, amount: 250 } : m,
    );
    const res = (await run(users.ana!, familyId, { movements: changed }, false).expect(200)).body;
    expect(res.counts.movements).toMatchObject({ update: 2, unchanged: 5 });
    expect(res.movements.find((m: { ref: string }) => m.ref === 'T0005').changes).toEqual({ amount: [30, 35], category: ['Alimentación', 'Mascotas'] });
    const a = await accounts(users.ana!, familyId);
    expect(a.Nu!.balance).toBe(845 - 5 - 50);
    expect(a.Visa!.balance).toBe(-50);
    const t5 = (await users.ana!.agent.get(`/api/accounts/${a.Nu!.id}/movements`)).body.movements.find((m: { code: string }) => m.code === 'T0005');
    const history = (await users.ana!.agent.get(`/api/movements/${t5.id}/history`).expect(200)).body.history;
    expect(history.map((h: { action: string }) => h.action)).toEqual(['created', 'updated']);
  });

  it('errores por fila: se saltan y el resto se importa', async () => {
    const { familyId, users } = await setup();
    await run(users.ana!, familyId, file, false).expect(200);
    const a = await accounts(users.ana!, familyId);
    const t2 = (await users.ana!.agent.get(`/api/accounts/${a.Nu!.id}/movements`)).body.movements.find((m: { code: string }) => m.code === 'T0002');
    await users.ana!.agent.delete(`/api/movements/${t2.id}`).expect(204);

    const res = (
      await run(
        users.ana!,
        familyId,
        {
          movements: [
            mov(2, { account: 'Banco X', kind: 'out', amount: 5, category: 'Ocio' }),
            mov(3, { account: 'Nu', kind: 'out', amount: 5 }),
            mov(4, { account: 'Nu', kind: 'out', amount: 5, category: 'Viajes' }),
            mov(5, { code: 'X0001', account: 'Nu', kind: 'out', amount: 5, category: 'Ocio' }),
            mov(6, { code: 'T0050', account: 'Nu', kind: 'out', amount: 5, category: 'Ocio' }),
            mov(7, { code: 'T0050', account: 'Nu', kind: 'out', amount: 6, category: 'Ocio' }),
            mov(8, { code: 'T0002', account: 'Nu', kind: 'in', amount: 5, category: 'Ocio' }),
            mov(9, { code: 'T0005', account: 'Nu', kind: 'adjust', amount: 5 }),
            mov(10, { account: 'Nu', kind: 'transfer', amount: 5, destination: 'Nu' }),
            mov(11, { account: 'Nu', kind: 'out', amount: -5, category: 'Ocio' }),
            mov(12, { account: 'Nu', kind: 'opening', amount: 50, code: 'T0003' }),
          ],
        },
        false,
      ).expect(200)
    ).body;
    expect(res.movements.map((m: { row: number; status: string; code?: string }) => [m.row, m.status, m.code ?? null])).toEqual([
      [2, 'error', 'IMPORT_ACCOUNT_NOT_FOUND'],
      [3, 'error', 'CATEGORY_REQUIRED'],
      [4, 'error', 'IMPORT_CATEGORY_NOT_FOUND'],
      [5, 'error', 'IMPORT_CODE_PREFIX'],
      [6, 'create', null],
      [7, 'error', 'IMPORT_CODE_DUPLICATE'],
      [8, 'error', 'IMPORT_CODE_DELETED'],
      [9, 'error', 'IMPORT_KIND_FIXED'],
      [10, 'error', 'TRANSFER_SAME_ACCOUNT'],
      [11, 'error', 'IMPORT_AMOUNT_POSITIVE'],
      [12, 'error', 'IMPORT_OPENING_CODE'],
    ]);
    expect((await codes(users.ana!, a.Nu!.id)).at(-1)).toBe('T0050:out:5');
  });

  it('permisos: sin edición la fila es error; categorías solo con líder; saldo inicial solo quien administra', async () => {
    const { familyId, users } = await setup();
    await run(users.ana!, familyId, file, false).expect(200);
    const a = await accounts(users.ana!, familyId);
    // Visa: solo los líderes editan
    const visa = (await users.ana!.agent.get(`/api/accounts/${a.Visa!.id}`)).body.account;
    await users.ana!.agent
      .put(`/api/accounts/${a.Visa!.id}`)
      .send({ name: 'Visa', kind: 'credit', prefix: 'V', creditLimit: 1000, opening: { amount: visa.opening.amount, date: visa.opening.date }, editRoles: ['leader'] })
      .expect(200);

    const res = (
      await run(
        users.beto!,
        familyId,
        {
          categories: [{ row: 2, name: 'Regalos', icon: '🎁', color: 'red', active: true }],
          movements: [
            mov(2, { account: 'Visa', kind: 'out', amount: 5, category: 'Ocio' }),
            mov(3, { account: 'Nu', kind: 'out', amount: 5, category: 'Regalos' }),
            mov(4, { account: 'Nu', kind: 'opening', amount: 1 }),
            mov(5, { account: 'Nu', kind: 'out', amount: 5, category: 'Ocio' }),
          ],
        },
        true,
      ).expect(200)
    ).body;
    expect(res.categories).toEqual([{ row: 2, status: 'skipped', code: 'IMPORT_CATEGORIES_LEADER_ONLY' }]);
    expect(res.movements.map((m: { status: string; code?: string }) => m.code ?? m.status)).toEqual([
      'ACCOUNT_READ_ONLY',
      'IMPORT_CATEGORY_NOT_FOUND',
      'ACCOUNT_ADMIN_ONLY',
      'create',
    ]);
  });

  it('exportar: una transferencia sale una vez; si solo se exporta el destino, sale con la cuenta de origen', async () => {
    const { familyId, users } = await setup();
    await run(users.ana!, familyId, file, false).expect(200);
    const a = await accounts(users.ana!, familyId);
    const visaOnly = (await users.ana!.agent.get(`/api/families/${familyId}/export?accounts=${a.Visa!.id}`).expect(200)).body;
    expect(visaOnly.accounts.map((x: { name: string; balance: number }) => [x.name, x.balance])).toEqual([['Visa', -100]]);
    expect(visaOnly.movements.map((m: Row) => [m.code, m.account, m.kind, m.amount, m.destination])).toEqual([
      ['V0001', 'Visa', 'opening', -300, null],
      ['T0007', 'Nu', 'transfer', 200, 'Visa'],
    ]);
    const november = (await users.ana!.agent.get(`/api/families/${familyId}/export?from=2026-11-01&to=2026-11-30`).expect(200)).body;
    expect(november.movements).toHaveLength(5);
    expect(november.categories.some((c: { name: string }) => c.name === 'Mascotas')).toBe(true);
  });

  it('límites y prefijo sugerido', async () => {
    const { familyId, users } = await setup();
    const many = Array.from({ length: 5001 }, (_, i) => mov(i + 2, { account: 'Nu', kind: 'out', amount: 1, category: 'Ocio' }));
    expect((await run(users.ana!, familyId, { movements: many }, true).expect(400)).body.error).toBe('IMPORT_TOO_MANY_ROWS');
    expect((await run(users.ana!, familyId, {}, true).expect(400)).body.error).toBe('IMPORT_EMPTY');
    expect(suggestPrefix('Cuenta Nómina', new Set())).toBe('CN');
    expect(suggestPrefix('Efectivo', new Set(['EF']))).toBe('EF2');
  });
});

async function categoryId(user: User, familyId: string, name: string) {
  const list = (await user.agent.get(`/api/families/${familyId}/categories`)).body.categories as { id: string; name: string }[];
  return list.find((c) => c.name === name)!.id;
}
