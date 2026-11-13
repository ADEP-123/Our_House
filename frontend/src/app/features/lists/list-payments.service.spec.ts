import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ListPaymentsData, ListPaymentsService } from './list-payments.service';

const tick = () => new Promise((resolve) => setTimeout(resolve));

const data = (over: Partial<ListPaymentsData> = {}): ListPaymentsData => ({
  currency: 'USD',
  canRegister: true,
  total: 4.75,
  items: [{ id: 'i1', text: 'Leche', amount: 4.75 }],
  accountId: null,
  categoryId: null,
  accounts: [{ id: 'a1', name: 'Nu', kind: 'bank' }],
  categories: [],
  paidItems: ['i9'],
  recent: [],
  ...over,
});

describe('ListPaymentsService', () => {
  let service: ListPaymentsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ListPaymentsService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('trae lo pendiente de la lista abierta y sabe qué artículos ya están en un pago', async () => {
    service.open('l1');
    const done = service.refresh();
    http.expectOne('/api/lists/l1/payments').flush(data());
    await done;
    expect(service.data()?.total).toBe(4.75);
    expect(service.isPaid('i9')).toBe(true);
    expect(service.isPaid('i1')).toBe(false);
  });

  it('al cambiar de lista olvida la anterior y descarta una respuesta que llega tarde', async () => {
    service.open('l1');
    const late = service.refresh();
    service.open('l2');
    expect(service.data()).toBeNull();
    http.expectOne('/api/lists/l1/payments').flush(data());
    await late;
    expect(service.data()).toBeNull();
  });

  it('sin conexión conserva lo último', async () => {
    service.open('l1');
    let done = service.refresh();
    http.expectOne('/api/lists/l1/payments').flush(data());
    await done;
    done = service.refresh();
    http.expectOne('/api/lists/l1/payments').error(new ProgressEvent('error'));
    await done;
    expect(service.data()?.total).toBe(4.75);
  });

  it('registrar envía el pago y vuelve a traer lo pendiente', async () => {
    service.open('l1');
    const result = service.register({
      id: 'p1',
      accountId: 'a1',
      categoryId: 'c1',
      date: '2026-11-11',
    });
    const req = http.expectOne('/api/lists/l1/payments');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      id: 'p1',
      accountId: 'a1',
      categoryId: 'c1',
      date: '2026-11-11',
    });
    req.flush({ amount: 4.75, items: 1, movementCode: 'T0002' });
    await tick();
    http.expectOne('/api/lists/l1/payments').flush(data({ total: 0, items: [] }));
    expect(await result).toEqual({ amount: 4.75, items: 1, movementCode: 'T0002' });
    expect(service.data()?.total).toBe(0);
  });
});
