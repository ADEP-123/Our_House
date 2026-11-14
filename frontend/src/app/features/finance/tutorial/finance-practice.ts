import { HttpRequest } from '@angular/common/http';
import { PracticeHandler, PracticeResponse } from '../../tutorial/practice-mode.service';
import { localToday } from '../finance-logic';
import {
  Account,
  AccountInput,
  AccountKind,
  Category,
  Movement,
  MovementColumn,
  MovementKind,
  Scheduled,
  ScheduledInput,
  SavingsProject,
  SummaryConfig,
} from '../finance.models';
import { MAX_PERIODS, buildPeriods, buildSummary, type SummaryFreq } from './practice-summary';

/** Datos de la persona que hace el tutorial (para "creado por" y la moneda) */
export interface PracticeUser {
  id: string;
  nickname: string;
  familyId: string;
  currency: string;
  locale: 'es' | 'en';
}

interface PAccount {
  id: string;
  name: string;
  description: string | null;
  kind: AccountKind;
  prefix: string;
  creditLimit: number | null;
  lowBalanceThreshold: number | null;
  lastNumber: number;
  createdAt: string;
}

interface PMovement {
  id: string;
  accountId: string;
  number: number;
  kind: MovementKind;
  amount: number;
  date: string;
  description: string;
  categoryId: string | null;
  transferId: string | null;
  savingsProjectId: string | null;
  deleted: boolean;
  edited: boolean;
  createdAt: string;
}

interface PProject {
  id: string;
  name: string;
  icon: string;
  goal: number | null;
  targetDate: string | null;
  closedAt: string | null;
}

interface PEntry {
  projectId: string;
  accountId: string;
  kind: 'set_aside' | 'release';
  amount: number;
  at: string;
}

interface PScheduled extends Omit<ScheduledInput, 'id'> {
  id: string;
  nextDate: string | null;
  timesDone: number;
  paused: boolean;
}

/** Mismas categorías con que empieza cada grupo en el servidor */
const DEFAULT_CATEGORIES: Record<'es' | 'en', [string, string, string][]> = {
  es: [
    ['Alimentación', '🍽️', 'orange'],
    ['Transporte', '🚗', 'blue'],
    ['Arriendo', '🏠', 'purple'],
    ['Servicios', '💡', 'yellow'],
    ['Salud', '💊', 'red'],
    ['Educación', '📚', 'teal'],
    ['Ocio', '🎉', 'pink'],
    ['Deporte', '🏋️', 'green'],
    ['Ingresos', '💰', 'green'],
    ['Otros', '📦', 'gray'],
  ],
  en: [
    ['Food', '🍽️', 'orange'],
    ['Transport', '🚗', 'blue'],
    ['Rent', '🏠', 'purple'],
    ['Utilities', '💡', 'yellow'],
    ['Health', '💊', 'red'],
    ['Education', '📚', 'teal'],
    ['Leisure', '🎉', 'pink'],
    ['Sports', '🏋️', 'green'],
    ['Income', '💰', 'green'],
    ['Other', '📦', 'gray'],
  ],
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** N meses después, en el día pedido (31 cae en el último día de los meses cortos) */
function addMonthsClamped(date: string, months: number, day: number): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, last)))
    .toISOString()
    .slice(0, 10);
}
const code = (prefix: string, n: number) => `${prefix}${String(n).padStart(4, '0')}`;
const signed = (m: Pick<PMovement, 'kind' | 'amount'>) =>
  m.kind === 'out' || m.kind === 'transfer_out' ? -m.amount : m.amount;
const ok = (body: unknown, status = 200): PracticeResponse => ({ status, body });
const fail = (
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
): PracticeResponse => ({
  status,
  body: { error, ...extra },
});

type Route = [
  method: string,
  pattern: RegExp,
  handler: (m: RegExpMatchArray, req: HttpRequest<unknown>) => PracticeResponse,
];

/**
 * Finanzas de práctica para el tutorial: una copia en memoria de lo que hace el servidor
 * (cuentas, movimientos, transferencias, categorías, presupuesto, ahorros, programados y resumen),
 * con las mismas respuestas. Empieza con una cuenta de efectivo con dos movimientos y
 * se descarta al terminar el tutorial.
 */
export class FinancePractice implements PracticeHandler {
  private readonly accounts: PAccount[] = [];
  private readonly movements: PMovement[] = [];
  private readonly categories: Category[];
  private readonly budgets = new Map<string, number>();
  private readonly projects: PProject[] = [];
  private readonly entries: PEntry[] = [];
  private readonly scheduled: PScheduled[] = [];
  private readonly hidden = new Map<string, MovementColumn[]>();
  private summaryPrefs: SummaryConfig | null = null;
  private readonly events: Record<string, number> = {};
  private seq = 0;
  private readonly routes: Route[];

  constructor(
    private readonly user: PracticeUser,
    private readonly today = localToday(),
  ) {
    this.categories = DEFAULT_CATEGORIES[user.locale].map(([name, icon, color]) => ({
      id: this.newId(),
      name,
      icon,
      color,
      disabled: false,
      usage: 0,
    }));
    const cash = this.addAccount({
      name: user.locale === 'en' ? 'Cash' : 'Efectivo',
      kind: 'cash',
      prefix: 'E',
    });
    const month = this.today.slice(0, 8);
    this.addMovement(cash, { kind: 'opening', amount: 150, date: `${month}01`, description: '' });
    const [food, , , , , , , , income] = this.categories;
    this.addMovement(cash, {
      kind: 'out',
      amount: 12.5,
      date: this.today,
      description: user.locale === 'en' ? 'Lunch' : 'Almuerzo',
      categoryId: food!.id,
    });
    this.addMovement(cash, {
      kind: 'in',
      amount: 40,
      date: `${month}01`,
      description: user.locale === 'en' ? 'Sold old clothes' : 'Venta de ropa usada',
      categoryId: income!.id,
    });
    this.routes = this.buildRoutes();
  }

  // ---------- Para el tutorial ----------

  counts(): Record<string, number> {
    return { ...this.events };
  }

  /** Al retomar el tutorial a mitad: la cuenta del banco que se crea en el paso del formulario */
  ensureBank(): { id: string; created: boolean } {
    const existing = this.accounts.find((a) => a.prefix !== 'E' && a.kind !== 'credit');
    if (existing) return { id: existing.id, created: false };
    const bank = this.addAccount({
      name: this.user.locale === 'en' ? 'Bank' : 'Banco',
      kind: 'bank',
      prefix: 'B',
    });
    this.addMovement(bank, { kind: 'opening', amount: 500, date: this.today, description: '' });
    return { id: bank.id, created: true };
  }

  /** Al retomar después del gasto: un gasto en la cuenta */
  ensureExpense(accountId: string): boolean {
    if (this.live(accountId).some((m) => m.kind === 'out')) return false;
    const food = this.categories[0]!;
    this.addMovement(this.account(accountId)!, {
      kind: 'out',
      amount: 25,
      date: this.today,
      description: this.user.locale === 'en' ? 'Groceries' : 'Supermercado',
      categoryId: food.id,
    });
    return true;
  }

  /** Capítulo de tarjetas: agrega una tarjeta con deuda para practicar el pago */
  addCreditCard(): { id: string; created: boolean } {
    const existing = this.accounts.find((a) => a.kind === 'credit');
    if (existing) return { id: existing.id, created: false };
    const card = this.addAccount({ name: 'Visa', kind: 'credit', prefix: 'V', creditLimit: 500 });
    this.addMovement(card, {
      kind: 'opening',
      amount: -180,
      date: `${this.today.slice(0, 8)}01`,
      description: '',
    });
    return { id: card.id, created: true };
  }

  owns(url: string): boolean {
    return (
      /^\/api\/(accounts|movements|transfers|categories|savings|scheduled)(\/|$)/.test(url) ||
      /^\/api\/families\/[^/]+\/(accounts|categories|summary|budgets|savings|scheduled|movement-suggestions|import|export)(\/|$)/.test(
        url,
      )
    );
  }

  handle(req: HttpRequest<unknown>): PracticeResponse | null {
    const url = req.url.split('?')[0]!;
    for (const [method, pattern, handler] of this.routes) {
      if (method !== req.method) continue;
      const m = url.match(pattern);
      if (m) return handler(m, req);
    }
    return null;
  }

  private emit(event: string): void {
    this.events[event] = (this.events[event] ?? 0) + 1;
  }

  private newId(): string {
    return crypto.randomUUID?.() ?? `p-${Date.now()}-${++this.seq}`;
  }

  // ---------- Datos ----------

  private addAccount(a: Partial<PAccount> & Pick<PAccount, 'name' | 'kind' | 'prefix'>): PAccount {
    const account: PAccount = {
      description: null,
      creditLimit: null,
      lowBalanceThreshold: null,
      lastNumber: 0,
      createdAt: new Date().toISOString(),
      ...a,
      id: a.id ?? this.newId(),
    };
    this.accounts.push(account);
    return account;
  }

  private addMovement(
    account: PAccount,
    m: Partial<PMovement> & Pick<PMovement, 'kind' | 'amount' | 'date' | 'description'>,
  ): PMovement {
    const movement: PMovement = {
      categoryId: null,
      transferId: null,
      savingsProjectId: null,
      deleted: false,
      edited: false,
      createdAt: new Date(Date.now() + this.seq++).toISOString(),
      ...m,
      id: m.id ?? this.newId(),
      accountId: account.id,
      number: ++account.lastNumber,
    };
    this.movements.push(movement);
    return movement;
  }

  private live(accountId?: string): PMovement[] {
    return this.movements.filter((m) => !m.deleted && (!accountId || m.accountId === accountId));
  }

  private balance(accountId: string): number {
    return r2(this.live(accountId).reduce((s, m) => s + signed(m), 0));
  }

  private account(id: string): PAccount | undefined {
    return this.accounts.find((a) => a.id === id);
  }

  /** Apartado de cada proyecto abierto en la cuenta (apartado - liberado - gastado) */
  private savingsIn(
    accountId: string,
  ): { id: string; name: string; icon: string; amount: number }[] {
    return this.projects
      .filter((p) => !p.closedAt)
      .map((p) => {
        const moved = this.entries
          .filter((e) => e.projectId === p.id && e.accountId === accountId)
          .reduce((s, e) => s + (e.kind === 'set_aside' ? e.amount : -e.amount), 0);
        const spent = this.live(accountId)
          .filter((m) => m.savingsProjectId === p.id && m.kind === 'out')
          .reduce((s, m) => s + m.amount, 0);
        return { id: p.id, name: p.name, icon: p.icon, amount: r2(Math.max(0, moved - spent)) };
      })
      .filter((p) => p.amount > 0);
  }

  private accountView(a: PAccount): Account {
    const balance = this.balance(a.id);
    const debt = r2(Math.max(0, -balance));
    const projects = this.savingsIn(a.id);
    const total = r2(projects.reduce((s, p) => s + p.amount, 0));
    const opening = this.live(a.id).find((m) => m.kind === 'opening');
    return {
      id: a.id,
      familyId: this.user.familyId,
      name: a.name,
      description: a.description,
      kind: a.kind,
      prefix: a.prefix,
      currency: this.user.currency,
      balance,
      credit:
        a.kind === 'credit'
          ? {
              limit: a.creditLimit ?? 0,
              debt,
              available: r2((a.creditLimit ?? 0) - debt),
              overLimit: debt > (a.creditLimit ?? 0),
            }
          : null,
      opening: opening
        ? { amount: opening.amount, date: opening.date, number: opening.number }
        : null,
      savings: { total, available: r2(balance - total), projects },
      lowBalanceThreshold: a.lowBalanceThreshold,
      viewMode: 'family',
      editMode: 'roles',
      editRoles: ['leader', 'member'],
      viewers: [],
      editors: [],
      owner: { id: this.user.id, nickname: this.user.nickname },
      archivedAt: null,
      createdAt: a.createdAt,
      permissions: { canEdit: true, canAdmin: true, supervision: false },
    };
  }

  private categoryView(id: string | null): Movement['category'] {
    const c = this.categories.find((x) => x.id === id);
    return c ? { id: c.id, name: c.name, icon: c.icon, color: c.color } : null;
  }

  /** Movimientos de la cuenta con el saldo acumulado (por fecha y luego por orden de creación) */
  private movementViews(accountId: string): Movement[] {
    const a = this.account(accountId)!;
    let running = 0;
    return this.live(accountId)
      .sort(
        (x, y) =>
          x.date.localeCompare(y.date) ||
          x.createdAt.localeCompare(y.createdAt) ||
          x.number - y.number,
      )
      .map((m) => {
        running = r2(running + signed(m));
        const other = m.transferId
          ? this.live().find((t) => t.transferId === m.transferId && t.id !== m.id)
          : null;
        const otherAccount = other ? this.account(other.accountId) : null;
        const project = this.projects.find((p) => p.id === m.savingsProjectId);
        return {
          id: m.id,
          code: code(a.prefix, m.number),
          number: m.number,
          kind: m.kind,
          amount: m.amount,
          signedAmount: signed(m),
          date: m.date,
          description: m.description,
          category: this.categoryView(m.categoryId),
          createdBy: { id: this.user.id, nickname: this.user.nickname },
          edited: m.edited,
          balance: running,
          createdAt: m.createdAt,
          scheduled: false,
          purchase: false,
          savings: project ? { id: project.id, name: project.name, icon: project.icon } : null,
          transfer: m.transferId
            ? {
                id: m.transferId,
                accountId: otherAccount?.id ?? null,
                accountName: otherAccount?.name ?? null,
                code: other && otherAccount ? code(otherAccount.prefix, other.number) : null,
              }
            : null,
        };
      });
  }

  // ---------- Rutas ----------

  private buildRoutes(): Route[] {
    const F = '^/api/families/[^/]+';
    const ID = '([^/]+)';
    return [
      ['GET', new RegExp(`${F}/accounts$`), (_, req) => this.listAccounts(req)],
      [
        'POST',
        new RegExp(`${F}/accounts$`),
        (_, req) => this.createAccount(req.body as AccountInput),
      ],
      ['GET', new RegExp(`^/api/accounts/${ID}$`), (m) => this.getAccount(m[1]!)],
      [
        'PUT',
        new RegExp(`^/api/accounts/${ID}$`),
        (m, req) => this.updateAccount(m[1]!, req.body as AccountInput),
      ],
      ['GET', new RegExp(`^/api/accounts/${ID}/movements$`), (m) => this.listMovements(m[1]!)],
      [
        'POST',
        new RegExp(`^/api/accounts/${ID}/movements$`),
        (m, req) => this.createMovement(m[1]!, req.body as Body),
      ],
      [
        'POST',
        new RegExp(`^/api/accounts/${ID}/adjust$`),
        (m, req) => this.adjust(m[1]!, req.body as Body),
      ],
      [
        'PUT',
        new RegExp(`^/api/accounts/${ID}/prefs$`),
        (m, req) => this.setPrefs(m[1]!, req.body as Body),
      ],
      [
        'PATCH',
        new RegExp(`^/api/movements/${ID}$`),
        (m, req) => this.updateMovement(m[1]!, req.body as Body),
      ],
      ['DELETE', new RegExp(`^/api/movements/${ID}$`), (m) => this.setDeleted(m[1]!, true)],
      ['POST', new RegExp(`^/api/movements/${ID}/restore$`), (m) => this.setDeleted(m[1]!, false)],
      ['GET', new RegExp(`^/api/movements/${ID}/history$`), (m) => this.history(m[1]!)],
      ['POST', /^\/api\/transfers$/, (_, req) => this.transfer(req.body as Body)],
      [
        'GET',
        new RegExp(`${F}/categories$`),
        () => ok({ canManage: true, categories: this.categoryList() }),
      ],
      ['POST', new RegExp(`${F}/categories$`), (_, req) => this.createCategory(req.body as Body)],
      [
        'PATCH',
        new RegExp(`^/api/categories/${ID}$`),
        (m, req) => this.updateCategory(m[1]!, req.body as Body),
      ],
      [
        'GET',
        new RegExp(`^/api/categories/${ID}/movements$`),
        (m) => this.categoryMovements(m[1]!),
      ],
      [
        'PUT',
        new RegExp(`^/api/categories/${ID}/budget$`),
        (m, req) => this.setBudget(m[1]!, req.body as Body),
      ],
      ['GET', new RegExp(`${F}/budgets$`), (_, req) => this.listBudgets(req.params.get('month'))],
      [
        'GET',
        new RegExp(`${F}/movement-suggestions$`),
        (_, req) => this.suggestions(req.params.get('q') ?? ''),
      ],
      ['GET', new RegExp(`${F}/summary/prefs$`), () => ok({ config: this.summaryPrefs })],
      [
        'PUT',
        new RegExp(`${F}/summary/prefs$`),
        (_, req) => this.saveSummaryPrefs(req.body as Body),
      ],
      ['GET', new RegExp(`${F}/summary$`), (_, req) => this.summary(req)],
      ['GET', new RegExp(`${F}/savings$`), () => this.listSavings()],
      ['POST', new RegExp(`${F}/savings$`), (_, req) => this.createProject(req.body as Body)],
      [
        'PUT',
        new RegExp(`^/api/savings/${ID}$`),
        (m, req) => this.updateProject(m[1]!, req.body as Body),
      ],
      [
        'POST',
        new RegExp(`^/api/savings/${ID}/move$`),
        (m, req) => this.moveSavings(m[1]!, req.body as Body),
      ],
      ['GET', new RegExp(`^/api/savings/${ID}/history$`), (m) => this.savingsHistory(m[1]!)],
      ['GET', new RegExp(`${F}/scheduled$`), () => this.listScheduled()],
      [
        'POST',
        new RegExp(`${F}/scheduled$`),
        (_, req) => this.createScheduled(req.body as ScheduledInput),
      ],
      [
        'GET',
        new RegExp(`${F}/scheduled/upcoming$`),
        (_, req) => this.upcoming(req.params.get('to') ?? this.today),
      ],
      ['GET', new RegExp(`${F}/scheduled/suggestions$`), () => ok({ suggestions: [] })],
      ['DELETE', new RegExp(`^/api/scheduled/${ID}$`), (m) => this.removeScheduled(m[1]!)],
      [
        'POST',
        new RegExp(`^/api/scheduled/${ID}/(pause|resume|skip)$`),
        (m) => this.scheduledAction(m[1]!, m[2]!),
      ],
    ];
  }

  // ---------- Cuentas ----------

  private listAccounts(req: HttpRequest<unknown>): PracticeResponse {
    const archived = req.params.get('archived') === 'true';
    return ok({
      currency: this.user.currency,
      accounts: archived ? [] : this.accounts.map((a) => this.accountView(a)),
      supervisedPrivate: [],
    });
  }

  private getAccount(id: string): PracticeResponse {
    const a = this.account(id);
    return a ? ok({ account: this.accountView(a) }) : fail(404, 'ACCOUNT_NOT_FOUND');
  }

  private checkAccountInput(input: AccountInput, exceptId: string | null): PracticeResponse | null {
    const fields: Record<string, string> = {};
    if (!input.name?.trim()) fields['name'] = 'ACCOUNT_NAME_REQUIRED';
    if (!/^[A-Za-z0-9]{1,4}$/.test(input.prefix ?? '')) fields['prefix'] = 'ACCOUNT_PREFIX_INVALID';
    if (input.kind === 'credit' && !(Number(input.creditLimit) > 0))
      fields['creditLimit'] = 'CREDIT_LIMIT_REQUIRED';
    if (Object.keys(fields).length) return fail(400, 'VALIDATION', { fields });
    const prefix = input.prefix.toUpperCase();
    if (this.accounts.some((a) => a.prefix === prefix && a.id !== exceptId))
      return fail(409, 'ACCOUNT_PREFIX_TAKEN');
    return null;
  }

  private createAccount(input: AccountInput): PracticeResponse {
    const error = this.checkAccountInput(input, null);
    if (error) return error;
    const account = this.addAccount({
      id: input.id,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      kind: input.kind,
      prefix: input.prefix.toUpperCase(),
      creditLimit: input.kind === 'credit' ? Number(input.creditLimit) : null,
      lowBalanceThreshold: input.lowBalanceThreshold ?? null,
    });
    if (input.opening && input.opening.amount) {
      this.addMovement(account, {
        kind: 'opening',
        amount: input.opening.amount,
        date: input.opening.date,
        description: '',
      });
    }
    this.emit('account.created');
    if (account.kind === 'credit') this.emit('account.created.credit');
    return ok({ account: this.accountView(account) }, 201);
  }

  private updateAccount(id: string, input: AccountInput): PracticeResponse {
    const a = this.account(id);
    if (!a) return fail(404, 'ACCOUNT_NOT_FOUND');
    const error = this.checkAccountInput(input, id);
    if (error) return error;
    Object.assign(a, {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      kind: input.kind,
      prefix: input.prefix.toUpperCase(),
      creditLimit: input.kind === 'credit' ? Number(input.creditLimit) : null,
      lowBalanceThreshold: input.lowBalanceThreshold ?? null,
    });
    const opening = this.live(id).find((m) => m.kind === 'opening');
    if (input.opening?.amount) {
      if (opening)
        Object.assign(opening, { amount: input.opening.amount, date: input.opening.date });
      else
        this.addMovement(a, {
          kind: 'opening',
          amount: input.opening.amount,
          date: input.opening.date,
          description: '',
        });
    } else if (opening) opening.deleted = true;
    return ok({ account: this.accountView(a) });
  }

  // ---------- Movimientos ----------

  private listMovements(accountId: string): PracticeResponse {
    if (!this.account(accountId)) return fail(404, 'ACCOUNT_NOT_FOUND');
    return ok({
      movements: this.movementViews(accountId),
      hiddenColumns: this.hidden.get(accountId) ?? [],
    });
  }

  private checkMovement(body: Body, partial: boolean): PracticeResponse | null {
    const fields: Record<string, string> = {};
    if ((!partial || body['amount'] !== undefined) && !(Number(body['amount']) > 0))
      fields['amount'] = 'MOVEMENT_AMOUNT_INVALID';
    if (
      (!partial || body['description'] !== undefined) &&
      !String(body['description'] ?? '').trim()
    )
      fields['description'] = 'MOVEMENT_DESCRIPTION_REQUIRED';
    if (
      (!partial || body['date'] !== undefined) &&
      !/^\d{4}-\d{2}-\d{2}$/.test(String(body['date'] ?? ''))
    )
      fields['date'] = 'DATE_INVALID';
    return Object.keys(fields).length ? fail(400, 'VALIDATION', { fields }) : null;
  }

  private createMovement(accountId: string, body: Body): PracticeResponse {
    const a = this.account(accountId);
    if (!a) return fail(404, 'ACCOUNT_NOT_FOUND');
    const error = this.checkMovement(body, false);
    if (error) return error;
    if (this.movements.some((m) => m.id === body['id'])) return ok({ id: body['id'] }, 201);
    if (!this.categories.some((c) => c.id === body['categoryId']))
      return fail(400, 'CATEGORY_REQUIRED');
    const kind = body['kind'] === 'in' ? 'in' : 'out';
    const savingsProjectId =
      kind === 'out' ? ((body['savingsProjectId'] as string | null) ?? null) : null;
    if (savingsProjectId) {
      const saved = this.savingsIn(accountId).find((p) => p.id === savingsProjectId)?.amount ?? 0;
      if (Number(body['amount']) > saved) return fail(400, 'SAVINGS_SPEND_TOO_MUCH', { saved });
    }
    const m = this.addMovement(a, {
      id: (body['id'] as string) ?? this.newId(),
      kind,
      amount: r2(Number(body['amount'])),
      date: String(body['date']),
      description: String(body['description']).trim(),
      categoryId: String(body['categoryId']),
      savingsProjectId,
    });
    this.emit('movement.created');
    this.emit(`movement.created.${kind}`);
    return ok({ id: m.id }, 201);
  }

  private updateMovement(id: string, body: Body): PracticeResponse {
    const m = this.movements.find((x) => x.id === id && !x.deleted);
    if (!m) return fail(404, 'MOVEMENT_NOT_FOUND');
    if (m.kind === 'opening') return fail(400, 'MOVEMENT_NOT_EDITABLE');
    const error = this.checkMovement(body, true);
    if (error) return error;
    const halves = m.transferId ? this.live().filter((t) => t.transferId === m.transferId) : [m];
    for (const h of halves) {
      if (body['amount'] !== undefined) h.amount = r2(Number(body['amount']));
      if (body['date'] !== undefined) h.date = String(body['date']);
      if (body['description'] !== undefined) h.description = String(body['description']).trim();
      if (!m.transferId) {
        if (body['kind'] === 'in' || body['kind'] === 'out') h.kind = body['kind'];
        if (body['categoryId']) h.categoryId = String(body['categoryId']);
        if (body['savingsProjectId'] !== undefined)
          h.savingsProjectId =
            h.kind === 'out' ? ((body['savingsProjectId'] as string) ?? null) : null;
      }
      h.edited = true;
    }
    this.emit('movement.updated');
    return ok({ id });
  }

  private setDeleted(id: string, deleted: boolean): PracticeResponse {
    const m = this.movements.find((x) => x.id === id);
    if (!m) return fail(404, 'MOVEMENT_NOT_FOUND');
    for (const h of m.transferId
      ? this.movements.filter((t) => t.transferId === m.transferId)
      : [m])
      h.deleted = deleted;
    this.emit(deleted ? 'movement.deleted' : 'movement.restored');
    return deleted ? { status: 204, body: null } : ok({ id });
  }

  private history(id: string): PracticeResponse {
    const m = this.movements.find((x) => x.id === id);
    if (!m) return fail(404, 'MOVEMENT_NOT_FOUND');
    const actor = { id: this.user.id, nickname: this.user.nickname };
    return ok({
      history: [{ id: `${id}-h`, action: 'created', changes: null, actor, at: m.createdAt }],
    });
  }

  private transfer(body: Body): PracticeResponse {
    const from = this.account(String(body['fromAccountId']));
    const to = this.account(String(body['toAccountId']));
    if (!from || !to) return fail(404, 'ACCOUNT_NOT_FOUND');
    if (from.id === to.id) return fail(400, 'TRANSFER_SAME_ACCOUNT');
    const error = this.checkMovement(body, false);
    if (error) return error;
    const transferId = String(body['id'] ?? this.newId());
    if (this.movements.some((m) => m.transferId === transferId)) return ok({ id: transferId }, 201);
    const base = {
      amount: r2(Number(body['amount'])),
      date: String(body['date']),
      description: String(body['description']).trim(),
      transferId,
    };
    this.addMovement(from, {
      ...base,
      id: String(body['outId'] ?? this.newId()),
      kind: 'transfer_out',
    });
    this.addMovement(to, {
      ...base,
      id: String(body['inId'] ?? this.newId()),
      kind: 'transfer_in',
    });
    this.emit('transfer.created');
    if (to.kind === 'credit') this.emit('transfer.created.card');
    return ok({ id: transferId }, 201);
  }

  private adjust(accountId: string, body: Body): PracticeResponse {
    const a = this.account(accountId);
    if (!a) return fail(404, 'ACCOUNT_NOT_FOUND');
    const diff = r2(Number(body['balance']) - this.balance(accountId));
    if (!diff) return fail(400, 'NOTHING_TO_ADJUST');
    const m = this.addMovement(a, {
      id: String(body['id'] ?? this.newId()),
      kind: 'adjust',
      amount: diff,
      date: String(body['date'] ?? this.today),
      description: String(body['description'] ?? ''),
    });
    this.emit('movement.adjusted');
    return ok({ id: m.id }, 201);
  }

  private setPrefs(accountId: string, body: Body): PracticeResponse {
    this.hidden.set(accountId, (body['hiddenColumns'] as MovementColumn[]) ?? []);
    return ok({ hiddenColumns: this.hidden.get(accountId) });
  }

  private suggestions(q: string): PracticeResponse {
    const query = q.trim().toLowerCase();
    const seen = new Set<string>();
    const suggestions = this.live()
      .filter(
        (m) =>
          (m.kind === 'in' || m.kind === 'out') && m.description.toLowerCase().startsWith(query),
      )
      .reverse()
      .filter(
        (m) => !seen.has(m.description.toLowerCase()) && !!seen.add(m.description.toLowerCase()),
      )
      .slice(0, 6)
      .map((m) => ({ description: m.description, kind: m.kind, categoryId: m.categoryId }));
    return ok({ suggestions });
  }

  // ---------- Categorías y presupuesto ----------

  private categoryList(): Category[] {
    return [...this.categories]
      .map((c) => ({ ...c, usage: this.live().filter((m) => m.categoryId === c.id).length }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private createCategory(body: Body): PracticeResponse {
    const name = String(body['name'] ?? '').trim();
    if (!name) return fail(400, 'VALIDATION', { fields: { name: 'CATEGORY_NAME_REQUIRED' } });
    if (this.categories.some((c) => c.name.toLowerCase() === name.toLowerCase()))
      return fail(409, 'CATEGORY_NAME_TAKEN');
    const category: Category = {
      id: String(body['id'] ?? this.newId()),
      name,
      icon: String(body['icon'] ?? '📦'),
      color: String(body['color'] ?? 'gray'),
      disabled: false,
      usage: 0,
    };
    this.categories.push(category);
    this.emit('category.created');
    return ok({ category }, 201);
  }

  private updateCategory(id: string, body: Body): PracticeResponse {
    const c = this.categories.find((x) => x.id === id);
    if (!c) return fail(404, 'CATEGORY_NOT_FOUND');
    if (body['name'] !== undefined) c.name = String(body['name']).trim() || c.name;
    if (body['icon'] !== undefined) c.icon = String(body['icon']);
    if (body['color'] !== undefined) c.color = String(body['color']);
    if (body['disabled'] !== undefined) c.disabled = !!body['disabled'];
    this.emit('category.updated');
    return ok({
      category: { ...c, usage: this.live().filter((m) => m.categoryId === c.id).length },
    });
  }

  private categoryMovements(id: string): PracticeResponse {
    const movements = this.live()
      .filter((m) => m.categoryId === id)
      .map((m) => {
        const a = this.account(m.accountId)!;
        return {
          id: m.id,
          account: { id: a.id, name: a.name },
          code: code(a.prefix, m.number),
          kind: m.kind,
          amount: m.amount,
          date: m.date,
          description: m.description,
        };
      });
    return ok({ movements, hiddenCount: 0 });
  }

  private setBudget(categoryId: string, body: Body): PracticeResponse {
    if (!this.categories.some((c) => c.id === categoryId)) return fail(404, 'CATEGORY_NOT_FOUND');
    const amount = body['amount'] === null ? null : Number(body['amount']);
    if (amount !== null && !(amount > 0))
      return fail(400, 'VALIDATION', { fields: { amount: 'BUDGET_INVALID' } });
    if (amount === null) this.budgets.delete(categoryId);
    else this.budgets.set(categoryId, r2(amount));
    this.emit('budget.set');
    return ok({ amount });
  }

  private listBudgets(month: string | null): PracticeResponse {
    const m = month ?? this.today.slice(0, 7);
    const budgets = [...this.budgets.entries()].map(([categoryId, limit]) => {
      const c = this.categories.find((x) => x.id === categoryId)!;
      const spent = r2(
        this.live()
          .filter((x) => x.kind === 'out' && x.categoryId === categoryId && x.date.startsWith(m))
          .reduce((s, x) => s + x.amount, 0),
      );
      return {
        categoryId,
        name: c.name,
        icon: c.icon,
        color: c.color,
        disabled: c.disabled,
        limit,
        spent,
        pct: Math.round((spent / limit) * 100),
      };
    });
    return ok({ month: m, canManage: true, budgets });
  }

  // ---------- Resumen ----------

  private summary(req: HttpRequest<unknown>): PracticeResponse {
    const from = req.params.get('from') ?? `${this.today.slice(0, 8)}01`;
    const to = req.params.get('to') ?? this.today;
    const freq = (req.params.get('freq') ?? 'month') as SummaryFreq;
    if (from > to) return fail(400, 'SUMMARY_RANGE_INVALID');
    if (buildPeriods(from, to, freq).length > MAX_PERIODS)
      return fail(400, 'SUMMARY_TOO_MANY_PERIODS');
    const chosen = (req.params.get('accounts') ?? '').split(',').filter(Boolean);
    const accounts = this.accounts.filter((a) => !chosen.length || chosen.includes(a.id));
    const ids = new Set(accounts.map((a) => a.id));
    return ok({
      currency: this.user.currency,
      available: this.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        archived: false,
      })),
      ...buildSummary({
        from,
        to,
        freq,
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          credit_limit: a.creditLimit,
        })),
        categories: this.categories,
        movements: this.live()
          .filter((m) => ids.has(m.accountId) && m.date <= to)
          .map((m) => ({
            account_id: m.accountId,
            kind: m.kind,
            amount: m.amount,
            date: m.date,
            category_id: m.categoryId,
          })),
      }),
    });
  }

  private saveSummaryPrefs(body: Body): PracticeResponse {
    this.summaryPrefs = (body['config'] as SummaryConfig) ?? null;
    return ok({ config: this.summaryPrefs });
  }

  // ---------- Ahorros ----------

  private projectView(p: PProject): SavingsProject {
    const accounts = this.accounts
      .map((a) => ({
        accountId: a.id,
        name: a.name,
        amount: this.savingsIn(a.id).find((x) => x.id === p.id)?.amount ?? 0,
      }))
      .filter((x) => x.amount > 0);
    const spent = this.live()
      .filter((m) => m.savingsProjectId === p.id && m.kind === 'out')
      .reduce((s, m) => s + m.amount, 0);
    return {
      ...p,
      createdBy: { id: this.user.id, nickname: this.user.nickname },
      canManage: true,
      saved: r2(accounts.reduce((s, a) => s + a.amount, 0)),
      spent: r2(spent),
      accounts,
    };
  }

  private listSavings(): PracticeResponse {
    return ok({
      currency: this.user.currency,
      projects: this.projects.map((p) => this.projectView(p)),
      accounts: this.accounts
        .filter((a) => a.kind !== 'credit')
        .map((a) => {
          const balance = this.balance(a.id);
          const saved = r2(this.savingsIn(a.id).reduce((s, p) => s + p.amount, 0));
          return {
            id: a.id,
            name: a.name,
            kind: a.kind,
            balance,
            saved,
            available: r2(balance - saved),
            canEdit: true,
          };
        }),
    });
  }

  private createProject(body: Body): PracticeResponse {
    const name = String(body['name'] ?? '').trim();
    if (!name) return fail(400, 'VALIDATION', { fields: { name: 'SAVINGS_NAME_REQUIRED' } });
    const project: PProject = {
      id: String(body['id'] ?? this.newId()),
      name,
      icon: String(body['icon'] ?? '🎯'),
      goal: body['goal'] ? Number(body['goal']) : null,
      targetDate: (body['targetDate'] as string | null) ?? null,
      closedAt: null,
    };
    if (!this.projects.some((p) => p.id === project.id)) this.projects.push(project);
    this.emit('savings.created');
    return ok({ id: project.id }, 201);
  }

  private updateProject(id: string, body: Body): PracticeResponse {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return fail(404, 'SAVINGS_NOT_FOUND');
    Object.assign(p, {
      name: String(body['name'] ?? p.name).trim() || p.name,
      icon: String(body['icon'] ?? p.icon),
      goal: body['goal'] ? Number(body['goal']) : null,
      targetDate: (body['targetDate'] as string | null) ?? null,
    });
    return ok({ id });
  }

  private moveSavings(id: string, body: Body): PracticeResponse {
    const p = this.projects.find((x) => x.id === id);
    const a = this.account(String(body['accountId']));
    if (!p) return fail(404, 'SAVINGS_NOT_FOUND');
    if (!a) return fail(404, 'ACCOUNT_NOT_FOUND');
    if (a.kind === 'credit') return fail(400, 'SAVINGS_CREDIT_ACCOUNT');
    const amount = r2(Number(body['amount']));
    if (!(amount > 0))
      return fail(400, 'VALIDATION', { fields: { amount: 'SAVINGS_AMOUNT_INVALID' } });
    const saved = this.savingsIn(a.id).find((x) => x.id === id)?.amount ?? 0;
    if (body['action'] === 'release') {
      if (amount > saved) return fail(400, 'SAVINGS_RELEASE_TOO_MUCH', { saved });
    } else {
      const available = r2(
        this.balance(a.id) - this.savingsIn(a.id).reduce((s, x) => s + x.amount, 0),
      );
      if (amount > available) return fail(400, 'SAVINGS_NOT_ENOUGH', { available });
    }
    this.entries.push({
      projectId: id,
      accountId: a.id,
      kind: body['action'] === 'release' ? 'release' : 'set_aside',
      amount,
      at: new Date().toISOString(),
    });
    this.emit('savings.moved');
    return ok({ project: this.projectView(p) });
  }

  private savingsHistory(id: string): PracticeResponse {
    const actor = { id: this.user.id, nickname: this.user.nickname };
    const history = this.entries
      .filter((e) => e.projectId === id)
      .map((e) => {
        const a = this.account(e.accountId)!;
        return {
          kind: e.kind,
          amount: e.amount,
          account: { id: a.id, name: a.name },
          actor,
          description: null,
          date: null,
          at: e.at,
        };
      })
      .reverse();
    return ok({ history });
  }

  // ---------- Programados ----------

  /** Primera fecha desde hoy según la regla (lo pasado no se registra en la práctica) */
  private firstFrom(rule: ScheduledInput['rule'], from: string): string {
    let date = rule.start;
    let guard = 0;
    while (date < from && guard++ < 2000) date = this.nextOf(rule, date);
    return date;
  }

  private nextOf(rule: ScheduledInput['rule'], date: string): string {
    const step = Math.max(1, rule.interval || 1);
    if (rule.freq === 'monthly')
      return addMonthsClamped(date, step, Number(rule.start.slice(8, 10)));
    if (rule.freq === 'yearly')
      return addMonthsClamped(date, 12 * step, Number(rule.start.slice(8, 10)));
    const days = rule.freq === 'weekly' ? 7 * step : step;
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  private scheduledView(s: PScheduled): Scheduled {
    const a = this.account(s.accountId);
    const to = s.toAccountId ? this.account(s.toAccountId) : null;
    const c = this.categories.find((x) => x.id === s.categoryId);
    const p = this.projects.find((x) => x.id === s.savingsProjectId);
    return {
      id: s.id,
      kind: s.kind,
      account: { id: s.accountId, name: a?.name ?? '' },
      toAccount: to ? { id: to.id, name: to.name } : null,
      category: c ? { id: c.id, name: c.name, icon: c.icon, color: c.color } : null,
      project: p ? { id: p.id, name: p.name, icon: p.icon } : null,
      amount: s.amount,
      description: s.description,
      mode: s.mode,
      rule: s.rule,
      nextDate: s.nextDate,
      timesDone: s.timesDone,
      remindDays: s.remindDays,
      notifyDone: s.notifyDone,
      paused: s.paused ? { reason: 'manual' } : null,
      ended: false,
      canManage: true,
      createdBy: { id: this.user.id, nickname: this.user.nickname },
    };
  }

  private listScheduled(): PracticeResponse {
    return ok({
      currency: this.user.currency,
      items: this.scheduled.map((s) => this.scheduledView(s)),
      pending: [],
    });
  }

  private createScheduled(input: ScheduledInput): PracticeResponse {
    if (!this.account(input.accountId)) return fail(404, 'ACCOUNT_NOT_FOUND');
    if (!(Number(input.amount) > 0))
      return fail(400, 'VALIDATION', { fields: { amount: 'MOVEMENT_AMOUNT_INVALID' } });
    if (!input.description?.trim())
      return fail(400, 'VALIDATION', { fields: { description: 'MOVEMENT_DESCRIPTION_REQUIRED' } });
    const id = input.id ?? this.newId();
    if (!this.scheduled.some((s) => s.id === id)) {
      this.scheduled.push({
        ...input,
        id,
        nextDate: this.firstFrom(input.rule, this.today),
        timesDone: 0,
        paused: false,
      });
    }
    this.emit('scheduled.created');
    return ok({ id }, 201);
  }

  private removeScheduled(id: string): PracticeResponse {
    const i = this.scheduled.findIndex((s) => s.id === id);
    if (i >= 0) this.scheduled.splice(i, 1);
    return { status: 204, body: null };
  }

  private scheduledAction(id: string, action: string): PracticeResponse {
    const s = this.scheduled.find((x) => x.id === id);
    if (!s) return fail(404, 'SCHEDULED_NOT_FOUND');
    if (action === 'pause') s.paused = true;
    if (action === 'resume') {
      s.paused = false;
      s.nextDate = this.firstFrom(
        s.rule,
        s.nextDate && s.nextDate > this.today ? s.nextDate : this.today,
      );
    }
    if (action === 'skip' && s.nextDate) s.nextDate = this.nextOf(s.rule, s.nextDate);
    return ok({ id });
  }

  private upcoming(to: string): PracticeResponse {
    const items = this.scheduled
      .filter((s) => !s.paused && s.nextDate)
      .flatMap((s) => {
        const dates: string[] = [];
        let d = s.nextDate!;
        while (d <= to && dates.length < 62) {
          dates.push(d);
          d = this.nextOf(s.rule, d);
        }
        const a = this.account(s.accountId)!;
        const t = s.toAccountId ? this.account(s.toAccountId) : null;
        return dates.map((date) => ({
          scheduleId: s.id,
          date,
          kind: s.kind,
          amount: s.amount,
          description: s.description,
          mode: s.mode,
          accountId: a.id,
          accountName: a.name,
          toAccountId: t?.id ?? null,
          toAccountName: t?.name ?? null,
        }));
      })
      .sort((x, y) => x.date.localeCompare(y.date));
    return ok({ items });
  }
}

type Body = Record<string, unknown>;
