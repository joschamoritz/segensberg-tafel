# Änderungen

Was sich von Fassung zu Fassung geändert hat – in der Sprache der
Bedienung, nicht in Dateinamen. Wer wissen will, *warum* etwas so gebaut
ist, findet die Begründungen in `CLAUDE.md`.

Die Fassungsnummer steht in der Kopfzeile des Steuerungsfensters, neben
dem Baudatum. Welche Stelle wann steigt, steht in
`laptop-app/README.md` unter „Eine neue Fassung ausliefern".

---

## 1.2.1 – 16.10.2026 (Testfassung)

Nur das Flutlicht-Design ändert sich, Klassisch bleibt wie es ist.

- **Weichere Lichtstrahlen:** fünf Lichtkegel aus einer hellen Quelle am
  oberen Rand, die nach unten auslaufen, statt drei flacher Dreiecke.
- **Die Einblendungen haben jetzt den Flutlicht-Look:**
  - Torjubel mit leuchtendem, geneigtem „TOR!" auf Indigo mit
    Lichtkegel. Beim Gegentor bleibt es ruhig und dunkel.
  - Torschütze und Danksagung stehen groß und geneigt direkt auf dem
    Lichtkegel.
  - Karte und Ecken erscheinen auf einer Indigo-Plakette in der Form
    der Uhr, an deren Stelle.
  - „VS" vor dem Anpfiff ist geneigt wie die Ziffern.
- Die Aufstellungsseiten stehen auf dem neuen Hintergrund, sind sonst
  aber noch unverändert.

## 1.2.0 – 16.10.2026 (Testfassung)

Diese Fassung bringt ein **zweites Design für die Tafel**. Sie ist für
den Test an der echten LED-Wand gebaut; das bisherige Design bleibt
voreingestellt, die Tafel sieht nach dem Update also aus wie vorher.

**Design umschalten**

- Unter **Anzeige → Design** gibt es jetzt **Klassisch** (wie bisher)
  und **Flutlicht**.
- Flutlicht: Lichtkegel von oben, große nach rechts geneigte Ziffern,
  goldene Rauten als Trenner, weiße Vereinsstreifen in den oberen Ecken
  und die Uhr auf einer weißen Plakette – links daneben die Halbzeit
  („1. HZ"), rechts die Nachspielzeit in Gold.
- Die Effekte des Flutlicht-Designs lassen sich **einzeln abschalten**:
  Farbverlauf, Lichtstrahlen, Leuchten hinter den Wappen und Schatten.
  Wenn einer davon auf der Tafel Streifen oder Flimmern zeigt, dort
  abschalten.
- Torjubel und die übrigen Einblendungen sehen in beiden Designs noch
  gleich aus.
- Die Wahl bleibt nach „Neues Spiel" und nach einem Neustart erhalten.

**Sponsoren im Fenster**

- Die Diashow zeigt Sponsorenlogos jetzt **zu viert** in gleich großen
  weißen Kacheln unter der Überschrift „Unsere Partner", statt jedes
  Logo einzeln über das ganze Bild. Bei mehr als vier Logos folgen
  weitere Seiten, kleine Quadrate oben rechts zeigen die Seite an.
- Highlights und Termine laufen wie bisher im Vollbild.
- Die Folienzahl im Hinweis unter „Diashow" zählt jetzt Seiten statt
  einzelner Logos.

## 1.1.0 – 20.08.2026

Diese Fassung ändert nichts an dem, was auf der Tafel steht – sie
räumt das **Steuerungsfenster** auf. Der Anlass: Im Spielbetrieb lag
nichts von dem, was während eines laufenden Spiels gebraucht wird, ohne
Scrollen im Bild. Die Seite war 1650 Pixel hoch, sichtbar waren 660.

**Nichts mehr scrollen**

- Die Bedienung des laufenden Spiels passt jetzt vollständig ins
  Fenster: Spielphasen, Uhr, Spielstand, Karten, Ecken, Nachspielzeit,
  Spielverlauf und Tormusik gleichzeitig sichtbar.
- **Der Spielverlauf steht direkt unter dem Spielstand.** Zwischen
  „Tor +1" und der Stelle, an der anschließend der Torschütze zugeordnet
  wird, lagen 719 Pixel – bei zwei Handgriffen, die praktisch immer
  zusammen ausgeführt werden.
- Die Liste springt automatisch ans Ende, wo das jüngste Ereignis steht,
  und bekommt jede zusätzliche Fensterhöhe: bei einem maximierten
  1080p-Fenster zehn Zeilen auf einen Blick.

**Das Fenster merkt sich seine Größe**

- Beim ersten Start öffnet es maximiert, danach so, wie es zuletzt
  stand. Bisher öffnete es immer gleich groß, und wer maximiert
  arbeitet, stellte das nach jedem Start von Hand her.
- Stand das Fenster zuletzt auf einem Bildschirm, der jetzt nicht mehr
  angeschlossen ist, öffnet es wieder sichtbar statt im Nirgendwo.

**Einrichtung aus dem Weg**

- Zielbildschirm, Tafelauflösung, Team-Stammdaten und Kader liegen hinter
  einer schmalen Leiste oben („Anzeige", „Teams & Logos", „Kader") und
  klappen bei Bedarf über das Fenster auf. Sie belegten bisher dauerhaft
  den besten Platz, obwohl sie im Spiel nie gebraucht werden.

**Kleinigkeiten, die im Betrieb zählen**

- **Tormusik direkt am Torknopf**: ein ♪ neben dem „+" der
  Heimmannschaft. Lautstärke, Stummschalter und „Stopp" liegen unter
  „Mehr für den Spieltag" – die stellt man einmal am Platz ein.
- **„Ecken einblenden" steht jetzt bei den Ecken-Zählern**, nicht mehr
  550 Pixel entfernt bei den Spielphasen.
- **Die Diashow läuft auch nach dem Abpfiff** – während sich der Platz
  leert, ist die sinnvollste Zeit für Sponsorenmotive. Die
  Ankündigungen laufen dort mit.
- **Karten sind farbige Flächen** statt blasser Knöpfe: Man trifft sie,
  ohne zu lesen.
- Größere Klickflächen bei den Ecken-Zählern und beim Löschkreuz im
  Spielverlauf – letzteres war 13×16 Pixel groß und saß direkt neben
  seinem Nachbarn.
- Zwei leere Kästen in „Teams & Logos", die dort nie hätten stehen
  dürfen, sind verschwunden.

---

## 1.0.0 – 19.08.2026

Erste ausgelieferte Fassung. Die Laptop-Version ersetzt die Herstellersoftware im
Spielbetrieb vollständig; sie war an einem Spieltag im echten Einsatz.

**Anzeige und Bedienung**

- Zwei Fenster: Steuerung auf dem Laptop, Anzeige auf dem zweiten
  Bildschirm. Die Anzeige geht dort automatisch in Vollbild – kein
  Ausrichten von Fenstern auf Pixelkoordinaten mehr,
  und die Windows-Skalierung darf stehen, wie sie will.
- Ohne zweiten Bildschirm läuft die Anzeige als Vorschaufenster. Sie
  rechnet ihr Layout in der Auflösung der LED-Wand und skaliert es hoch
  – die Vorschau zeigt damit **dasselbe** Bild wie die Tafel, bis hin zu
  Zeilenumbrüchen und gekürzten Namen.
- Spielstand, Spieluhr, Halbzeiten und Spielphasen (vor Anpfiff, laufend,
  Halbzeitpause, Abpfiff) über die Phasenknöpfe; jeder Schritt lässt sich
  zurücknehmen.
- Nachspielzeit wie im Stadion: Die Uhr läuft weiter, daneben steht die
  vom Schiedsrichter angezeigte Dauer.
- Spielzeit von Hand setzbar, Halbzeitdauer einstellbar (z. B. 35 Minuten
  für Jugendspiele).

**Mannschaften**

- Kader je Verein, beim Rückspiel wieder da. Aufstellungen lassen sich
  von fussball.de direkt hineinkopieren.
- Logo-Bibliothek der Ligavereine; Name, Kürzel und Wappen kommen per
  Dropdown. Fehlt die weiße Variante, legt die Anzeige eine
  Kontrastfläche hinter das farbige Wappen.
- Aufstellung als Vollbildseite vor dem Anpfiff.

**Während des Spiels**

- Torjubel in zwei Akten – Vollbild mit dem Wappen der treffenden
  Mannschaft, dann die neue Ziffer, die in den Spielstand einläuft.
  Beim eigenen Tor mit Konfetti und Gold, beim Gegentor sachlich.
- Ereignis-Chronik mit Toren und Karten, Torschützen nachträglich
  zuordenbar, mit Portrait einblendbar.
- Karten, Eckenstand und Zuschauerzahl als Einblendung am unteren Rand.
- Endstand mit Torschützenliste unter beiden Wappen.
- Tormusik aus `Vereinsdaten/Sounds/`, ausschließlich auf Knopfdruck.

**Vor dem Spiel und in der Pause**

- Diashow mit Werbung, Vereinshighlights und Terminen, auf Knopfdruck.

**Verlässlichkeit**

- Ein laufendes Spiel ist gegen Absturz und Stromausfall gesichert; beim
  nächsten Start bietet die App das Fortsetzen an. Die Uhr kommt dabei
  angehalten zurück.
- 222 automatische Tests laufen vor jedem Paketbau; ein roter Test
  bricht die Auslieferung ab.
