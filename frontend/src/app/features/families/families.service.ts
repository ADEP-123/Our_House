import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type FamilyRole = 'leader' | 'member' | 'supervised';
export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled';

export interface FamilySummary {
  id: string;
  name: string;
  avatarUrl: string | null;
  avatarPreset: string | null;
  role: FamilyRole;
  memberCount: number;
}

export interface FamilyMember {
  userId: string;
  nickname: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  avatarPreset: string | null;
  role: FamilyRole;
  joinedAt: string;
}

export interface FamilyDetail extends Omit<FamilySummary, 'memberCount'> {
  inviteCode: string | null;
  members: FamilyMember[];
}

export interface SentInvitation {
  id: string;
  email: string;
  status: InvitationStatus;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface ReceivedInvitation {
  id: string;
  family: { id: string; name: string; avatarUrl: string | null; avatarPreset: string | null };
  invitedBy: string | null;
  expiresAt: string;
}

const ACTIVE_KEY = 'oh_active_family';

/**
 * Grupos del usuario y cuál está activo. El grupo activo es el que usarán
 * los próximos módulos (tareas, calendario, finanzas).
 */
@Injectable({ providedIn: 'root' })
export class FamiliesService {
  private readonly http = inject(HttpClient);

  private readonly list = signal<FamilySummary[] | null>(null);
  private readonly activeId = signal<string | null>(this.readActive());
  readonly families = this.list.asReadonly();
  readonly received = signal<ReceivedInvitation[]>([]);

  /** El elegido, o el primero si el elegido ya no existe */
  readonly active = computed(() => {
    const list = this.list() ?? [];
    return list.find((f) => f.id === this.activeId()) ?? list[0] ?? null;
  });

  async load(): Promise<void> {
    const [{ families }, { invitations }] = await Promise.all([
      firstValueFrom(this.http.get<{ families: FamilySummary[] }>('/api/families')),
      firstValueFrom(this.http.get<{ invitations: ReceivedInvitation[] }>('/api/invitations')),
    ]);
    this.list.set(families);
    this.received.set(invitations);
  }

  setActive(id: string): void {
    this.activeId.set(id);
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      // sin almacenamiento: vale solo para esta visita
    }
  }

  private readActive(): string | null {
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  }

  async create(name: string): Promise<FamilySummary> {
    const { family } = await firstValueFrom(this.http.post<{ family: FamilySummary }>('/api/families', { name }));
    this.list.update((list) => [...(list ?? []), family]);
    if (!this.active() || this.list()!.length === 1) this.setActive(family.id);
    return family;
  }

  async join(code: string): Promise<{ id: string; name: string }> {
    const { family } = await firstValueFrom(this.http.post<{ family: { id: string; name: string } }>('/api/families/join', { code }));
    await this.load();
    return family;
  }

  async respond(invitationId: string, accept: boolean): Promise<void> {
    await firstValueFrom(this.http.post(`/api/invitations/${invitationId}/${accept ? 'accept' : 'reject'}`, {}));
    await this.load();
  }

  // ---------- Un grupo ----------

  async detail(id: string): Promise<FamilyDetail> {
    return (await firstValueFrom(this.http.get<{ family: FamilyDetail }>(`/api/families/${id}`))).family;
  }

  private async mutate(request: Promise<{ family: FamilyDetail }>): Promise<FamilyDetail> {
    const { family } = await request;
    // Mantiene la lista al día (nombre, imagen, cantidad de miembros, rol)
    this.list.update((list) =>
      (list ?? []).map((f) =>
        f.id === family.id
          ? { ...f, name: family.name, avatarUrl: family.avatarUrl, avatarPreset: family.avatarPreset, role: family.role, memberCount: family.members.length }
          : f,
      ),
    );
    return family;
  }

  rename(id: string, name: string) {
    return this.mutate(firstValueFrom(this.http.patch<{ family: FamilyDetail }>(`/api/families/${id}`, { name })));
  }

  uploadAvatar(id: string, file: File) {
    return this.mutate(
      firstValueFrom(
        this.http.put<{ family: FamilyDetail }>(`/api/families/${id}/avatar`, file, { headers: { 'Content-Type': file.type } }),
      ),
    );
  }

  setAvatarPreset(id: string, preset: string | null) {
    return this.mutate(firstValueFrom(this.http.put<{ family: FamilyDetail }>(`/api/families/${id}/avatar-preset`, { preset })));
  }

  setRole(id: string, userId: string, role: FamilyRole) {
    return this.mutate(firstValueFrom(this.http.patch<{ family: FamilyDetail }>(`/api/families/${id}/members/${userId}`, { role })));
  }

  expel(id: string, userId: string) {
    return this.mutate(firstValueFrom(this.http.delete<{ family: FamilyDetail }>(`/api/families/${id}/members/${userId}`)));
  }

  async leave(id: string): Promise<void> {
    await firstValueFrom(this.http.post(`/api/families/${id}/leave`, {}));
    this.list.update((list) => (list ?? []).filter((f) => f.id !== id));
  }

  async regenerateCode(id: string): Promise<string> {
    return (await firstValueFrom(this.http.post<{ inviteCode: string }>(`/api/families/${id}/invite-code`, {}))).inviteCode;
  }

  async invitations(id: string): Promise<SentInvitation[]> {
    return (await firstValueFrom(this.http.get<{ invitations: SentInvitation[] }>(`/api/families/${id}/invitations`))).invitations;
  }

  invite(id: string, target: string) {
    return firstValueFrom(this.http.post(`/api/families/${id}/invitations`, { target }));
  }

  resendInvitation(id: string, invitationId: string) {
    return firstValueFrom(this.http.post(`/api/families/${id}/invitations/${invitationId}/resend`, {}));
  }

  cancelInvitation(id: string, invitationId: string) {
    return firstValueFrom(this.http.delete(`/api/families/${id}/invitations/${invitationId}`));
  }
}
