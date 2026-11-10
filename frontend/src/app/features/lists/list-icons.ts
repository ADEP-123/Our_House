/**
 * Íconos para elegir, agrupados y con palabras para buscarlos (en español e inglés).
 * Se guardan como el emoji mismo; los primeros íconos de la app siguen guardados por nombre (LIST_ICONS).
 */
export type IconGroupId =
  | 'home'
  | 'food'
  | 'shopping'
  | 'health'
  | 'pets'
  | 'travel'
  | 'school'
  | 'work'
  | 'money'
  | 'car'
  | 'sport'
  | 'party'
  | 'baby'
  | 'garden'
  | 'security';

export interface IconGroup {
  id: IconGroupId;
  icons: { emoji: string; words: string }[];
}

const group = (id: IconGroupId, icons: [string, string][]): IconGroup => ({
  id,
  icons: icons.map(([emoji, words]) => ({ emoji, words })),
});

export const ICON_GROUPS: IconGroup[] = [
  group('home', [
    ['🏠', 'casa hogar house home'],
    ['🧹', 'limpieza barrer escoba cleaning broom'],
    ['🧺', 'ropa lavar canasta laundry basket'],
    ['🛏️', 'cama dormir cuarto bed bedroom'],
    ['🛋️', 'sala sofá living couch'],
    ['🧽', 'lavar esponja platos sponge dishes'],
    ['🔧', 'arreglos herramienta reparar tool repair fix'],
    ['💡', 'luz idea servicios light bulb utilities'],
    ['📦', 'caja mudanza paquete box moving package'],
    ['✅', 'tareas hecho check tasks done'],
  ]),
  group('food', [
    ['🍽️', 'comida plato cena food dinner meal'],
    ['🍳', 'cocinar desayuno cook breakfast'],
    ['🥗', 'ensalada saludable salad healthy'],
    ['🍕', 'pizza'],
    ['🍰', 'postre pastel dessert cake'],
    ['☕', 'café coffee'],
    ['🍷', 'vino bebida wine drink'],
    ['🥖', 'pan panadería bread bakery'],
  ]),
  group('shopping', [
    ['🛒', 'compras súper mercado shopping groceries cart'],
    ['🛍️', 'bolsas tienda shopping bags store'],
    ['🧾', 'recibo cuenta factura receipt bill'],
    ['🏪', 'tienda store shop'],
    ['👕', 'ropa camisa clothes shirt'],
    ['👟', 'zapatos tenis shoes sneakers'],
  ]),
  group('health', [
    ['💊', 'medicina pastillas salud medicine pills health'],
    ['🩺', 'doctor médico cita doctor appointment'],
    ['🦷', 'dentista diente dentist tooth'],
    ['❤️', 'corazón amor salud heart love'],
    ['🧘', 'yoga meditar calma meditation'],
    ['💉', 'vacuna inyección vaccine shot'],
  ]),
  group('pets', [
    ['🐾', 'mascotas huellas pets paw'],
    ['🐶', 'perro dog'],
    ['🐱', 'gato cat'],
    ['🐟', 'pez pescado fish'],
    ['🐦', 'pájaro ave bird'],
    ['🦴', 'hueso comida mascota bone'],
  ]),
  group('travel', [
    ['✈️', 'viaje avión vuelo travel plane flight'],
    ['🧳', 'maleta equipaje suitcase luggage'],
    ['🏖️', 'playa vacaciones beach vacation'],
    ['🏕️', 'campamento camping'],
    ['🗺️', 'mapa ruta map route'],
    ['🏨', 'hotel'],
    ['🎫', 'boleto entrada ticket'],
  ]),
  group('school', [
    ['📚', 'libros estudiar lectura books study reading'],
    ['🎒', 'mochila escuela colegio backpack school'],
    ['✏️', 'lápiz tarea escribir pencil homework'],
    ['🎓', 'graduación universidad graduation college'],
    ['🧮', 'matemáticas cuentas math'],
    ['🔬', 'ciencia science'],
  ]),
  group('work', [
    ['💼', 'trabajo oficina work office briefcase'],
    ['💻', 'computador laptop computer'],
    ['📅', 'calendario agenda calendar schedule'],
    ['📝', 'notas apuntes notes memo'],
    ['📞', 'llamar teléfono call phone'],
    ['📧', 'correo email mail'],
  ]),
  group('money', [
    ['💰', 'dinero ahorro money savings'],
    ['💳', 'tarjeta pago card payment'],
    ['🏦', 'banco bank'],
    ['📈', 'inversión gráfica investment chart'],
    ['🪙', 'moneda coin'],
    ['🧾', 'impuestos cuentas taxes bills'],
  ]),
  group('car', [
    ['🚗', 'carro auto coche car'],
    ['⛽', 'gasolina combustible gas fuel'],
    ['🔩', 'mantenimiento taller maintenance garage'],
    ['🚲', 'bicicleta bike bicycle'],
    ['🏍️', 'moto motorcycle'],
    ['🚌', 'bus transporte transport'],
  ]),
  group('sport', [
    ['⚽', 'fútbol football soccer'],
    ['🏀', 'baloncesto basketball'],
    ['🏋️', 'gimnasio pesas gym weights'],
    ['🏃', 'correr running run'],
    ['🏊', 'nadar natación swim swimming'],
    ['🎾', 'tenis tennis'],
  ]),
  group('party', [
    ['🎁', 'regalo cumpleaños gift present birthday'],
    ['🎂', 'cumpleaños pastel birthday cake'],
    ['🎉', 'fiesta celebración party celebration'],
    ['🎄', 'navidad christmas'],
    ['🎃', 'halloween'],
    ['💍', 'boda anillo wedding ring'],
    ['⭐', 'estrella favorito star favorite'],
  ]),
  group('baby', [
    ['👶', 'bebé baby'],
    ['🍼', 'biberón tetero bottle'],
    ['🧸', 'juguete oso toy teddy'],
    ['🚼', 'pañales niños diapers kids'],
    ['🎈', 'globo niños balloon kids'],
  ]),
  group('garden', [
    ['🌱', 'jardín planta sembrar garden plant seed'],
    ['🪴', 'matera planta interior pot plant'],
    ['🌻', 'flor girasol flower sunflower'],
    ['🌳', 'árbol tree'],
    ['💧', 'regar agua water'],
    ['🍅', 'huerta tomate vegetables tomato'],
  ]),
  group('security', [
    ['🔐', 'secreto candado contraseñas secret lock passwords'],
    ['🔑', 'llave clave key'],
    ['🛡️', 'seguridad escudo seguro security shield insurance'],
    ['🚨', 'emergencia alarma emergency alarm'],
    ['🧯', 'extintor incendio fire extinguisher'],
    ['📄', 'documentos papeles documents papers'],
  ]),
];

/** Sin tildes y en minúsculas, para buscar "medico" o "médico" igual */
export const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** Grupos con los íconos que coinciden con la búsqueda (sin búsqueda: todos) */
export function searchIcons(query: string, groupNames: Record<IconGroupId, string>): IconGroup[] {
  const q = normalize(query);
  if (!q) return ICON_GROUPS;
  return ICON_GROUPS.map((g) => {
    const groupMatches = normalize(groupNames[g.id]).includes(q);
    return {
      ...g,
      icons: groupMatches ? g.icons : g.icons.filter((i) => normalize(i.words).includes(q)),
    };
  }).filter((g) => g.icons.length);
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** Un solo emoji (con tono de piel, bandera o combinado); igual que la validación del servidor */
export function isSingleEmoji(value: string): boolean {
  if (!value || value.length > 16) return false;
  if ([...segmenter.segment(value)].length !== 1) return false;
  return (
    /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣)/u.test(value) &&
    /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️⃣]+$/u.test(value)
  );
}
