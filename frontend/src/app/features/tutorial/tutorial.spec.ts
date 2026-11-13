import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService, User } from '../../core/auth/auth.service';
import { PracticeMode } from './practice-mode.service';
import { practiceInterceptor } from './practice.interceptor';
import { TourDefinition, TutorialService } from './tutorial.service';

const tick = () => new Promise((resolve) => setTimeout(resolve));

const realUser = {
  id: 'u1',
  nickname: 'ana',
  locale: 'es',
  theme: null,
  avatarUrl: null,
  avatarPreset: null,
  notifications: {
    newLists: true,
    assignments: true,
    reminders: true,
    secretViews: true,
    finance: true,
    scheduled: true,
  },
  reminders: { hour: 8, startDays: 3, everyDays: 1 },
  calendarPromptDismissed: false,
  tutorials: {},
} as unknown as User;

function setup() {
  const user = signal<User | null>(structuredClone(realUser));
  const router = { url: '/listas', navigateByUrl: vi.fn(async () => true) };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([practiceInterceptor])),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { user, setUser: (u: User | null) => user.set(u) } },
      { provide: Router, useValue: router },
    ],
  });
  return {
    user,
    router,
    http: TestBed.inject(HttpClient),
    backend: TestBed.inject(HttpTestingController),
    practice: TestBed.inject(PracticeMode),
    tutorial: TestBed.inject(TutorialService),
  };
}

describe('modo práctica', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('ningún cambio llega al servidor: la cuenta se responde en memoria y lo demás se rechaza', async () => {
    const { http, backend, practice } = setup();
    practice.start();

    const theme = { preset: 'navidad', colors: {} };
    const res = await firstValueFrom(http.put<{ user: User }>('/api/me/theme', { theme }));
    expect(res.user.theme).toEqual(theme);
    const settings = await firstValueFrom(
      http.patch<{ user: User }>('/api/me/settings', { reminders: false, reminderHour: 20 }),
    );
    expect(settings.user.notifications.reminders).toBe(false);
    expect(settings.user.reminders.hour).toBe(20);

    await expect(
      firstValueFrom(http.post('/api/lists/l1/items', { text: 'x' })),
    ).rejects.toMatchObject({ status: 403, error: { error: 'PRACTICE_MODE' } });
    await expect(
      firstValueFrom(http.delete('/api/me', { body: { password: 'x' } })),
    ).rejects.toMatchObject({ status: 403 });

    // Leer y guardar el avance del tutorial sí pasan
    void firstValueFrom(http.get('/api/lists/l1'));
    void firstValueFrom(http.put('/api/me/tutorials/lists', { state: 'done' }));
    backend.expectOne('/api/lists/l1').flush({});
    backend.expectOne('/api/me/tutorials/lists').flush({});
  });

  it('fuera de la práctica todo va al servidor', async () => {
    const { http, backend } = setup();
    void firstValueFrom(http.put('/api/me/theme', { theme: null }));
    backend.expectOne('/api/me/theme').flush({ user: realUser });
  });

  it('al salir la cuenta vuelve a como estaba, conservando el estado de los tutoriales', () => {
    const { user, practice } = setup();
    practice.start();
    user.set({
      ...user()!,
      locale: 'en',
      theme: { preset: 'navidad' } as never,
      tutorials: { lists: { state: 'done' } },
    });
    practice.end();
    expect(user()).toMatchObject({
      locale: 'es',
      theme: null,
      tutorials: { lists: { state: 'done' } },
    });
  });
});

describe('tutoriales', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  const step = (id: string, until?: () => boolean) =>
    ({ id, title: 'tutorial.next', body: 'tutorial.next', until }) as never;
  const definition: TourDefinition = {
    id: 'lists',
    steps: [step('a'), step('b')],
    extras: [{ id: 'x', title: 'tutorial.next', steps: [step('x1')] }],
  };

  it('invita una sola vez a quien no lo vio y ofrece seguir donde quedó', () => {
    const { user, tutorial } = setup();
    tutorial.offer('lists');
    expect(tutorial.invite()).toEqual({ id: 'lists', step: null });
    tutorial.invite.set(null);
    tutorial.offer('lists');
    expect(tutorial.invite()).toBeNull();

    user.set({ ...user()!, tutorials: { account: { state: 'progress', step: 3 } } });
    tutorial.offer('account');
    expect(tutorial.invite()).toEqual({ id: 'account', step: 3 });
    tutorial.invite.set(null);

    user.set({ ...user()!, tutorials: { calendar: { state: 'skipped' } } });
    tutorial.offer('calendar');
    expect(tutorial.invite()).toBeNull();
  });

  it('avanza, guarda el paso, termina con los opcionales y vuelve a la pantalla de antes', async () => {
    const { tutorial, backend, router, practice, user } = setup();
    tutorial.start('lists');
    expect(practice.active()).toBe(true);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/tutorial/listas');
    tutorial.attach(definition);
    expect(tutorial.step()?.id).toBe('a');

    tutorial.next();
    backend
      .expectOne('/api/me/tutorials/lists')
      .flush({ user: { ...realUser, tutorials: { lists: { state: 'progress', step: 1 } } } });
    await tick();
    expect(user()?.tutorials?.lists).toEqual({ state: 'progress', step: 1 });

    tutorial.next();
    expect(tutorial.atEnd()).toBe(true);
    const done = backend.expectOne('/api/me/tutorials/lists');
    expect(done.request.body).toEqual({ state: 'done' });
    done.flush({ user: { ...realUser, tutorials: { lists: { state: 'done' } } } });
    await tick();

    expect(tutorial.pendingExtras().map((x) => x.id)).toEqual(['x']);
    tutorial.runExtra(definition.extras[0]!);
    expect(tutorial.step()?.id).toBe('x1');
    tutorial.next();
    expect(tutorial.atEnd()).toBe(true);
    expect(tutorial.pendingExtras()).toEqual([]);

    tutorial.finish();
    expect(practice.active()).toBe(false);
    expect(router.navigateByUrl).toHaveBeenLastCalledWith('/listas');
  });

  it('saltar cuenta como visto', async () => {
    const { tutorial, backend } = setup();
    tutorial.offer('lists');
    tutorial.skipInvite();
    const req = backend.expectOne('/api/me/tutorials/lists');
    expect(req.request.body).toEqual({ state: 'skipped' });
    req.flush({ user: { ...realUser, tutorials: { lists: { state: 'skipped' } } } });
    await tick();
    expect(tutorial.seen('lists')).toBe(true);
  });
});
