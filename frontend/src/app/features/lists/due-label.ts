import { I18n } from '../../core/i18n/i18n.service';
import { DueKind, dueInfo } from './item-logic';
import { ListItem } from './lists.models';

/** "Hoy 18:30", "Mañana", "Vence 20 nov 9:00", "Venció 1 nov" (en la hora local de quien mira) */
export function dueLabel(item: Pick<ListItem, 'dueDate' | 'dueAt' | 'completedAt'>, i18n: I18n, now = new Date()): { text: string; kind: DueKind } | null {
  const info = dueInfo(item, now);
  if (!info) return null;
  const locale = i18n.locale();
  const time = info.timed ? info.at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }) : '';
  const date = info.at.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const when = [date, time].filter(Boolean).join(' ');
  const text =
    info.kind === 'overdue'
      ? i18n.t('lists.items.overdue', { date: when })
      : info.kind === 'today'
        ? i18n.t(info.timed ? 'lists.items.todayAt' : 'lists.items.dueToday', { time })
        : info.kind === 'tomorrow'
          ? i18n.t(info.timed ? 'lists.items.tomorrowAt' : 'lists.items.dueTomorrow', { time })
          : i18n.t('lists.items.due', { date: when });
  return { text, kind: info.kind };
}
