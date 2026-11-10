import { I18n } from '../../core/i18n/i18n.service';
import { DueKind, WEEK_ORDER, dueInfo, weekdayNames } from './item-logic';
import { ListItem, RepeatRule } from './lists.models';

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

/** "Cada semana · lun, jue", "Cada 2 meses" */
export function repeatLabel(rule: RepeatRule, i18n: I18n): string {
  const base = rule.interval > 1 ? i18n.t(`lists.repeat.everyN.${rule.freq}`, { n: rule.interval }) : i18n.t(`lists.repeat.freq.${rule.freq}`);
  if (rule.freq !== 'weekly' || !rule.weekdays?.length) return base;
  const names = weekdayNames(i18n.locale());
  const days = WEEK_ORDER.filter((d) => rule.weekdays!.includes(d)).map((d) => names[d]);
  return `${base} · ${days.join(', ')}`;
}

/** Fecha corta "12 mar" a partir de "AAAA-MM-DD" */
export function shortDate(date: string, i18n: I18n): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(i18n.locale(), { day: 'numeric', month: 'short' });
}
