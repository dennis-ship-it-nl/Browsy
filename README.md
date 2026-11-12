# Browsy

Rustige browser op de Chromium-engine (Electron), voor intern gebruik. Websites werken zoals in Chrome.

## Een DMG maken (aanbevolen)
1. Zet deze map in een GitHub-repository (bijvoorbeeld browsy).
2. Ga naar Actions, kies "Bouw Mac-app en DMG" en klik Run workflow. Na een paar minuten staat de DMG onder Artifacts.
3. Open de DMG en sleep Browsy naar Programma's.

Voor een vaste downloadlink: maak een tag (bijvoorbeeld v1.0.0). Dan komt de DMG automatisch bij de Releases.

## Zonder GitHub, op een Mac met Apple Silicon
Dubbelklik `Installeer.command` (eerste keer rechtsklik, Open). Node.js (LTS) moet geinstalleerd zijn. De app komt in Programma's. Met `npm install` en daarna `npm run pack` en `npm run dmg` maak je ook zelf een DMG.

## Eerste keer openen
De app is ad hoc ondertekend, niet door Apple goedgekeurd. Rechtsklik de eerste keer op de app en kies Open. Lukt dat niet, ga naar Systeeminstellingen, Privacy en beveiliging en klik onderaan op Open toch.

## Functies
Tabs (vastzetten, slepen, dupliceren, dempen, heropenen), adresbalk met suggesties, bladwijzers en bladwijzerbalk, import uit Chrome, geschiedenis, downloads, zoeken op pagina, afdrukken en opslaan als PDF, privévenster, meerdere vensters, rechtenvragen per site, foutpagina, Claude-paneel, instellingen, Chrome-extensies met werkbalkknoppen en installeren uit de Chrome Web Store, standaardbrowser, tabs onthouden.

## Sneltoetsen
Cmd+T nieuw tabblad, Cmd+N venster, Cmd+Shift+N privévenster, Cmd+W sluiten, Cmd+Shift+T heropenen, Cmd+L adresbalk, Cmd+F zoeken, Cmd+G volgende, Cmd+D bladwijzer, Cmd+Shift+B bladwijzerbalk, Cmd+Y geschiedenis, Cmd+Shift+J downloads, Cmd+E Claude, Cmd+, instellingen, Cmd+R herladen, Cmd+[ en Cmd+] terug en vooruit, Cmd+1 t/m 9 naar tabblad, Ctrl+Tab volgend tabblad.

## Aanpassen
- Snelkoppelingen op het nieuwe tabblad: in de app onder Instellingen.
- Vormgeving: `ui/` (balken) en `pages/` (interne pagina's), kleuren staan als CSS-variabelen bovenaan.

## Updates
Nieuwe versie: verhoog `version` in package.json, maak een tag (bijvoorbeeld v1.1.0) en GitHub bouwt een nieuwe zip. Vervang de app in Programma's. Tabs, bladwijzers, instellingen en inlogsessies blijven behouden.

## Beperkingen
Geen Google-account-synchronisatie, geen wachtwoordbeheer. Extensies die een apart programma op de Mac nodig hebben (zoals iCloud Wachtwoorden) werken niet. Extensies werken niet in privévensters.


## Updatelink instellen

In package.json staat bij `updateUrl` de plaatsaanduiding JOUW-ACCOUNT. Vervang die door de naam van het GitHub-account waar de repository `browsy` staat, bijvoorbeeld https://github.com/accountnaam/browsy/releases/latest.
