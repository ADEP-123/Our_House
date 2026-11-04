import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  it('muestra el título', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Our House');
  });

  it('muestra conectado cuando /api/health responde 200', async () => {
    const fixture = TestBed.createComponent(App);
    http.expectOne('/api/health').flush({ status: 'ok', db: 'up' });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.status')?.textContent).toContain('conectados');
  });

  it('distingue base de datos caída de servidor caído', async () => {
    const fixture = TestBed.createComponent(App);
    http
      .expectOne('/api/health')
      .flush({ status: 'degraded', db: 'down' }, { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.status')?.textContent).toContain('base de datos sin conexión');
  });
});
