import { describe, expect, it } from 'vitest';
import { emailTemplates } from '../src/lib/email-templates.js';

describe('plantillas de correo', () => {
  it('genera la verificación en el idioma del usuario', () => {
    const es = emailTemplates.verifyEmail('es', { nickname: 'ana', url: 'https://app/verificar?token=x' });
    const en = emailTemplates.verifyEmail('en', { nickname: 'ana', url: 'https://app/verificar?token=x' });
    expect(es.subject).toContain('Confirma');
    expect(en.subject).toContain('Confirm');
    expect(es.html).toContain('https://app/verificar?token=x');
    expect(es.text).toContain('https://app/verificar?token=x');
  });

  it('escapa el HTML de los datos del usuario', () => {
    const mail = emailTemplates.familyInvitation('es', {
      inviter: '<script>x</script>',
      family: 'Casa & Co',
      url: 'https://app/familias',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('Casa &amp; Co');
  });
});
