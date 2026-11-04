/**
 * Política de privacidad y términos de uso (públicos: Google los pide para publicar la app).
 * Al cambiarlos, actualiza UPDATED_AT.
 */
export const SUPPORT_EMAIL = 'andep210399@gmail.com';
export const UPDATED_AT = '2026-11-03';

export interface LegalSection {
  title: string;
  paragraphs: string[];
}

export interface LegalDoc {
  title: string;
  intro: string;
  sections: LegalSection[];
}

type Docs = Record<'privacy' | 'terms', LegalDoc>;

const es: Docs = {
  privacy: {
    title: 'Política de privacidad',
    intro:
      'Our House es una app familiar para organizar la casa entre todos: listas, tareas y compras. Esta política explica qué datos guarda, para qué y cómo puedes borrarlos.',
    sections: [
      {
        title: 'Qué datos guardamos',
        paragraphs: [
          'De tu cuenta: correo, apodo y contraseña (guardada solo como huella cifrada, nunca en texto). Si los agregas: nombre, apellido y foto de perfil.',
          'Tus preferencias: idioma, zona horaria, colores de la app, notificaciones y recordatorios.',
          'Lo que creas en la app: grupos familiares, invitaciones, listas, ítems, compras y montos pagados, y la bitácora de acciones del grupo.',
          'Para mantener tu sesión: identificadores de sesión en cookies necesarias para que la app funcione. No usamos cookies de publicidad ni de seguimiento.',
        ],
      },
      {
        title: 'Google Calendar (opcional)',
        paragraphs: [
          'Si conectas Google Calendar, Our House recibe el correo de tu cuenta de Google y un permiso para crear y manejar solo su propio calendario «Our House» (calendar.app.created). No puede ver tus otros calendarios ni sus eventos.',
          'Ese calendario se usa únicamente para poner, actualizar y quitar los eventos de tus tareas con fecha. El permiso se guarda cifrado y puedes quitarlo cuando quieras desde tu perfil o desde tu cuenta de Google.',
          'El uso y la transferencia de la información recibida de las API de Google se ajusta a la Política de Datos de Usuario de los Servicios de las API de Google, incluidos los requisitos de Uso Limitado.',
        ],
      },
      {
        title: 'Para qué los usamos',
        paragraphs: [
          'Solo para que la app funcione: mostrar tus listas a tu grupo, enviarte los correos que tienes activados (confirmación de cuenta, invitaciones, listas nuevas, tareas asignadas y recordatorios) y poner tus tareas en tu calendario si lo conectaste.',
          'No vendemos tus datos, no mostramos publicidad y no los usamos para entrenar modelos de inteligencia artificial.',
        ],
      },
      {
        title: 'Quién puede verlos',
        paragraphs: [
          'Los miembros de tu grupo ven las listas del grupo y quién hizo cada cosa. Los líderes ven además la bitácora. Tus listas privadas solo las ves tú, salvo si eres miembro supervisado: en ese caso los líderes pueden verlas, con aviso previo.',
          'Para funcionar usamos estos servicios, que guardan o procesan datos por nosotros: Vercel (alojamiento de la app y de las fotos), Neon (base de datos) y Google (envío de correos por Gmail y, si lo conectas, Google Calendar).',
        ],
      },
      {
        title: 'En tu dispositivo',
        paragraphs: [
          'Para que puedas usar las listas sin conexión, la app guarda en tu navegador una copia de las que abriste y de los cambios pendientes. Esa copia se borra al cerrar sesión.',
        ],
      },
      {
        title: 'Cuánto tiempo',
        paragraphs: [
          'Guardamos tus datos mientras tengas la cuenta. Las listas archivadas se borran solas después del plazo que indica la app. Al eliminar tu cuenta se borran tus datos personales y lo que solo era tuyo.',
        ],
      },
      {
        title: 'Tus opciones',
        paragraphs: [
          'Desde tu perfil puedes ver y cambiar tus datos, apagar cada tipo de correo, desconectar Google Calendar y eliminar tu cuenta.',
          `Para cualquier consulta o pedido sobre tus datos, escribe a ${SUPPORT_EMAIL}.`,
        ],
      },
      {
        title: 'Menores de edad',
        paragraphs: [
          'Los menores deben usar la app con la supervisión de un adulto de su grupo familiar, con el rol de miembro supervisado.',
        ],
      },
      {
        title: 'Cambios',
        paragraphs: ['Si esta política cambia, actualizaremos la fecha de esta página y avisaremos en la app si el cambio es importante.'],
      },
    ],
  },
  terms: {
    title: 'Términos de uso',
    intro: 'Al usar Our House aceptas estas condiciones.',
    sections: [
      {
        title: 'La app',
        paragraphs: [
          'Our House es una app gratuita para uso personal y familiar. Puede cambiar, mejorar o dejar de ofrecer funciones con el tiempo.',
        ],
      },
      {
        title: 'Tu cuenta',
        paragraphs: [
          'Eres responsable de tu cuenta y de mantener segura tu contraseña. Usa un correo propio y datos verdaderos.',
          'Lo que agregas a la app (listas, ítems, fotos) es tuyo y de tu grupo. No lo uses para contenido ilegal, ofensivo o que vulnere derechos de otros.',
        ],
      },
      {
        title: 'Sin garantías',
        paragraphs: [
          'La app se ofrece «tal cual». Hacemos lo posible para que funcione bien y tus datos estén seguros, pero no garantizamos que esté siempre disponible ni libre de errores, ni que los recordatorios o eventos lleguen siempre a tiempo.',
        ],
      },
      {
        title: 'Privacidad',
        paragraphs: ['Cómo usamos tus datos se explica en la política de privacidad.'],
      },
      {
        title: 'Contacto',
        paragraphs: [`Escribe a ${SUPPORT_EMAIL}.`],
      },
    ],
  },
};

const en: Docs = {
  privacy: {
    title: 'Privacy policy',
    intro:
      'Our House is a family app to run the home together: lists, tasks and shopping. This policy explains what data it keeps, why, and how you can delete it.',
    sections: [
      {
        title: 'What we store',
        paragraphs: [
          'Your account: email, nickname and password (stored only as a hashed fingerprint, never in plain text). If you add them: first name, last name and profile photo.',
          'Your preferences: language, time zone, app colors, notifications and reminders.',
          'What you create in the app: family groups, invitations, lists, items, purchases and amounts paid, and the group activity log.',
          'To keep you signed in: session identifiers in cookies that the app needs to work. We do not use advertising or tracking cookies.',
        ],
      },
      {
        title: 'Google Calendar (optional)',
        paragraphs: [
          'If you connect Google Calendar, Our House receives your Google account email and permission to create and manage only its own “Our House” calendar (calendar.app.created). It cannot see your other calendars or their events.',
          'That calendar is used only to add, update and remove events for your dated tasks. The permission is stored encrypted and you can remove it at any time from your profile or from your Google account.',
          "Our House's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.",
        ],
      },
      {
        title: 'How we use it',
        paragraphs: [
          'Only to make the app work: show your lists to your group, send you the emails you have turned on (account confirmation, invitations, new lists, assigned tasks and reminders) and put your tasks on your calendar if you connected it.',
          'We do not sell your data, show ads, or use it to train artificial intelligence models.',
        ],
      },
      {
        title: 'Who can see it',
        paragraphs: [
          "Members of your group see the group's lists and who did what. Leaders also see the activity log. Only you see your private lists, unless you are a supervised member: then leaders can see them, after a warning.",
          'To run, we use these services, which store or process data on our behalf: Vercel (app and photo hosting), Neon (database) and Google (sending email through Gmail and, if you connect it, Google Calendar).',
        ],
      },
      {
        title: 'On your device',
        paragraphs: [
          "So you can use lists offline, the app keeps a copy of the ones you've opened and of pending changes in your browser. That copy is deleted when you sign out.",
        ],
      },
      {
        title: 'How long',
        paragraphs: [
          'We keep your data while you have an account. Archived lists are deleted automatically after the period shown in the app. Deleting your account deletes your personal data and anything that was only yours.',
        ],
      },
      {
        title: 'Your choices',
        paragraphs: [
          'From your profile you can view and change your data, turn off each type of email, disconnect Google Calendar and delete your account.',
          `For any question or request about your data, write to ${SUPPORT_EMAIL}.`,
        ],
      },
      {
        title: 'Minors',
        paragraphs: ['Minors should use the app under the supervision of an adult in their family group, with the supervised member role.'],
      },
      {
        title: 'Changes',
        paragraphs: ['If this policy changes, we will update the date on this page and let you know in the app if the change is important.'],
      },
    ],
  },
  terms: {
    title: 'Terms of use',
    intro: 'By using Our House you agree to these terms.',
    sections: [
      {
        title: 'The app',
        paragraphs: ['Our House is a free app for personal and family use. Features may change, improve or be discontinued over time.'],
      },
      {
        title: 'Your account',
        paragraphs: [
          'You are responsible for your account and for keeping your password safe. Use your own email and truthful information.',
          "What you add to the app (lists, items, photos) belongs to you and your group. Don't use it for illegal or offensive content or content that infringes others' rights.",
        ],
      },
      {
        title: 'No warranties',
        paragraphs: [
          'The app is provided “as is”. We do our best to keep it working and your data safe, but we do not guarantee it will always be available or error-free, or that reminders and events will always arrive on time.',
        ],
      },
      {
        title: 'Privacy',
        paragraphs: ['How we use your data is explained in the privacy policy.'],
      },
      {
        title: 'Contact',
        paragraphs: [`Write to ${SUPPORT_EMAIL}.`],
      },
    ],
  },
};

export const LEGAL = { es, en };
