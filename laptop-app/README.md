# Laptop-App (MVP)

Electron/TypeScript-App für den Trainings- und Spielbetrieb – Ersatz für die
Herstellersoftware. Siehe `../CLAUDE.md` und `../DESIGN.md` für Hintergrund.

## Funktionsumfang (aktueller Stand)

- Zwei Fenster: **Control** (Bedienung, läuft auf dem Laptop-Bildschirm) und
  **Display** (Anzeige, geht auf den zweiten Bildschirm/HDMI-Ausgang)
- Kein Ausrichten auf Pixelkoordinaten: Das Display-Fenster wird automatisch auf dem
  erkannten zweiten Bildschirm platziert und geht dort in echtes Vollbild
  (analog PowerPoint-Präsentationsmodus). Ist kein zweiter Bildschirm da,
  läuft es als normales Vorschau-Fenster – so lässt sich die App auch ohne
  angeschlossene Anzeigetafel entwickeln/testen. Das Vorschau-Fenster
  öffnet in dreifacher Tafelauflösung (also standardmäßig 1152×576), damit
  die Anzeige es ohne schwarze Balken ausfüllt.
- Zielbildschirm lässt sich im Control-Fenster manuell umstellen (Dropdown),
  falls mehrere externe Bildschirme angeschlossen sind oder die
  Automatik daneben liegt. Ändert sich die Auflösung des bespielten
  Bildschirms im Betrieb, passt sich das Anzeigefenster an; wird der
  Bildschirm ganz abgezogen, fällt die App auf das Vorschau-Fenster
  zurück. Ein geschlossenes Anzeigefenster holt der Knopf
  **„Anzeigefenster neu öffnen"** zurück – das Steuerungsfenster weist
  auch darauf hin, wenn es fehlt.
- **Die Anzeige rechnet ihr Layout in der Auflösung der LED-Wand**
  (Standard 384×192, im Steuerungsfenster unter „Tafelauflösung"
  einstellbar) und wird formatfüllend hochskaliert, zentriert und
  schwarz umrandet. Zwei Folgen: Auf einem Bildschirm mit anderem
  Seitenverhältnis verzerrt nichts mehr, es entstehen Balken – und das
  Vorschau-Fenster zeigt **exakt dasselbe Layout wie die Tafel**,
  einschließlich Zeilenumbrüchen, gekürzten Namen und der Zahl der
  Zeilen in der Torschützenliste. Gestaltungsfragen lassen sich damit am
  Laptop beurteilen, nicht erst an der Wand. Hintergrund und Regeln
  stehen in `../DESIGN.md` unter „Die Bühne".
- **Ein- und Auswechslungen** für beide Mannschaften: Knopf
  **„⇄ Wechsel"** neben den Ecken, danach im Spielverlauf wählen, wer
  raus und wer rein geht (zur Wahl stehen die Spieler auf dem Platz bzw.
  auf der Bank). Sind beide gewählt, erscheint der Wechsel im Spiel und
  in der Halbzeit von selbst auf der Tafel („Lange für Demir"); ohne
  Namen blendet **„Einblenden"** ihn mit der Mannschaft ein. Danach
  führen Aufstellungsseiten und Torschützenauswahl den Eingewechselten.
  Der gespeicherte Kader ändert sich dadurch nicht.
- **Retro-Design** als drittes: Punktmatrix wie alte Stadiontafeln,
  Leuchtfarbe Bernstein oder Weiß. Statt Wappen stehen Kurznamen da
  („ERKENSCHWICK"), vorgeschlagen aus dem Vereinsnamen und unter
  „Teams & Logos → Kurzname im Retro-Design" änderbar. Wechselt der
  Inhalt, baut er sich Punkt für Punkt auf.
- **Zwei Designs für die Tafel**, umschaltbar unter „Anzeige → Design":
  **Klassisch** (das Design bis Fassung 1.1.0, unverändert und Vorgabe)
  und **Flutlicht** (Lichtkegel von oben, große geneigte Ziffern,
  Vereinsstreifen, weiße Uhr-Plakette mit Halbzeit und Nachspielzeit
  daneben). Die Effekte des Flutlicht-Designs – Farbverlauf,
  Lichtstrahlen, Leuchten hinter den Wappen, Schatten – lassen sich
  einzeln abschalten, falls einer davon auf der LED-Wand Streifen oder
  Flimmern erzeugt. Die Wahl gehört zum Gerät und übersteht „Neues
  Spiel".
- Spielstand Heim/Gast (+/-), Spieluhr (Start/Stop/Reset), Halbzeit-Anzeige
- **Torjubel je nach treffender Mannschaft**, in zwei Akten. Zuerst ein
  Vollbild mit dem Wappen der treffenden Mannschaft, dann zurück auf die
  Spielansicht, wo sich die neue Ziffer von oben in den Spielstand
  schiebt. Beim eigenen Verein 4 s mit „TOR!" in Gold auf pulsender
  Fläche, Konfetti über dem Spielstand und – bei einem eigenen
  Führungswechsel – einem goldenen Rahmenpuls. Beim Gegentor 3 s
  sachlich: derselbe Aufbau, aber „TOR" kleiner und in Weiß, ruhige
  Fläche, kein Blinken, kein Konfetti. Details und Begründungen in
  `../DESIGN.md`.
- **Der Torschütze gehört nicht in den Jubel**, sondern auf den Knopf
  „Torschütze einblenden": Im Moment des Tores ist er noch nicht
  eingetragen. Sobald der Name feststeht, blendet der Knopf ihn mit
  Portrait ein.
- **Kontrastfläche hinter farbigen Wappen.** Fehlt für einen Verein die
  weiße Logovariante, legt die Anzeige hinter das farbige Logo eine
  weiße Fläche – sonst verschwänden dessen dunkle Linien auf dem blauen
  Grund. Erkannt wird die Variante aus der Ordnerstruktur der
  Logo-Bibliothek, bei einer von Hand gewählten Datei aus Dateiname und
  Bildhelligkeit.
- **Spielphasen** (Vor Anpfiff / laufend / Halbzeitpause / Abpfiff) mit
  jeweils eigener Display-Darstellung, gesteuert über die Buttons
  Anpfiff → Halbzeit → 2. Halbzeit anpfeifen → Abpfiff. Es ist immer nur
  der sinnvolle nächste Schritt anklickbar; die Uhr wird dabei automatisch
  mitgesteuert. Die einzelnen Uhr-Buttons bleiben zum Nachkorrigieren
  erhalten.
- **Nachspielzeit** wie im Stadion: Die Uhr läuft über 45:00 bzw. 90:00
  hinaus weiter, daneben steht die vom Schiedsrichter **angezeigte**
  Nachspielzeit („+3"). Gesetzt wird sie über Schnellknöpfe `+1` bis `+5`
  (größere Werte über das Feld daneben), sichtbar wird sie erst, sobald
  die reguläre Zeit überschritten ist – so lässt sie sich schon eintragen,
  während der Schiedsrichter die Tafel hochhält. Beim Anpfiff jeder
  Halbzeit wird sie automatisch zurückgesetzt.
- **Spielzeit von Hand setzen** („Spielzeit setzen", unter Start/Stop/
  Reset): Notausgang, wenn die Uhr aus dem Tritt geraten ist – und der
  schnelle Weg, die Nachspielzeit zu testen, ohne 45 Minuten zu warten.
  Eingabe als `MM:SS` oder in Minuten (`67`), gemeint ist immer die
  gesamte Spielzeit. Der Laufzustand bleibt unverändert: Läuft die Uhr,
  zählt sie vom neuen Wert aus weiter.
- **Halbzeitdauer einstellbar** (Standard 45 min, für Jugendspiele z. B.
  35). Bestimmt auch, wo die 2. Halbzeit weiterläuft.
- Einzige Quelle der Wahrheit für den Zustand liegt im Main-Prozess (nicht im
  Renderer) – Control- und Display-Fenster können nicht auseinanderlaufen
- Team-Stammdaten (Name, Kürzel, Logo) im Control-Fenster unter "Team-
  Stammdaten & Logos" editierbar; werden in `teams.json` im Electron-
  userData-Ordner gespeichert und überstehen einen Neustart der App
  (Spielstand/Uhr dagegen bewusst nicht – die starten immer bei null).
  Heim ist fest auf SV Hochlar 28 / SVH mit Vereinslogo vorbelegt
  (`assets/heim-logo.png`), bleibt aber editierbar.
- **Fassung und Baudatum in der Kopfzeile** des Steuerungsfensters
  („Fassung 1.0.0 · 19.8.2026"). Klein und beiläufig, aber der einzige
  Ort, an dem am Spieltag ablesbar ist, welcher Stand auf dem Rechner
  läuft – ohne das ist eine Rückmeldung („das ging nicht") keiner
  Fassung zuzuordnen. Auf der Tafel steht die Angabe bewusst nicht.

## Build-Besonderheit: esbuild statt reinem tsc

`preload.ts` sowie `control.ts`/`display.ts` werden zusätzlich zu `tsc` noch
mit esbuild gebündelt (`scripts/bundle-renderer.js`), weil sie sonst
`require()`/`exports`-Aufrufe enthalten, die weder im sandboxed Electron-
Preload-Kontext noch in einem normalen `<script>`-Tag im Browser
funktionieren. `main.ts`/`state.ts`/`windows.ts`/`persistence.ts` laufen im
Electron-Main-Prozess (normaler Node-Kontext) und brauchen das nicht.

- **Logo-Bibliothek**: liest einen Ordner mit Vereinslogos ein (Struktur
  `<Liga>/Farbe/` und `<Liga>/Weiß/`), Gegner per Dropdown auswählbar.
  Übernimmt Name, Kürzel und Logo; die weiße Variante wird bevorzugt.
- **Kader & Torschützen**: Spieler pro Mannschaft pflegbar, gespeichert
  **pro Verein** in `squads.json` (beim Rückspiel wieder da). Tore lassen
  sich nachträglich einem Torschützen zuordnen.
- **Torjubel** bei jedem Tor im laufenden Spiel
- **Tormusik** aus `Vereinsdaten/Sounds/` (bevorzugt `tor.mp3`, sonst die
  erste Audiodatei im Ordner). Sie läuft über das Windows-Standardgerät –
  also über das, woran der Laptop hängt – und **ausschließlich auf
  Knopfdruck**, nie automatisch beim Tor: Ob Musik gerade passt, hängt an
  Dingen, die die App nicht weiß. Gestartet wird sie über den
  **♪-Knopf direkt neben „Tor +1"** der Heimmannschaft – nach einem
  Treffer sollen Eintragen und Musikstart eine Handbewegung sein.
  „Abspielen", „Stopp", Lautstärkeregler und Stummschalter liegen unter
  „Mehr für den Spieltag": Die stellt man einmal am Platz ein, nicht im
  Jubel. Lautstärke und Stummschaltung überstehen „Neues Spiel".
- **Endstand mit Torschützenliste**: In Halbzeitpause und nach dem
  Abpfiff rückt das Wappen nach oben und der Fuß schrumpft auf das
  Phasen-Label – die Torschützenliste unter jedem Wappen hat dort sieben
  Zeilen, im laufenden Spiel sechs. Dort bleibt das Wappen mittig auf
  einer Höhe mit dem Spielstand. Gezeigt werden Tore
  (Mehrfachtorschützen in einer Zeile zusammengefasst) und Platzverweise;
  gelbe Karten bleiben draußen, sonst wäre die Liste im Nu voll. Passt
  nicht alles, fallen die **ältesten** Einträge heraus – darüber
  erscheinen dann drei kleine goldene Quadrate als Hinweis, dass davor
  noch etwas war.
- **Einblendungen im laufenden Spiel**: Karte und Eckenstand erscheinen
  rund 4 Sekunden als Leiste am unteren Rand der Anzeige und verschwinden
  dann von selbst. Eine Karte erscheint beim Eintragen automatisch – da
  ist der Spieler meist noch nicht zugeordnet, deshalb steht dort
  zunächst die Mannschaft; „Karte einblenden" in der Chronik wiederholt
  sie mit Namen. Ecken werden je Mannschaft unter den Kartenknöpfen
  gezählt. Beide stehen bewusst **nicht** dauerhaft auf der Tafel: Im
  laufenden Spiel ist bei 384×192 kein Platz für eine weitere feste
  Zeile, ohne dem Uhr-Panel etwas wegzunehmen.
- **Diashow** für Werbung/Sponsoren, Vereinshighlights und Termine.
  Läuft **nur auf Knopfdruck** („Diashow → Starten"), nie von selbst –
  vor dem Anpfiff und in der Halbzeitpause. **Sponsoren erscheinen zu
  viert in einem Fenster** aus gleich großen weißen Kacheln unter der
  Titelleiste „Unsere Partner"; bei mehr als vier Logos folgen weitere
  Seiten, kleine Quadrate zeigen die Seite an. Highlights und Termine
  füllen weiterhin das ganze Bild. Die normale Ansicht (Begegnung bzw.
  Zwischenstand) ist selbst eine Station der Rotation, der Spielstand
  ist also nie länger als eine Folie weg. Standzeit 8 Sekunden. Vor dem
  Anpfiff läuft nur die Werbung, in der Pause zusätzlich Highlights und Termine. „Medien neu
  einlesen" liest die Ordner erneut ein, ohne die App neu zu starten.
- **Termine & Ankündigungen** werden im Steuerungsfenster als Textfeld
  gepflegt (eine Zeile je Ankündigung, höchstens fünf Zeilen je Folie)
  und in `content.json` gespeichert.
- **Danksagung an die Zuschauer**: Die Zuschauerzahl wird einmal
  eingetragen und dann als **Vollbild**-Einblendung gezeigt (8 Sekunden,
  wie der Torjubel über das ganze Bild) – die Zahl groß in Gold, darum
  der Dankestext. Der Text ist im Steuerungsfenster unter „Dankestext für
  die Zuschauer-Einblendung" editierbar; `{n}` steht für die Zahl.
  Vorgabe: „Danke für {n} Zuschauer heute am Segensberg!". Ein leeres
  Feld setzt die Vorgabe zurück, ein gelöschtes `{n}` verschluckt die
  Zahl nicht – sie steht dann vorn.
- **Ereignisminuten nach Spielberichts-Konvention**: Tore und Karten in
  der Nachspielzeit stehen als `45+2'` bzw. `90+2'` in der Chronik statt
  einfach weiterzuzählen. Sonst wäre ein Tor in der Nachspielzeit der
  1. Halbzeit nicht von einem kurz nach dem Wiederanpfiff zu
  unterscheiden – beide fielen bei einem Uhrstand von 46:30.
- **Absturzsicherung für das laufende Spiel**: Spielstand, Uhrstand und
  Chronik werden alle 5 Sekunden sowie bei jedem Phasenwechsel nach
  `live-match.json` geschrieben. Nach einem Absturz, leerem Akku oder
  versehentlichem Beenden bietet der nächste Start an, das Spiel
  fortzusetzen – sofern die Sicherung jünger als 6 Stunden ist und das
  Spiel bereits angepfiffen war. Die Uhr wird dabei immer **angehalten**
  übernommen (nach einem Absturz weiß niemand, wie viel Zeit vergangen
  ist) und per „Start" fortgesetzt. Wer das Steuerungsfenster während des
  laufenden Spiels schließt, wird vorher gefragt.

## Datenablage

Die **Tormusik** liegt in `Vereinsdaten/Sounds/` (MP3, WAV, OGG, M4A oder
FLAC). Bevorzugt wird eine Datei namens `tor.*`; liegt keine da, nimmt
die App die erste Audiodatei im Ordner.

Die **Diashow-Bilder** liegen in `Vereinsdaten/Werbung/` und
`Vereinsdaten/Highlights/` – gesucht an denselben drei Orten wie die
Logo-Bibliothek (siehe unten). Die Reihenfolge auf der Tafel ergibt sich
aus dem Dateinamen, deshalb ist `01_`, `02_` … die vorgesehene Pflege.
Erlaubt sind PNG, JPG, WEBP und GIF; alles andere im Ordner wird
ignoriert. Die Bilder werden **nicht** in eine Konfigurationsdatei
kopiert: Das Anzeigefenster lädt sie über ein eigenes Protokoll
(`svh-media:`) direkt von der Platte. Findet sich kein Motiv, nennt das
Steuerungsfenster den Ordner, in dem es gesucht hat.

Die **Logo-Bibliothek** sucht die App beim ersten Start der Reihe nach an
drei Orten: neben der Anwendung (`Vereinsdaten/Liga-Logos` – praktisch für
den Betrieb vom USB-Stick), dann unter
`Dokumente/Anzeigetafel/Vereinsdaten/Liga-Logos`, zuletzt am
Entwicklungspfad `D:\Anzeigetafel\Vereinsdaten\Liga-Logos`. Findet sie
keinen davon, meldet das Steuerungsfenster das deutlich und verweist auf
„Logo-Ordner…", statt ein leeres Dropdown zu zeigen. Der einmal gewählte
Pfad wird in `teams.json` gespeichert.

Im Electron-userData-Ordner (`%APPDATA%/anzeigetafel-laptop-app/`):

- `teams.json` – Stammdaten beider Mannschaften (inklusive Farbvariante
  des Logos und Retro-Kurzname), Pfad zur Logo-Bibliothek, Halbzeitdauer,
  Tafelauflösung und Design samt Effektschaltern und Leuchtfarbe. Die letzten drei gehören zum Verein
  bzw. zum Gerät und überstehen deshalb „Neues Spiel". Ältere Dateien ohne
  Farbvariante werden weiterhin gelesen – ohne Kontrastfläche, also wie
  bisher.
- `squads.json` – Kader, nach Vereinsnamen abgelegt
- `content.json` – Einstellungen, die weder zu einer Mannschaft noch zu
  einem einzelnen Spiel gehören: der Dankestext an die Zuschauer, die
  Termine/Ankündigungen für die Halbzeitpause sowie Lautstärke und
  Stummschaltung. Bewusst neben
  `teams.json`: Dort stehen die Mannschaftsstammdaten, und ein
  Vereinswechsel darf die redaktionellen Texte nicht mitnehmen.
- `live-match.json` – Sicherung des laufenden Spiels (Spielstand, Phase,
  Uhrstand, Chronik, Eckenstand, Zuschauerzahl). Enthält bewusst **keine** Kader, Logos oder
  Portraits: die stehen bereits in den beiden Dateien darüber und würden
  die Sicherung bei jedem Schreibvorgang um Megabyte an Base64-Daten
  aufblähen. Beim Fortsetzen werden sie über den Vereinsnamen wieder
  zugespielt. „Neues Spiel" löscht die Datei.
- `fehler.log` – Protokoll unbehandelter Fehler. Jede Zeile trägt die
  Fassung, die sie erzeugt hat.

Nicht dort, sondern **neben dem Programm** liegt `dist/build-info.json`:
Version und Baudatum, geschrieben bei jedem `npm run build`. Sie gehört
zum ausgelieferten Stand, nicht zu den Nutzerdaten – und wird deshalb
mitgepackt statt gespeichert.

Hinterlegte Bilder werden beim Einlesen verkleinert (Logos auf 256px,
Portraits auf 320px Kantenlänge). Logos bleiben immer PNG, weil sie von
ihrer Transparenz leben. Portraits werden als JPEG abgelegt – deutlich
kleiner als PNG –, **aber nur wenn sie undurchsichtig sind**: Bei einem
freigestellten Portrait würde JPEG den transparenten Bereich schwarz
füllen, und die Torschützen-Einblendung hat keinen eigenen Hintergrund,
auf dem das aufginge. Die App prüft deshalb den Alphakanal und behält
freigestellte Portraits als PNG.

Alle Dateien werden über eine temporäre Datei geschrieben und danach
umbenannt, damit ein Absturz mitten im Schreiben keine abgeschnittene
Datei hinterlässt.

## Noch nicht enthalten (siehe `../Backlog.md`)

Undo über die Chronik hinaus, Speichern von Spieltagen, Trainingsmodus.

## Tests

```bash
npm test
```

Baut und prüft anschließend mit `node:test`: 222 Fälle in rund vier
Sekunden.
`npm run check` ist derselbe Lauf unter dem Namen, der die
Vorab-Prüfung meint – das, was vor einer Auslieferung durchlaufen soll.
Getestet wird gegen den kompilierten Stand in `dist/`, also gegen genau
das, was auch ausgeliefert wird; das `electron`-Modul wird dabei durch
eine Attrappe ersetzt (`tests/helpers.js`).

Abgedeckt sind:

- **Spiellogik** – Uhr und Halbzeitwechsel, Ereignisminute samt
  Nachspielzeit, Spielsicherung, Revisionszähler, Eingabeprüfung,
  Torschützenzeilen, Diashow und Tormusik
- **Bühnenmaße** (`tests/board.test.js`) – dass ein `NaN` aus einem
  halb geleerten Zahlenfeld nicht als Auflösung durchgeht und dass die
  Einstellung „Neues Spiel" übersteht
- **Torjubel** (`tests/celebration.test.js`) – der Führungswechsel
  (inklusive der Regel, dass der Rahmen beim Gegentor ausbleibt), beide
  Stufenfolgen, dass die Ziffer im Spielstand der normalen Ansicht
  einläuft und dass ein Gegentor nichts vom Heimjubel übrig lässt. Der
  Ablauf läuft dabei in Millisekunden durch: Der Test tauscht
  `window.setTimeout` des jsdom-Fensters aus und spult von Hand vor
  (`zeitRaffen()`)
- **Farbvariante der Logos** (`tests/logoVariant.test.js`) – dass die
  weiße Kontrastfläche ausschließlich hinter farbigen Logos erscheint
  und die Helligkeitsprüfung durchsichtige Bildpunkte auslässt
- **Aufstellungs-Parser** (`tests/lineupParser.test.js`) – der
  Einfüge-Weg von fussball.de, inklusive der Regel, dass Betreuerstab
  und Schiedsrichter nicht im Kader landen
- **Zwischenstände der Chronik** (`tests/standings.test.js`) – was
  passiert, wenn ein Tor zurückgenommen wird
- **Phasen-Beschriftungen** (`tests/phaseLabels.test.js`) – dass die
  Ansage am Rücknahme-Knopf zu dem passt, was der Store dann tatsächlich
  tut
- **Beide Fenster als Ganzes** (`tests/renderer.test.js`, siehe unten)

### Smoke-Test der Oberfläche

`tests/dom.js` lädt das echte `index.html` samt gebündeltem Renderer in
eine jsdom-Umgebung, ersetzt die Preload-Brücke durch eine Attrappe und
schiebt jeden vorkommenden Spielzustand hindurch. Gemeldet wird jeder
Fehler aus beiden Kanälen: dem Fehlerbanner des Steuerungsfensters und
dem `console.error` aus `step()` in der Anzeige.

Der Grund dafür steht weiter oben in dieser Datei: TypeScript prüft
keine Element-Zugriffe. Ein `getElementById('x')!` auf ein aus dem HTML
entferntes Element übersetzt klaglos und bricht erst im Betrieb ab.
Gegengeprüft – wird eine Element-Id aus dem HTML entfernt, läuft
`npm run build` weiterhin durch und **vier Tests fallen um**.

Die Zustände stammen aus dem echten `MatchStateStore`, nicht aus
handgeschriebenen Objekten. Dadurch bricht der Test auch, wenn Store und
Renderer auseinanderlaufen.

`openRenderer()` bekommt den Testkontext übergeben und schließt das
Fenster über `t.after()`. Das ist keine Kosmetik: Die Anzeige startet
ein `setInterval` für den Anstoß-Countdown, und ein offen gebliebenes
jsdom-Fenster hält den Node-Prozess am Leben. Ohne das blieb der ganze
Testlauf bei einer fehlgeschlagenen Zusicherung **stehen**, statt rot
abzubrechen – und `npm run dist` verlässt sich genau darauf.

Die Tests ersetzen **keinen** Testlauf der Oberfläche: Schriftgrößen,
Umbrüche, Fensterlayout, Dialoge und das Zusammenspiel beider Fenster am
echten Bildschirm lassen sich damit nicht beurteilen. Der Smoke-Test
nimmt nur die Abstürze ab.

## Starten

```bash
npm install
npm start
```

`npm start` baut zuerst (`tsc` + Asset-Kopie) und startet dann Electron.
Beim allerersten Start lädt Electron sein Runtime-Binary herunter (einmalig,
je nach Verbindung kann das etwas dauern).

Nur bauen ohne zu starten: `npm run build`. Während der Entwicklung mit
automatischem Neu-Kompilieren bei Dateiänderungen: `npm run watch` (Electron
selbst muss dafür separat neu gestartet werden, es gibt noch keinen
Hot-Reload).

## Windows-Paket erstellen

```bash
npm run dist
```

**`npm run dist` lässt zuerst die Tests laufen und bricht ab, wenn eine
rot ist** – gepackt wird nur ein Stand, der durchgelaufen ist. Ein
eigener Build-Schritt davor ist nicht nötig, `npm test` baut bereits.

Erzeugt in `release/` zwei Varianten (jeweils ca. 96 MB):

- **`Anzeigetafel Setup <version>.exe`** – Installer mit Startmenü-Eintrag
- **`Anzeigetafel-portable-<version>.exe`** – läuft ohne Installation,
  z. B. vom USB-Stick

Auf dem Zielrechner wird weder Node.js noch npm gebraucht.

## Eine neue Fassung ausliefern

Verteilt wird **von Hand**, bewusst ohne Auto-Update – die Begründung
steht in `../CLAUDE.md`. Damit sich Fassungen trotzdem auseinanderhalten
lassen, gehört zu jeder Auslieferung dieselbe Reihenfolge:

1. `npm run check` – derselbe Lauf wie `npm test`, unter dem Namen, der
   die Vorab-Prüfung meint.
2. **Version in `package.json` erhöhen.** Ohne das heißen zwei
   verschiedene Stände gleich, und auf dem Vereinsrechner ist nicht mehr
   feststellbar, welcher davon läuft.
3. **Eintrag in `../CHANGELOG.md`** – was sich für die Bedienung ändert,
   nicht welche Datei angefasst wurde.
4. `npm run dist`
5. **Alte `.exe` nach `release/archiv/` verschieben, nicht
   überschreiben.** Das ist der Rückweg, wenn die neue Fassung am
   Spieltag durchfällt. Jede Fassung belegt rund 200 MB – ältere
   gelegentlich wegräumen, aber immer die zuletzt bewährte behalten.
6. Datei auf den Stick bzw. den Spieltags-Laptop.

**Welche Stelle steigt wann** (`major.minor.patch`):

| Stelle | wann | Beispiel |
|---|---|---|
| Patch (1.0.**1**) | Fehlerbehebung, nichts Neues zu lernen | Uhr zeigte 60:00 statt 1:00:00 |
| Minor (1.**1**.0) | neue Funktion, Bedienung bleibt vertraut | Trainingsmodus kommt dazu |
| Major (**2**.0.0) | die Bedienung ändert sich merklich | Umstieg auf eine Controller-App |

Die Fassung steht anschließend **in der Kopfzeile des
Steuerungsfensters**, zusammen mit dem Baudatum („Fassung 1.0.0 ·
19.8.2026"). Das Datum kommt aus `dist/build-info.json`, geschrieben von
`scripts/build-info.js` bei jedem `npm run build`. Fehlt die Datei, zeigt
die Kopfzeile nur die Version – nie ein erfundenes Datum.

Dieselbe Fassung steht in jeder Zeile von `fehler.log`. Eine Rückmeldung
vom Spieltag ist sonst keinem Stand zuzuordnen.

## Erstinstallation auf dem Spieltags-Laptop

**Installer oder portable?** Der **Installer** ist die Empfehlung für den
festen Spieltags-Laptop: Startmenü-Eintrag, und eine neue Fassung
installiert sich über die alte, ohne dass Daten verlorengehen (siehe
unten). Die **portable Fassung** ist für den USB-Stick gedacht – dort
liegt sinnvollerweise auch der Ordner `Vereinsdaten/` daneben, dann
wandern Logos, Werbemotive und Sounds mit.

**Vereinsdaten bereitlegen.** Die App sucht `Vereinsdaten/` der Reihe
nach neben der Anwendung, unter `Dokumente/Anzeigetafel/` und zuletzt am
Entwicklungspfad. Fehlt der Ordner, bleibt das Vereins-Dropdown leer und
die Diashow findet nichts – das Steuerungsfenster sagt dann, wo es
gesucht hat.

**Windows-Warnung beim ersten Start.** Die Dateien sind nicht signiert;
ein Code-Signing-Zertifikat kostet 200–400 € im Jahr und verlangt seit
2023 zusätzlich einen Hardware-Token. Beim ersten Start meldet sich
deshalb der SmartScreen-Filter mit „Der Computer wurde durch Windows
geschützt" – über „Weitere Informationen" → „Trotzdem ausführen" startet
die App. Das ist bei unsignierten Programmen normal und kein Fehler.

**Virenscanner-Ausnahme (Avast, Defender).** Unsignierte Programme
schlagen dort regelmäßig an – im ungünstigsten Fall wird die `.exe`
kommentarlos in die Quarantäne verschoben, während vor dem Anpfiff
aufgebaut wird. Deshalb einmalig eine Ausnahme eintragen, und zwar
**auf den Ordner, nicht auf die Datei**:

- Installiert: `C:\Program Files\Anzeigetafel\`
- Portabel: der Ordner auf dem Stick

Der Grund für den Ordner: Der Dateiname enthält die Versionsnummer
(`Anzeigetafel-portable-1.0.0.exe`). Eine Ausnahme auf die Datei wäre
nach der nächsten Auslieferung wertlos – und das fiele genau dann auf,
wenn es niemand gebrauchen kann.

**Was ein Update mitnimmt.** Kader, Team-Stammdaten, Logo-Pfad, Texte
und die Sicherung des laufenden Spiels liegen in
`%APPDATA%/anzeigetafel-laptop-app/` und bleiben bei einer neuen Fassung
unangetastet. Der Ordnername leitet sich aus dem Feld `name` in
`package.json` ab – geprüft: Das gepackte `package.json` enthält
**kein** `productName`, deshalb ist es in der Entwicklungs- und in der
gepackten Fassung derselbe Ordner.

> **Guardrail:** Käme dort je ein `productName` hinein, änderte Electron
> den Ordnernamen still mit – die App startete dann mit leeren Kadern
> und ohne Logos, und die alten Daten lägen unauffindbar daneben. Wer an
> der `build`-Konfiguration arbeitet, muss das im Blick behalten.
