#!/bin/bash
set -e

echo "=== Clarity — Asistente para personas con discapacidad visual ==="
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
  echo "ERROR: Python 3 no encontrado"
  exit 1
fi

# Check .env
if [ ! -f ".env" ]; then
  echo "Creando .env desde .env.example..."
  cp .env.example .env
  echo "IMPORTANTE: Agrega tu GEMINI_API_KEY en .env"
fi

# Install deps
echo "Instalando dependencias..."
pip install -r requirements.txt -q

# Run
echo ""
echo "Iniciando servidor en http://localhost:8000"
echo "Para acceso desde celular usa: ngrok http 8000"
echo ""
cd backend && python main.py
