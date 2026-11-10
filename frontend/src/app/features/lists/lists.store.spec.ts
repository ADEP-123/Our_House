import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/auth/auth.service';
import { SyncStatus } from '../../core/offline/sync-status.service';
import { ListDetail, ListItem } from './lists.models';
import { ListsStore } from './lists.store';

const tick = () => new Promise((resolve) => setTimeout(resolve));

const item = (id: string, extra: Partial<ListItem> = {}): ListItem => ({
  id,
  parentId: null,
  text: id,
  description: null,
  amount: null,
  unit: null,
  purchased: null,
  spent: null,
  category: null,
  assigneeId: null,
  dueDate: null,
  dueTime: null,
  dueAt: null,
  reminders: { startDays: null, everyDays: null, off: false },
  position: 1,
  completedAt: null,
  completedBy: null,
  ...extra,
});

const LIST: ListDetail = {
  id: 'l1',
  familyId: 'f1',
  name: 'Súper',
  type: 'shopping',
  features: ['quantity', 'category', 'purchases'],
  color: 'blue',
  icon: 'cart',
  isPrivate: false,
  pinned: false,
  archivedAt: null,
  purgeAt: null,
  createdBy: { id: 'u1', nickname: 'ana' },
  counts: { total: 1, completed: 0, pending: 1 },
  spent: null,
  currency: 'USD',
  permissions: { canEdit: true, canCheck: true, canChangePrivacy: true, supervision: false },
  updatedAt: '2026-11-01T10:00:00.000Z',
  items: [item('leche')],
};

describe('ListsStore sin conexión', () => {
  let store: ListsStore;
  let http: HttpTestingController;
  let status: SyncStatus;

  const offline = (url: string, method = 'GET') => http.expectOne({ url, method }).error(new ProgressEvent('error'));

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal({ id: 'u1', nickname: 'ana' }) } },
      ],
    });
    store = TestBed.inject(ListsStore);
    http = TestBed.inject(HttpTestingController);
    status = TestBed.inject(SyncStatus);
    await tick();

    // La lista se abrió con conexión: queda guardada en el dispositivo
    const loaded = store.detail('l1');
    await tick();
    http.expectOne('/api/lists/l1').flush({ list: LIST });
    await loaded;
  });

  it('sin red muestra la última copia guardada', async () => {
    const again = store.detail('l1');
    await tick();
    offline('/api/lists/l1');
    expect((await again).name).toBe('Súper');
    expect(status.online()).toBe(false);
  });

  it('marca sin conexión, guarda el cambio y lo envía al volver', async () => {
    const marked = store.setCompleted('l1', 'leche', true);
    await tick();
    offline('/api/lists/l1/items/leche/completed', 'PUT');
    const result = await marked;

    expect(result.completedAt).not.toBeNull();
    expect(result.completedBy?.nickname).toBe('ana');
    expect(status.queued()).toBe(1);

    // Con cola pendiente, la pantalla ve la copia local con el cambio
    const local = store.detail('l1');
    await tick();
    offline('/api/lists/l1/items/leche/completed', 'PUT');
    const view = await local;
    expect(view.counts).toEqual({ total: 1, completed: 1, pending: 0 });

    // Vuelve la conexión
    const flushed = store.flush();
    await tick();
    const req = http.expectOne('/api/lists/l1/items/leche/completed');
    expect(req.request.body).toEqual({ completed: true });
    req.flush({ item: item('leche', { completedAt: 'x' }) });
    await flushed;
    expect(status.queued()).toBe(0);
    expect(store.synced()).toBe(1);
  });

  it('envía los cambios en el orden en que se hicieron, con el mismo id', async () => {
    const added = store.addItem('l1', { text: 'pan' });
    await tick();
    offline('/api/lists/l1/items', 'POST');
    const pan = await added;
    expect(pan.position).toBe(2);

    // Ya hay cola: el segundo cambio no intenta la red, se suma detrás
    await store.deleteItem('l1', 'leche');
    expect(status.queued()).toBe(2);

    const flushed = store.flush();
    await tick();
    const create = http.expectOne({ method: 'POST', url: '/api/lists/l1/items' });
    expect(create.request.body).toEqual({ id: pan.id, text: 'pan', position: 2 });
    create.flush({ item: pan });
    await tick();
    http.expectOne({ method: 'DELETE', url: '/api/lists/l1/items/leche' }).flush(null);
    await flushed;
    expect(status.queued()).toBe(0);
  });

  it('descarta el cambio que el servidor rechaza y avisa', async () => {
    const marked = store.setCompleted('l1', 'leche', true);
    await tick();
    offline('/api/lists/l1/items/leche/completed', 'PUT');
    await marked;

    const flushed = store.flush();
    await tick();
    http.expectOne('/api/lists/l1/items/leche/completed').flush({ error: 'LIST_ARCHIVED' }, { status: 409, statusText: 'Conflict' });
    await flushed;
    expect(status.queued()).toBe(0);
    expect(status.rejected()).toBe(1);
  });

  it('si el servidor falla, conserva la cola para reintentar', async () => {
    const marked = store.setCompleted('l1', 'leche', true);
    await tick();
    offline('/api/lists/l1/items/leche/completed', 'PUT');
    await marked;

    const flushed = store.flush();
    await tick();
    http.expectOne('/api/lists/l1/items/leche/completed').flush({ error: 'INTERNAL' }, { status: 500, statusText: 'Error' });
    await flushed;
    expect(status.queued()).toBe(1);
    expect(status.rejected()).toBe(0);
  });

  it('crea una lista sin conexión con permisos completos para quien la crea', async () => {
    const created = store.create('f1', { name: 'Viaje', type: 'todo', features: [], color: 'green', icon: 'check', isPrivate: false });
    await tick();
    offline('/api/families/f1/lists', 'POST');
    const list = await created;
    expect(list.createdBy?.id).toBe('u1');
    expect(list.permissions.canEdit).toBe(true);
    expect(status.queued()).toBe(1);

    // Y se puede abrir y usar antes de sincronizar
    const opened = store.detail(list.id);
    await tick();
    offline('/api/families/f1/lists', 'POST');
    expect((await opened).name).toBe('Viaje');
  });

  afterEach(() => http.verify());
});
