import { HttpParams, HttpRequest } from '@angular/common/http';
import { Account, Movement, SavingsData, Summary } from '../finance.models';
import { FinancePractice } from './finance-practice';

const TODAY = '2026-11-12';
const user = { id: 'u1', nickname: 'ana', familyId: 'f1', currency: 'USD', locale: 'es' as const };

function call(
  p: FinancePractice,
  method: string,
  url: string,
  body: unknown = null,
  params: Record<string, string> = {},
) {
  const req = new HttpRequest(method as 'GET', url, body, {
    params: new HttpParams({ fromObject: params }),
  });
  const res = p.handle(req);
  if (!res) throw new Error(`sin ruta: ${method} ${url}`);
  return res as { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const accountInput = (over: Record<string, unknown> = {}) => ({
  name: 'Banco',
  description: null,
  kind: 'bank',
  prefix: 'B',
  creditLimit: null,
  opening: { amount: 500, date: TODAY },
  viewMode: 'family',
  editMode: 'roles',
  editRoles: ['leader', 'member'],
  viewers: [],
  editors: [],
  ...over,
});

describe('FinancePractice', () => {
  let p: FinancePractice;
  beforeEach(() => (p = new FinancePractice(user, TODAY)));

  const accounts = () => call(p, 'GET', '/api/families/f1/accounts').body.accounts as Account[];

  it('empieza con una cuenta de efectivo, sus movimientos y las categorías del idioma', () => {
    const [cash] = accounts();
    expect(cash).toMatchObject({
      name: 'Efectivo',
      prefix: 'E',
      balance: 177.5,
      permissions: { canEdit: true, canAdmin: true },
    });
    const movs = call(p, 'GET', `/api/accounts/${cash!.id}/movements`).body.movements as Movement[];
    expect(movs.map((m) => [m.code, m.kind, m.balance])).toEqual([
      ['E0001', 'opening', 150],
      ['E0003', 'in', 190],
      ['E0002', 'out', 177.5],
    ]);
    const cats = call(p, 'GET', '/api/families/f1/categories').body.categories as {
      name: string;
    }[];
    expect(cats.map((c) => c.name)).toContain('Alimentación');
  });

  it('crea cuentas, gastos y transferencias con sus saldos, y cuenta lo que pasa', () => {
    const created = call(p, 'POST', '/api/families/f1/accounts', accountInput());
    expect(created.status).toBe(201);
    const bank = created.body.account as Account;
    expect(bank.balance).toBe(500);
    expect(
      call(p, 'POST', '/api/families/f1/accounts', accountInput({ name: 'Otro' })).body.error,
    ).toBe('ACCOUNT_PREFIX_TAKEN');

    const cat = (
      call(p, 'GET', '/api/families/f1/categories').body.categories as { id: string }[]
    )[0]!.id;
    call(p, 'POST', `/api/accounts/${bank.id}/movements`, {
      id: 'm1',
      kind: 'out',
      amount: 25,
      date: TODAY,
      description: 'Súper',
      categoryId: cat,
    });
    // Reenvío: no duplica
    call(p, 'POST', `/api/accounts/${bank.id}/movements`, {
      id: 'm1',
      kind: 'out',
      amount: 25,
      date: TODAY,
      description: 'Súper',
      categoryId: cat,
    });
    expect(
      call(p, 'POST', `/api/accounts/${bank.id}/movements`, {
        kind: 'out',
        amount: 0,
        date: TODAY,
        description: '',
      }).body.error,
    ).toBe('VALIDATION');

    const cash = accounts().find((a) => a.prefix === 'E')!;
    call(p, 'POST', '/api/transfers', {
      id: 't1',
      outId: 'o1',
      inId: 'i1',
      fromAccountId: bank.id,
      toAccountId: cash.id,
      amount: 100,
      date: TODAY,
      description: 'Retiro',
    });
    const after = Object.fromEntries(accounts().map((a) => [a.prefix, a.balance]));
    expect(after).toEqual({ E: 277.5, B: 375 });
    const half = (
      call(p, 'GET', `/api/accounts/${cash.id}/movements`).body.movements as Movement[]
    ).find((m) => m.kind === 'transfer_in')!;
    expect(half.transfer).toMatchObject({ accountName: 'Banco', code: 'B0003' });

    // Borrar una mitad borra las dos
    call(p, 'DELETE', '/api/movements/o1');
    expect(Object.fromEntries(accounts().map((a) => [a.prefix, a.balance]))).toEqual({
      E: 177.5,
      B: 475,
    });
    expect(p.counts()).toMatchObject({
      'account.created': 1,
      'movement.created': 1,
      'transfer.created': 1,
      'movement.deleted': 1,
    });
  });

  it('pagar la tarjeta de práctica baja la deuda', () => {
    const { id: cardId, created } = p.addCreditCard();
    expect(created).toBe(true);
    expect(p.addCreditCard()).toEqual({ id: cardId, created: false });
    const cash = accounts().find((a) => a.prefix === 'E')!;
    call(p, 'POST', '/api/transfers', {
      fromAccountId: cash.id,
      toAccountId: cardId,
      amount: 80,
      date: TODAY,
      description: 'Pago Visa',
    });
    expect(accounts().find((a) => a.id === cardId)!.credit).toEqual({
      limit: 500,
      debt: 100,
      available: 400,
      overLimit: false,
    });
    expect(p.counts()['transfer.created.card']).toBe(1);
  });

  it('ahorro: apartar no cambia el saldo y no deja pasar del disponible', () => {
    const cash = accounts()[0]!;
    call(p, 'POST', '/api/families/f1/savings', {
      id: 's1',
      name: 'Viaje',
      icon: '✈️',
      goal: 1000,
      targetDate: null,
    });
    expect(
      call(p, 'POST', '/api/savings/s1/move', {
        accountId: cash.id,
        action: 'set_aside',
        amount: 500,
      }).body.error,
    ).toBe('SAVINGS_NOT_ENOUGH');
    call(p, 'POST', '/api/savings/s1/move', {
      accountId: cash.id,
      action: 'set_aside',
      amount: 50,
    });
    const a = accounts()[0]!;
    expect([a.balance, a.savings.total, a.savings.available]).toEqual([177.5, 50, 127.5]);
    const data = call(p, 'GET', '/api/families/f1/savings').body as SavingsData;
    expect(data.projects[0]).toMatchObject({ name: 'Viaje', saved: 50 });
  });

  it('resumen del mes y presupuesto con lo gastado', () => {
    const summary = call(p, 'GET', '/api/families/f1/summary', null, {
      from: '2026-11-01',
      to: '2026-11-30',
      freq: 'month',
    }).body as Summary;
    expect(summary.combined).toMatchObject({ income: 40, expense: 12.5, net: 27.5 });
    expect(summary.balances.real).toBe(177.5);
    const food = (
      call(p, 'GET', '/api/families/f1/categories').body.categories as {
        id: string;
        name: string;
      }[]
    ).find((c) => c.name === 'Alimentación')!;
    call(p, 'PUT', `/api/categories/${food.id}/budget`, { amount: 100 });
    const budgets = call(p, 'GET', '/api/families/f1/budgets').body;
    expect(budgets.budgets[0]).toMatchObject({ limit: 100, spent: 12.5, pct: 13 });
  });

  it('programado mensual: próxima fecha desde hoy y próximos del mes', () => {
    const cash = accounts()[0]!;
    call(p, 'POST', '/api/families/f1/scheduled', {
      accountId: cash.id,
      kind: 'out',
      toAccountId: null,
      savingsProjectId: null,
      categoryId: null,
      amount: 15.99,
      description: 'Netflix',
      mode: 'auto',
      rule: { freq: 'monthly', interval: 1, start: '2026-10-31' },
      remindDays: null,
      notifyDone: true,
    });
    const items = call(p, 'GET', '/api/families/f1/scheduled').body.items;
    expect(items[0]).toMatchObject({ description: 'Netflix', nextDate: '2026-11-30' });
    const upcoming = call(p, 'GET', '/api/families/f1/scheduled/upcoming', null, {
      to: '2027-01-31',
    }).body.items;
    expect(upcoming.map((u: { date: string }) => u.date)).toEqual([
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
    ]);
  });

  it('solo atiende sus rutas: lo demás lo decide el interceptor', () => {
    expect(p.owns('/api/accounts/x/movements')).toBe(true);
    expect(p.owns('/api/families/f1/export')).toBe(true);
    expect(p.owns('/api/families/f1')).toBe(false);
    expect(p.owns('/api/lists/l1')).toBe(false);
    expect(p.handle(new HttpRequest('GET', '/api/families/f1/export'))).toBeNull();
  });
});
