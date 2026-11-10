import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { signal } from '@angular/core';
import { AuthService } from './core/auth/auth.service';

describe('rutas', () => {
  it('sin sesión, la raíz lleva al inicio de sesión (no a una pantalla vacía)', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), { provide: AuthService, useValue: { ensureLoaded: async () => null, user: signal(null) } }],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');
    expect(TestBed.inject(Router).url).toBe('/ingresar?volver=%2Finicio');
  });
});
