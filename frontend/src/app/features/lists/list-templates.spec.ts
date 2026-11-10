import { DEFAULT_FEATURES, LIST_FEATURES, LIST_ICONS } from './list-presets';
import { LIST_TEMPLATES } from './list-templates';

describe('plantillas de listas', () => {
  it('tienen id único, ícono conocido y los mismos elementos en los dos idiomas', () => {
    expect(new Set(LIST_TEMPLATES.map((t) => t.id)).size).toBe(LIST_TEMPLATES.length);
    for (const t of LIST_TEMPLATES) {
      expect(LIST_ICONS[t.icon]).toBeTruthy();
      expect(t.items.es.length).toBe(t.items.en.length);
      for (const f of t.features ?? []) expect(LIST_FEATURES.map((x) => x.id)).toContain(f);
    }
  });

  it('las que se repiten o reparten turnos nacen en listas con esas opciones', () => {
    for (const t of LIST_TEMPLATES.filter((x) => x.repeat || x.rotation)) {
      const features = t.features ?? DEFAULT_FEATURES[t.type];
      expect(features).toContain('repeat');
      if (t.rotation) expect(features).toContain('assignee');
    }
  });
});
