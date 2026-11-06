#!/bin/bash

# Piano Blind Trainer — запуск на macOS двойным кликом.
cd -- "$(dirname -- "$0")" || exit 1
clear

echo "========================================"
echo "  Piano Blind Trainer v23.0 — запуск на macOS"
echo "========================================"
echo

NODE_BIN="$(command -v node 2>/dev/null || true)"

# Finder/Terminal иногда не видит PATH от Homebrew или nvm,
# поэтому проверяем типичные места установки Node.js вручную.
if [ -z "$NODE_BIN" ]; then
  shopt -s nullglob
  NODE_CANDIDATES=(
    /opt/homebrew/bin/node
    /usr/local/bin/node
    "$HOME"/.nvm/versions/node/*/bin/node
  )
  for candidate in "${NODE_CANDIDATES[@]}"; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  echo "Node.js не найден."
  echo
  echo "1. Сейчас откроется официальный сайт Node.js."
  echo "2. Установи LTS-версию для macOS."
  echo "3. После установки снова дважды нажми START-MAC.command."
  echo
  open "https://nodejs.org/en/download" >/dev/null 2>&1 || true
  read -r -p "Нажми Enter, чтобы закрыть окно..."
  exit 1
fi

if [ ! -f "server.cjs" ] || [ ! -f "index.html" ]; then
  echo "Не найдены server.cjs или index.html."
  echo "Полностью распакуй ZIP и запускай START-MAC.command из папки проекта."
  echo
  read -r -p "Нажми Enter, чтобы закрыть окно..."
  exit 1
fi

echo "Node.js: $($NODE_BIN --version)"
echo "Запускаю тренажёр..."
echo "Темы и уроки будут сохраняться в trainer-content.json."
echo
"$NODE_BIN" server.cjs
STATUS=$?

echo
if [ "$STATUS" -eq 0 ] || [ "$STATUS" -eq 130 ]; then
  echo "Тренажёр остановлен."
else
  echo "Не удалось запустить тренажёр (код ошибки: $STATUS)."
fi
read -r -p "Нажми Enter, чтобы закрыть окно..."
exit "$STATUS"
