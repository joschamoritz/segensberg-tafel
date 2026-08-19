# Änderungen

Was sich von Fassung zu Fassung geändert hat – in der Sprache der
Bedienung, nicht in Dateinamen. Wer wissen will, *warum* etwas so gebaut
ist, findet die Begründungen in `CLAUDE.md`.

Die Fassungsnummer steht in der Kopfzeile des Steuerungsfensters, neben
dem Baudatum. Welche Stelle wann steigt, steht in
`laptop-app/README.md` unter „Eine neue Fassung ausliefern".

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
