#!/bin/bash
# Dubbelklik dit bestand op een Mac met Apple Silicon om Browsy te bouwen en te installeren.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js ontbreekt. Installeer de LTS-versie via https://nodejs.org en dubbelklik dit bestand daarna opnieuw."
  read -r -p "Druk op Enter om te sluiten"; exit 1
fi
npm install && npm run pack || { echo "Bouwen is mislukt."; read -r -p "Druk op Enter"; exit 1; }
APP="dist/Browsy-darwin-arm64/Browsy.app"
rm -rf "/Applications/Browsy.app"
cp -R "$APP" /Applications/
xattr -cr "/Applications/Browsy.app"
open "/Applications/Browsy.app"
echo "Klaar. Browsy staat in je Programma's."
