#!/bin/bash
set -e

echo "=== Clarity — Lentes inteligentes ==="
echo ""

if ! command -v python3 &> /dev/null; then
  echo "ERROR: Python 3 no encontrado"; exit 1
fi

if [ ! -f ".env" ]; then
  echo "ERROR: Falta .env con GEMINI_API_KEY"; exit 1
fi

# Kill anything on port 8000
if lsof -ti:8000 &>/dev/null; then
  echo "Liberando puerto 8000..."
  lsof -ti:8000 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

echo "Instalando dependencias..."
pip install -r requirements.txt -q

echo ""
echo "Backend corriendo en http://localhost:8000"
echo ""
echo "Para acceso desde el celular, abre UNA NUEVA TERMINAL y corre:"
echo ""
echo "  ssh -R 80:localhost:8000 nokey@localhost.run"
echo ""
echo "La URL que aparezca (xxxxxx.localhost.run) ábrela en el celular con https://"
echo ""
echo "────────────────────────────────────────"

cd backend && python main.py
