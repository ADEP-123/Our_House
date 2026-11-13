import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface ListPaymentSummary {
  id: string;
  amount: number;
  items: number;
  /** false: "No registrar" (se dio por pagado sin movimiento) */
  registered: boolean;
  account: { id: string; name: string | null } | null;
  movementCode: string | null;
  movementDeleted: boolean;
  by: { id: string; nickname: string | null } | null;
  at: string;
}

/** Lo pendiente de registrar de una lista de compras y dónde se puede registrar */
export interface ListPaymentsData {
  currency: string;
  canRegister: boolean;
  total: number;
  items: { id: string; text: string; amount: number }[];
  /** Última cuenta usada en la lista (si la persona todavía puede registrar en ella) */
  accountId: string | null;
  categoryId: string | null;
  accounts: { id: string; name: string; kind: string }[];
  categories: { id: string; name: string; icon: string }[];
  /** Artículos que están en un pago con movimiento: desmarcarlos lo descuenta */
  paidItems: string[];
  recent: ListPaymentSummary[];
}

export interface RegisterPaymentInput {
  id: string;
  accountId: string | null;
  categoryId?: string | null;
  date?: string;
}

/**
 * "Registrar pago" de la lista abierta (necesita conexión). La barra de pago y la lista
 * comparten el estado: la lista lo usa para avisar antes de desmarcar algo ya registrado.
 */
@Injectable({ providedIn: 'root' })
export class ListPaymentsService {
  private readonly http = inject(HttpClient);
  private listId: string | null = null;
  readonly data = signal<ListPaymentsData | null>(null);

  /** Cambia de lista: se olvida lo de la anterior */
  open(listId: string): void {
    if (this.listId === listId) return;
    this.listId = listId;
    this.data.set(null);
  }

  /** Sin conexión queda lo último que se trajo */
  async refresh(): Promise<void> {
    const listId = this.listId;
    if (!listId) return;
    try {
      const data = await firstValueFrom(
        this.http.get<ListPaymentsData>(`/api/lists/${listId}/payments`),
      );
      if (this.listId === listId) this.data.set(data);
    } catch {
      /* se reintenta en la próxima actualización */
    }
  }

  isPaid(itemId: string): boolean {
    return this.data()?.paidItems.includes(itemId) ?? false;
  }

  async register(
    input: RegisterPaymentInput,
  ): Promise<{ amount: number; items: number; movementCode: string | null }> {
    const result = await firstValueFrom(
      this.http.post<{ amount: number; items: number; movementCode: string | null }>(
        `/api/lists/${this.listId}/payments`,
        input,
      ),
    );
    await this.refresh();
    return result;
  }
}
