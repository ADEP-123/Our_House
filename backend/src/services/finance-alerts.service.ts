import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { runInBackground } from '../lib/background.js';
import { emailTemplates, type Locale } from '../lib/email-templates.js';
import { mailer } from '../lib/mailer.js';
import { todayIn } from '../lib/recurrence.js';
import { savingsRepository } from '../repositories/savings.repository.js';

interface Recipient {
  id: string;
  email: string;
  locale: Locale;
}

const settingsUrl = () => `${env.appUrl}/perfil#notificaciones`;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Personas (por id) con el correo confirmado y los avisos de finanzas activados */
async function recipients(userIds: (string | null)[]): Promise<Recipient[]> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (!ids.length) return [];
  const { rows } = await db().query<Recipient>(
    'SELECT id, email, locale FROM users WHERE id = ANY($1::uuid[]) AND email_finance AND email_verified_at IS NOT NULL',
    [ids],
  );
  return rows;
}

async function leaders(familyId: string): Promise<string[]> {
  const { rows } = await db().query<{ user_id: string }>("SELECT user_id FROM family_members WHERE family_id = $1 AND role = 'leader'", [familyId]);
  return rows.map((r) => r.user_id);
}

async function familyInfo(familyId: string) {
  const { rows } = await db().query<{ name: string; currency: string }>('SELECT name, currency FROM families WHERE id = $1', [familyId]);
  return rows[0] ?? { name: '', currency: 'USD' };
}

const money = (n: number, currency: string, locale: Locale) =>
  new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-ES', { style: 'currency', currency }).format(n);

const monthLabel = (month: string, locale: Locale) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Disponible = saldo - lo apartado para ahorros. Avisa una vez cada vez que baja del umbral. */
async function checkLowBalance(accountIds: string[], actorId: string): Promise<void> {
  const rows = await savingsRepository.thresholds(accountIds);
  for (const a of rows) {
    const saved = (await savingsRepository.allocations(a.family_id)).filter((x) => x.account_id === a.id).reduce((s, x) => s + x.amount, 0);
    const available = r2(a.balance - saved);
    if (available >= a.threshold) {
      if (a.notified) await savingsRepository.setLowBalanceNotified(a.id, false);
      continue;
    }
    if (a.notified) continue;
    await savingsRepository.setLowBalanceNotified(a.id, true);
    const family = await familyInfo(a.family_id);
    const to = await recipients([a.owner_id ?? null, actorId, ...(a.owner_id ? [] : await leaders(a.family_id))]);
    await Promise.all(
      to.map((r) =>
        mailer.send(
          r.email,
          emailTemplates.lowBalance(r.locale, {
            account: a.name,
            available: money(available, family.currency, r.locale),
            threshold: money(a.threshold, family.currency, r.locale),
            saved: saved > 0 ? money(saved, family.currency, r.locale) : null,
            url: `${env.appUrl}/finanzas?cuenta=${a.id}`,
            settingsUrl: settingsUrl(),
          }),
        ),
      ),
    );
  }
}

/** Presupuesto del mes en curso (en la zona horaria de quien hizo el cambio): avisos al 80 y al 100 % */
async function checkBudgets(familyId: string, actorId: string): Promise<void> {
  const { rows } = await db().query<{ timezone: string }>('SELECT timezone FROM users WHERE id = $1', [actorId]);
  const month = todayIn(rows[0]?.timezone ?? 'UTC').slice(0, 7);
  const budgets = await savingsRepository.budgets(familyId, month);
  for (const b of budgets) {
    const pct = Math.floor((b.spent / b.amount) * 100);
    const threshold = pct >= 100 ? 100 : pct >= 80 ? 80 : null;
    if (!threshold) continue;
    if (!(await savingsRepository.claimBudgetAlert(b.category_id, month, threshold))) continue;
    // Si llegó directo al 100 %, el aviso del 80 % ya no hace falta
    if (threshold === 100) await savingsRepository.claimBudgetAlert(b.category_id, month, 80);
    const family = await familyInfo(familyId);
    const to = await recipients([...(await leaders(familyId)), actorId]);
    await Promise.all(
      to.map((r) =>
        mailer.send(
          r.email,
          emailTemplates.budgetAlert(r.locale, {
            category: b.name,
            pct,
            threshold,
            spent: money(b.spent, family.currency, r.locale),
            limit: money(b.amount, family.currency, r.locale),
            month: monthLabel(month, r.locale),
            family: family.name,
            url: `${env.appUrl}/finanzas?cuenta=resumen`,
            settingsUrl: settingsUrl(),
          }),
        ),
      ),
    );
  }
}

/** Meta cumplida: lo apartado llegó a la meta (se avisa una vez; cambiar la meta permite volver a avisar) */
async function checkGoal(projectId: string, actorId: string): Promise<void> {
  const project = await savingsRepository.find(projectId);
  if (!project?.goal || project.closed_at || project.goal_notified_at) return;
  const saved = (await savingsRepository.allocations(project.family_id)).filter((x) => x.project_id === projectId).reduce((s, x) => s + x.amount, 0);
  if (saved < project.goal) return;
  if (!(await savingsRepository.markGoalNotified(projectId))) return;
  const family = await familyInfo(project.family_id);
  const to = await recipients([project.created_by, actorId]);
  await Promise.all(
    to.map((r) =>
      mailer.send(
        r.email,
        emailTemplates.savingsGoal(r.locale, {
          project: project.name,
          saved: money(saved, family.currency, r.locale),
          goal: money(project.goal!, family.currency, r.locale),
          family: family.name,
          url: `${env.appUrl}/finanzas/ahorros`,
          settingsUrl: settingsUrl(),
        }),
      ),
    ),
  );
}

/**
 * Avisos de finanzas por correo. Se revisan en segundo plano después de cada cambio de dinero:
 * la acción responde sin esperar y un fallo de envío no la revierte.
 */
export const financeAlerts = {
  afterChange(familyId: string, accountIds: string[], actorId: string): void {
    runInBackground('avisos de finanzas', async () => {
      if (accountIds.length) await checkLowBalance(accountIds, actorId);
      await checkBudgets(familyId, actorId);
    });
  },

  afterSetAside(projectId: string, accountId: string, actorId: string): void {
    runInBackground('avisos de ahorro', async () => {
      await checkGoal(projectId, actorId);
      await checkLowBalance([accountId], actorId);
    });
  },
};
