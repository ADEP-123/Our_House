import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import type { EmailContent } from './email-templates.js';

let transporter: Transporter | undefined;

function getTransporter(): Transporter | undefined {
  if (!env.mail.user || !env.mail.pass) return undefined;
  transporter ??= nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: env.mail.user, pass: env.mail.pass },
  });
  return transporter;
}

export const mailer = {
  /** Envía por Gmail SMTP. Sin credenciales (desarrollo) solo lo escribe en la consola. */
  async send(to: string, content: EmailContent): Promise<void> {
    const transport = getTransporter();
    if (!transport) {
      console.info(`[correo no enviado: falta SMTP] Para: ${to} | ${content.subject}\n${content.text}`);
      return;
    }
    await transport.sendMail({
      from: { name: env.mail.fromName, address: env.mail.user! },
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
  },
};
