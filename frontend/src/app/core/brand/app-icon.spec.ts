import { appIconDataUrl, appIconSvg } from './app-icon';

describe('ícono de la app', () => {
  it('usa los colores pedidos y, en la versión maskable, deja el dibujo en la zona segura', () => {
    const svg = appIconSvg({ background: '#2f6b4f', foreground: '#ffffff' });
    expect(svg).toContain('fill="#2f6b4f"');
    expect(svg).toContain('stroke="#ffffff"');
    expect(svg).toContain('rx="112"');
    const maskable = appIconSvg({ background: '#2f6b4f', foreground: '#ffffff', maskable: true });
    expect(maskable).not.toContain('rx=');
    expect(maskable).toContain('scale(.8)');
  });

  it('sirve como href de un ícono', () => {
    expect(appIconDataUrl({ background: '#000', foreground: '#fff' })).toMatch(
      /^data:image\/svg\+xml,%3Csvg/,
    );
  });

  it('lleva el detalle de la fiesta solo en el ícono normal', () => {
    const colors = { background: '#000', foreground: '#fff' };
    expect(appIconSvg({ ...colors, decoration: 'navidad' })).toContain('#d62839');
    expect(appIconSvg({ ...colors, decoration: 'navidad', maskable: true })).not.toContain(
      '#d62839',
    );
    expect(appIconSvg(colors)).not.toContain('#d62839');
  });
});
