import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { AuthService, User } from '../../../core/auth/auth.service';
import { PracticeMode } from '../../tutorial/practice-mode.service';
import { practiceInterceptor } from '../../tutorial/practice.interceptor';
import { FamilyAccounts } from '../finance.models';
import { FinancePractice } from './finance-practice';

const user = { id: 'u1', nickname: 'ana', tutorials: {} } as unknown as User;

describe('práctica de Finanzas sobre las pantallas reales', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let practice: PracticeMode;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([practiceInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(user), setUser: () => undefined } },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    practice = TestBed.inject(PracticeMode);
    practice.start();
    practice.use(
      new FinancePractice({
        id: 'u1',
        nickname: 'ana',
        familyId: 'f1',
        currency: 'USD',
        locale: 'es',
      }),
    );
  });
  afterEach(() => {
    practice.end();
    backend.verify();
  });

  it('las lecturas y los cambios de Finanzas se responden en memoria', async () => {
    const data = await firstValueFrom(http.get<FamilyAccounts>('/api/families/f1/accounts'));
    expect(data.accounts.map((a) => a.name)).toEqual(['Efectivo']);
    const id = data.accounts[0]!.id;
    const created = await firstValueFrom(
      http.post<{ id: string }>(`/api/accounts/${id}/movements`, {
        kind: 'in',
        amount: 10,
        date: '2026-11-12',
        description: 'Prueba',
        categoryId: (
          await firstValueFrom(
            http.get<{ categories: { id: string }[] }>('/api/families/f1/categories'),
          )
        ).categories[0]!.id,
      }),
    );
    expect(created.id).toBeTruthy();
  });

  it('lo de Finanzas sin respuesta de práctica tampoco sale (ej. exportar)', async () => {
    await expect(firstValueFrom(http.get('/api/families/f1/export'))).rejects.toMatchObject({
      status: 403,
      error: { error: 'PRACTICE_MODE' },
    });
  });

  it('las lecturas de otros módulos sí pasan; al terminar, Finanzas vuelve al servidor', async () => {
    const read = firstValueFrom(http.get('/api/families/f1'));
    backend.expectOne('/api/families/f1').flush({ family: {} });
    await read;
    expect(practice.handler).not.toBeNull();
    const before = practice.revision();
    practice.end();
    expect(practice.handler).toBeNull();
    expect(practice.revision()).toBe(before + 1);
    const real = firstValueFrom(http.get('/api/families/f1/accounts'));
    backend.expectOne('/api/families/f1/accounts').flush({ accounts: [] });
    await real;
  });
});
