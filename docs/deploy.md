# Despliegue en Oracle Cloud (Always Free)

Arquitectura de producción, todo en una VM gratuita de Oracle:

```
Navegador / PWA ──HTTPS──► Caddy (contenedor "web")
                              ├─ /        → archivos de Angular (PWA)
                              └─ /api/*   → Express (contenedor "backend") ──TLS──► Oracle Autonomous Database
```

Caddy saca y renueva solo el certificado HTTPS. La PWA lo necesita, porque el service worker no funciona sin HTTPS.

## 1. Cuenta de Oracle Cloud

1. Crea la cuenta en https://www.oracle.com/cloud/free/. La **región principal (home region) no se puede cambiar**. Elige una cercana y con disponibilidad de Ampere A1 (por ejemplo, US East Ashburn o Brazil East São Paulo).
2. **Recomendado:** pasa la cuenta a *Pay As You Go* (Billing > Upgrade) y crea un presupuesto con alerta de 1 USD (Billing > Budgets). Los recursos Always Free siguen sin costo, y Oracle deja de reclamar la VM por estar "ociosa", algo que con dos usuarios pasaría.

## 2. Máquina virtual

1. Compute > Instances > Create instance.
2. Imagen: **Ubuntu 24.04**. Shape: **VM.Standard.A1.Flex** con 1 OCPU y 6 GB de RAM. Si no hay capacidad, usa VM.Standard.E2.1.Micro.
3. Sube tu llave SSH pública y deja marcada la opción de IP pública.
4. En la VCN de la instancia, ve a Security List > Add Ingress Rules y agrega:
   - Origen `0.0.0.0/0`, TCP, puerto `80`
   - Origen `0.0.0.0/0`, TCP, puerto `443`
   - Origen `0.0.0.0/0`, UDP, puerto `443` (HTTP/3, opcional)

## 3. Dominio gratuito

1. Entra a https://www.duckdns.org (con GitHub o Google) y crea un subdominio, por ejemplo `ourhouse.duckdns.org`.
2. En "current ip" pon la IP pública de la VM.

Si más adelante compran un dominio propio, solo cambia `DOMAIN` en el `.env`.

## 4. Base de datos (Autonomous Database)

1. Oracle Database > Autonomous Database > Create.
2. Tipo de carga **Transaction Processing**, activa **Always Free** y define la contraseña de `ADMIN`.
3. Network access: **Secure access from allowed IPs and VCNs only**. Agrega la IP pública de la VM y la de tu casa, si vas a desarrollar contra esta base.
4. **Desmarca "Require mutual TLS (mTLS) authentication"**. Así la conexión no necesita wallet.
5. Cuando esté creada: Database connection > TLS. Copia la cadena del servicio `*_low`. Ese valor va en `DB_CONNECT_STRING`.

> Si prefieres mantener mTLS: descarga el wallet, descomprímelo en `~/our_house/wallet` en la VM y define `DB_WALLET_DIR=/app/wallet` y `DB_WALLET_PASSWORD` en el `.env`. En ese caso `DB_CONNECT_STRING` es el alias del `tnsnames.ora` (por ejemplo, `ourhouse_low`).

La base de datos se detiene tras 7 días sin conexiones. El healthcheck del contenedor backend la consulta cada minuto, así que esto no debería pasar mientras la VM esté encendida.

## 5. Preparar la VM

```bash
ssh ubuntu@IP_DE_LA_VM
git clone https://github.com/ADEP-123/Our_House.git ~/our_house
bash ~/our_house/infra/scripts/setup-vm.sh
exit   # vuelve a entrar para usar docker sin sudo
```

## 6. Primer arranque

```bash
ssh ubuntu@IP_DE_LA_VM
cd ~/our_house
cp .env.example .env
nano .env          # completa DOMAIN, DB_PASSWORD y DB_CONNECT_STRING
docker compose up -d --build
docker compose ps
curl https://TU_DOMINIO/api/health
```

Debe responder `{"status":"ok","db":"up",...}`. Si dice `"db":"down"`, revisa la cadena de conexión y que la IP de la VM esté en la lista de acceso de la base.

## 7. Despliegue automático (GitHub Actions)

1. En tu equipo, crea una llave solo para despliegues: `ssh-keygen -t ed25519 -f ourhouse_deploy -N ""`.
2. Agrega `ourhouse_deploy.pub` al final de `~/.ssh/authorized_keys` en la VM.
3. En GitHub, ve a Settings > Secrets and variables > Actions y crea:
   - `OCI_HOST`: IP pública de la VM
   - `OCI_USER`: `ubuntu`
   - `OCI_SSH_KEY`: contenido completo del archivo privado `ourhouse_deploy`

A partir de ahí, cada merge a `main` despliega solo (workflow **Deploy**). También se puede lanzar a mano desde la pestaña Actions.

## Desarrollo local

```bash
# API
cd backend && cp .env.example .env && npm install && npm run dev
# PWA (proxy de /api al puerto 3000)
cd frontend && npm install && npm start
```

Sin base de datos configurada, la API arranca igual y `/api/health` responde 503 con `"db":"down"`.
