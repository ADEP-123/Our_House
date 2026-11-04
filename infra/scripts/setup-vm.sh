#!/usr/bin/env bash
# Prepara una VM Ubuntu (Oracle Cloud Always Free) para correr Our House.
# Uso: bash setup-vm.sh   (como el usuario ubuntu, con sudo)
set -euo pipefail

echo "==> Paquetes base"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl git iptables-persistent

echo "==> Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"

echo "==> Firewall de la VM: abrir 80 y 443"
# Las imágenes Ubuntu de OCI traen iptables que bloquea todo salvo SSH
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null ||
    sudo iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
done
sudo iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null ||
  sudo iptables -I INPUT -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save

echo "==> Swap (solo si la VM tiene menos de 2 GB de RAM, ej. la AMD micro)"
mem_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
if [ "$mem_kb" -lt 2000000 ] && [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "Listo. Cierra la sesión SSH y vuelve a entrar para usar docker sin sudo."
