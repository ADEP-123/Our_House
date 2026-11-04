import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { ApiState, HealthService } from './core/health.service';

const STATE_LABEL: Record<ApiState, string> = {
  up: 'Servidor y base de datos conectados',
  degraded: 'Servidor activo, base de datos sin conexión',
  offline: 'No se pudo contactar al servidor',
};

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly state = toSignal(inject(HealthService).check());
  protected readonly labels = STATE_LABEL;
}
