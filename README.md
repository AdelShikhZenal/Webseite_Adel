# Adel — persönliches Space-Portfolio

Eine responsive persönliche Portfolio-Seite mit animierter Three.js-Weltraumkulisse, Tastaturbedienung, Motion-Pause, reduziertem Bewegungsmodus und lokalem Demo-Bord-Navigator.

## In VS Code starten

Voraussetzung: Node.js (empfohlen: eine aktuelle LTS-Version).

1. Entpacke den Projektordner in deinen Ordner `Webseite_Adel`.
2. Wichtig: Die Startdatei muss **`index.html`** heißen – nicht `intex.html`.
3. Öffne `Webseite_Adel` in VS Code und ein integriertes Terminal (**Terminal → Neues Terminal**).
4. Führe aus:

   ```bash
   npm install
   npm run dev
   ```

5. Öffne die lokale Adresse, die Vite im Terminal anzeigt (typischerweise `http://localhost:5173`).
6. Für einen Produktions-Build: `npm run build`.

## Optionaler Space-Hintergrund

Im Chat wurde zusätzlich das Bild `adel-space-portfolio-background.png` erstellt. Speichere es in den Ordner `public/` und nenne die Datei dort **`space-background.png`**. Die Website hat auch ohne dieses Bild einen animierten, prozeduralen Weltraumhintergrund.

## Was die erste Version kann – und was nicht

- Die Three.js-Szene simuliert den Flug, die Planeten, Meteore und den Übergang in den Deep Space. Sie zeigt **keine echte Position eines Raumschiffs** und keine Live-Ephemeriden.
- Der Bord-Navigator ist eine kostenlose, lokal im Browser laufende FAQ-/Navigations-Demo. Er ist **kein generatives KI-Modell** und lädt keine KI- oder NASA-Livedaten.
- Eine echte generative KI sollte nicht mit einem geheimen API-Schlüssel direkt im Browser verbunden werden. Dafür braucht es entweder einen lokalen Modellserver oder ein Backend. Echte astronomische Echtzeitdaten benötigen zusätzlich eine passende Ephemeriden-Datenquelle.
- Die Schrift wird von Google Fonts geladen; ohne Internet verwendet der Browser System-Fallbacks. Three.js wird bei `npm install` aus npm installiert.

## Projektdateien

- `index.html` — semantische Seitenstruktur
- `style.css` — Layout, responsive Darstellung und Animationen
- `script.ts` — Three.js-Szene, Interaktionen, Route und lokaler Navigator
- `package.json` / `tsconfig.json` — Vite- und TypeScript-Konfiguration

Vor einer öffentlichen Veröffentlichung solltest du noch prüfen, welche Impressums- und Datenschutzhinweise für deinen konkreten Einsatz erforderlich sind.
