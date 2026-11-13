import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/auth/auth.service';
import { SyncStatus } from '../../core/offline/sync-status.service';
import { Account, Category, Movement } from './finance.models';
import { FinanceStore } from './finance.store';

const tick = () => new Promise((resolve) => setTimeout(resolve));

const ACCOUNT = {
  id: 'a1',
  familyId: 'f1',
  name: 'Nu',
  prefix: 'T',
  currency: 'USD',
  balance: 100,
  credit: null,
  permissions: { canEdit: true, canAdmin: true, supervision: false },
} as Account;

const OPENING: Movement = {
  id: 'm1',
  code: 'T0001',
  number: 1,
  kind: 'opening',
  amount: 100,
  signedAmount: 100,
  date: '2026-01-01',
  description: 'Saldo inicial',
  category: null,
  createdBy: { id: 'u1', nickname: 'ana' },
  edited: false,
  balance: 100,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const OCIO: Category = {
  id: 'c1',
  name: 'Ocio',
  icon: '🎉',
  color: 'pink',
  disabled: false,
  usage: 0,
};

describe('FinanceStore sin conexión', () => {
  let store: FinanceStore;
  let http: HttpTestingController;
  let status: SyncStatus;

  const offline = (url: string, method = 'GET') =>
    http.expectOne({ url, method }).error(new ProgressEvent('error'));

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal({ id: 'u1', nickname: 'ana' }) } },
      ],
    });
    store = TestBed.inject(FinanceStore);
    http = TestBed.inject(HttpTestingController);
    status = TestBed.inject(SyncStatus);
    await tick();

    // Se abrió Finanzas con conexión: cuentas y movimientos quedan en el dispositivo
    const accounts = store.accounts('f1');
    await tick();
    http
      .expectOne('/api/families/f1/accounts')
      .flush({ currency: 'USD', accounts: [ACCOUNT], supervisedPrivate: [] });
    await accounts;
    const movements = store.movements('a1');
    await tick();
    http.expectOne('/api/accounts/a1/movements').flush({ movements: [OPENING], hiddenColumns: [] });
    await movements;
  });

  it('sin red muestra la última copia guardada', async () => {
    const again = store.movements('a1');
    await tick();
    offline('/api/accounts/a1/movements');
    expect((await again).movements.map((m) => m.code)).toEqual(['T0001']);
    expect(status.online()).toBe(false);
  });

  it('agrega sin conexión: saldo local al instante, "sin enviar", y se envía al volver', async () => {
    const input = {
      id: 'n1',
      kind: 'out' as const,
      amount: 30,
      date: '2026-11-05',
      description: 'Cine',
      categoryId: 'c1',
    };
    const added = store.addMovement(ACCOUNT, input, OCIO);
    await tick();
    offline('/api/accounts/a1/movements', 'POST');
    await added;
    expect(status.queued()).toBe(1);

    // Con cambios sin enviar, la copia local manda (sin pedir al servidor)
    const local = await store.movements('a1');
    expect(local.movements.map((m) => [m.description, m.balance, !!m.pending])).toEqual([
      ['Saldo inicial', 100, false],
      ['Cine', 70, true],
    ]);
    expect(local.movements[1]!.category?.name).toBe('Ocio');
    expect((await store.accounts('f1')).accounts[0]!.balance).toBe(70);

    const flushed = store.flush();
    await tick();
    const req = http.expectOne({ url: '/api/accounts/a1/movements', method: 'POST' });
    expect(req.request.body).toEqual(input);
    req.flush({ id: 'n1' });
    await flushed;
    expect(status.queued()).toBe(0);
    expect(store.synced()).toBe(1);
  });

  it('editar, borrar y deshacer sin conexión recalculan el saldo y se envían en orden', async () => {
    const input = {
      id: 'n1',
      kind: 'out' as const,
      amount: 30,
      date: '2026-11-05',
      description: 'Cine',
      categoryId: 'c1',
    };
    const added = store.addMovement(ACCOUNT, input, OCIO);
    await tick();
    offline('/api/accounts/a1/movements', 'POST');
    await added;

    let cine = (await store.movements('a1')).movements[1]!;
    await store.updateMovement(ACCOUNT, cine, { amount: 45, kind: 'in' }, null);
    expect((await store.movements('a1')).movements[1]!.balance).toBe(145);

    cine = (await store.movements('a1')).movements[1]!;
    await store.deleteMovement(ACCOUNT, cine);
    expect((await store.accounts('f1')).accounts[0]!.balance).toBe(100);
    await store.restoreMovement(ACCOUNT, cine);
    expect((await store.accounts('f1')).accounts[0]!.balance).toBe(145);
    expect(status.queued()).toBe(4);

    const flushed = store.flush();
    for (const [method, url] of [
      ['POST', '/api/accounts/a1/movements'],
      ['PATCH', '/api/movements/n1'],
      ['DELETE', '/api/movements/n1'],
      ['POST', '/api/movements/n1/restore'],
    ]) {
      await tick();
      http.expectOne({ method, url }).flush({});
    }
    await flushed;
    expect(status.queued()).toBe(0);
  });

  it('ajuste sin conexión: diferencia contra el saldo local; al servidor va el saldo real', async () => {
    const adjusted = store.adjust(ACCOUNT, {
      id: 'j1',
      balance: 80,
      date: '2026-11-09',
      description: 'Ajuste de saldo',
    });
    await tick();
    offline('/api/accounts/a1/adjust', 'POST');
    await adjusted;
    const last = (await store.movements('a1')).movements.at(-1)!;
    expect([last.kind, last.signedAmount, last.balance]).toEqual(['adjust', -20, 80]);

    const flushed = store.flush();
    await tick();
    const req = http.expectOne({ url: '/api/accounts/a1/adjust', method: 'POST' });
    expect(req.request.body).toMatchObject({ balance: 80 });
    req.flush({ id: 'j1' });
    await flushed;
  });

  it('transferir sin conexión: sale de una cuenta y entra en la otra; borrar y deshacer mueven las dos', async () => {
    const card = { ...ACCOUNT, id: 'a2', name: 'Visa', prefix: 'V', balance: -300 } as Account;
    // La tarjeta también se abrió antes: sus movimientos quedan en el dispositivo
    const cardMovs = store.movements('a2');
    await tick();
    http.expectOne('/api/accounts/a2/movements').flush({
      movements: [
        { ...OPENING, id: 'm2', code: 'V0001', amount: -300, signedAmount: -300, balance: -300 },
      ],
      hiddenColumns: [],
    });
    await cardMovs;

    const input = {
      id: 't1',
      outId: 'o1',
      inId: 'i1',
      fromAccountId: 'a1',
      toAccountId: 'a2',
      amount: 120,
      date: '2026-11-05',
      description: 'Pago tarjeta',
    };
    const sent = store.transfer(ACCOUNT, card, input);
    await tick();
    offline('/api/transfers', 'POST');
    await sent;

    const bank = (await store.movements('a1')).movements.at(-1)!;
    const visa = (await store.movements('a2')).movements.at(-1)!;
    expect([bank.kind, bank.signedAmount, bank.balance, bank.transfer?.accountName]).toEqual([
      'transfer_out',
      -120,
      -20,
      'Visa',
    ]);
    expect([visa.kind, visa.signedAmount, visa.balance]).toEqual(['transfer_in', 120, -180]);

    await store.deleteMovement(ACCOUNT, bank);
    expect((await store.movements('a2')).movements).toHaveLength(1);
    await store.restoreMovement(ACCOUNT, bank);
    expect((await store.movements('a2')).movements.at(-1)!.id).toBe('i1');

    await store.updateMovement(ACCOUNT, bank, { amount: 100 }, null);
    expect((await store.movements('a2')).movements.at(-1)!.balance).toBe(-200);

    const flushed = store.flush();
    for (const [method, url] of [
      ['POST', '/api/transfers'],
      ['DELETE', '/api/movements/o1'],
      ['POST', '/api/movements/o1/restore'],
      ['PATCH', '/api/movements/o1'],
    ]) {
      await tick();
      http.expectOne({ method, url }).flush({});
    }
    await flushed;
    expect(status.queued()).toBe(0);
  });

  it('lo que el servidor rechaza al sincronizar se descarta y se avisa', async () => {
    const added = store.addMovement(
      ACCOUNT,
      { id: 'n1', kind: 'out', amount: 5, date: '2026-11-05', description: 'X', categoryId: 'c1' },
      OCIO,
    );
    await tick();
    offline('/api/accounts/a1/movements', 'POST');
    await added;

    const flushed = store.flush();
    await tick();
    http
      .expectOne({ url: '/api/accounts/a1/movements', method: 'POST' })
      .flush({ error: 'ACCOUNT_ARCHIVED' }, { status: 403, statusText: 'Forbidden' });
    await flushed;
    expect(status.queued()).toBe(0);
    expect(status.rejected()).toBe(1);
  });
});
