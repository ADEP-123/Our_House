import type { Locale } from '../../core/i18n/i18n.service';
import type { ListFeature, ListType } from './list-presets';
import type { RepeatRule } from './lists.models';

export type TemplateId =
  'blank' | 'groceries' | 'cleaning' | 'trip' | 'party' | 'moving' | 'secrets';

/** Punto de partida para una lista nueva: nombre, tipo, aspecto y elementos sugeridos */
export interface ListTemplate {
  id: TemplateId;
  type: ListType;
  icon: string;
  color: string;
  /** Si no se indican, las del tipo */
  features?: ListFeature[];
  name: Record<Locale, string>;
  items: Record<Locale, string[]>;
  /** Los elementos nacen repitiéndose así */
  repeat?: RepeatRule;
  /** Ofrece repartir los elementos por turnos entre los miembros */
  rotation?: boolean;
}

const weekly: RepeatRule = { freq: 'weekly', interval: 1, from: 'schedule' };

export const LIST_TEMPLATES: ListTemplate[] = [
  {
    id: 'blank',
    type: 'todo',
    icon: 'check',
    color: 'blue',
    name: { es: '', en: '' },
    items: { es: [], en: [] },
  },
  {
    id: 'groceries',
    type: 'shopping',
    icon: 'cart',
    color: 'green',
    name: { es: 'Súper semanal', en: 'Weekly groceries' },
    items: {
      es: ['Leche', 'Pan', 'Huevos', 'Frutas', 'Verduras', 'Arroz', 'Café', 'Papel higiénico'],
      en: ['Milk', 'Bread', 'Eggs', 'Fruit', 'Vegetables', 'Rice', 'Coffee', 'Toilet paper'],
    },
  },
  {
    id: 'cleaning',
    type: 'todo',
    icon: 'broom',
    color: 'teal',
    name: { es: 'Limpieza de la casa', en: 'House cleaning' },
    items: {
      es: [
        'Barrer y trapear',
        'Limpiar baños',
        'Sacar la basura',
        'Lavar la ropa',
        'Cambiar sábanas',
        'Regar las plantas',
      ],
      en: [
        'Sweep and mop',
        'Clean bathrooms',
        'Take out the trash',
        'Do the laundry',
        'Change the sheets',
        'Water the plants',
      ],
    },
    repeat: weekly,
    rotation: true,
  },
  {
    id: 'trip',
    type: 'other',
    icon: 'plane',
    color: 'orange',
    features: ['category', 'assignee', 'subtasks'],
    name: { es: 'Viaje', en: 'Trip' },
    items: {
      es: [
        'Pasaportes',
        'Boletos',
        'Reserva del hotel',
        'Cargadores',
        'Medicinas',
        'Ropa',
        'Dejar comida a las mascotas',
      ],
      en: [
        'Passports',
        'Tickets',
        'Hotel booking',
        'Chargers',
        'Medicine',
        'Clothes',
        'Arrange pet food',
      ],
    },
  },
  {
    id: 'party',
    type: 'todo',
    icon: 'gift',
    color: 'pink',
    name: { es: 'Cumpleaños', en: 'Birthday party' },
    items: {
      es: [
        'Lista de invitados',
        'Enviar invitaciones',
        'Pastel',
        'Decoración',
        'Comida y bebidas',
        'Regalo',
      ],
      en: ['Guest list', 'Send invitations', 'Cake', 'Decorations', 'Food and drinks', 'Gift'],
    },
  },
  {
    id: 'moving',
    type: 'todo',
    icon: 'home',
    color: 'purple',
    name: { es: 'Mudanza', en: 'Moving' },
    items: {
      es: [
        'Conseguir cajas',
        'Reservar camión',
        'Cambiar dirección',
        'Dar de baja servicios',
        'Empacar cocina',
        'Limpiar el lugar anterior',
      ],
      en: [
        'Get boxes',
        'Book a truck',
        'Change address',
        'Cancel utilities',
        'Pack the kitchen',
        'Clean the old place',
      ],
    },
  },
  {
    id: 'secrets',
    type: 'secret',
    icon: 'lock',
    color: 'gray',
    name: { es: 'Claves de la casa', en: 'Home passwords' },
    items: { es: [], en: [] },
  },
];
