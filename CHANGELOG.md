# Änderungen

Was sich von Fassung zu Fassung geändert hat – in der Sprache der
Bedienung, nicht in Dateinamen. Wer wissen will, *warum* etwas so gebaut
ist, findet die Begründungen in `CLAUDE.md`.

Die Fassungsnummer steht in der Kopfzeile des Steuerungsfensters, neben
dem Baudatum. Welche Stelle wann steigt, steht in
`laptop-app/README.md` unter „Eine neue Fassung ausliefern".

---

## Noch nicht ausgeliefert

**Neu**

- **Verbindung zur Tafel im WLAN:** Ist der Laptop im WLAN der Tafel
  („Taurus-…"), steht in der Kopfzeile „Tafel verbunden" mit der
  Helligkeit. Ein goldener Hinweis erscheint, wenn die Tafel ihr eigenes
  Programm statt des Laptop-Bilds zeigt oder kein HDMI-Signal ankommt.
  Ein Druck darauf öffnet die Einrichtung mit Helligkeitsregler und dem
  Knopf „Tafel auf Laptop-Bild (HDMI) schalten". Am echten Gerät noch
  nicht ausprobiert – der TB50 ist noch nicht da.

---

## 1.7.0 – 20.10.2026 (Testfassung)

Mehr Platz für Sponsoren und eine Diashow, die sich zusammenstellen
lässt. Enthält auch alles aus 1.6.1 – die wurde nicht als eigene Datei
ausgeliefert.

**Neu**

- **Diashow zum Abhaken:** Neben „Starten" stehen Haken für Partner,
  Highlights, Vereinsgeschichte und Termine. Was abgehakt ist, läuft –
  vor dem Anpfiff, in der Pause und nach dem Abpfiff gleichermaßen. Die
  Auswahl bleibt gespeichert. Ein geänderter Haken gilt ab dem nächsten
  Start der Diashow.
- **Große Partner:** Logos im Ordner `Werbung/Hauptsponsor/` stehen in
  der Diashow allein über die ganze Fläche, unter „Unsere Partner". Die
  übrigen Partner (`Werbung/Partner/` oder direkt in `Werbung/`) laufen
  wie bisher zu viert.
- **Vereinsgeschichte:** Alte Mannschaftsfotos im neuen Ordner
  `Vereinsdaten/Historie/` laufen mit Datum und Begegnung darunter. Beides
  kommt aus dem Dateinamen, zum Beispiel
  `1998-05-17_SV Hochlar 28 - Westfalia Herten 3-1.jpg`. Statt des
  Tages geht auch nur Monat (`1998-05_…`) oder Jahr (`1998_…`).
- **„Präsentiert von":** Unter Einrichtung → „Sponsoren" lässt sich je
  ein Logo wählen für die Aufstellung, die Halbzeit (eigene Folie zu
  Beginn der Diashow in der Pause), den Torjubel (unter „TOR!", nur beim
  eigenen Tor), die Ecken-Leiste und den Spieltagssponsor auf der
  Begegnung. „Neues Spiel" leert nur den Spieltagssponsor.
- **Weiße Logos:** Liegt neben einem Logo eine weiße Fassung mit `_weiß`
  am Ende des Namens (`Ott.png` und `Ott_weiß.png`), wird die weiße
  gezeigt – ohne weiße Kachel, direkt auf dem Vereinsblau.

**Nach dem Update**

- Die neuen Ordner `Werbung/Hauptsponsor/`, `Werbung/Partner/` und
  `Historie/` unter `Vereinsdaten/` von Hand anlegen. Bestehende Logos
  direkt in `Werbung/` laufen ohne Umräumen weiter.
- Danach „Medien neu einlesen" drücken oder die App neu starten.

## 1.6.1 – 20.10.2026 (nicht ausgeliefert, enthalten in 1.7.0)

Fehlerbehebungen und Ergänzungen aus dem Review vom Oktober 2026
(`Review-2026-10.md`).

**Behoben**

- **„Neues Spiel“ holte den Gegner vom Programmstart zurück.** Wer
  seitdem einen anderen Verein gewählt hatte, sah danach wieder den
  alten, die Trainer fehlten auf den Aufstellungsseiten, und die nächste
  Kaderänderung konnte den gespeicherten Kader des alten Gegners
  überschreiben. Jetzt bleiben Mannschaften, Logos und Trainer stehen;
  nur Spielstand, Uhr und Spielverlauf beginnen von vorn.
- **Die Tafel bleibt an.** Solange die Anzeige auf der Tafel läuft, lässt
  Windows weder die Bildschirme abschalten noch den Laptop schlafen
  gehen – auch auf Akku nicht.
- **Die Uhr geht nicht mehr nach**, wenn die Rückfrage „Es läuft noch
  ein Spiel“ eine Weile offen stand. Geht der Laptop doch in den
  Ruhezustand, zählt diese Zeit wie bisher nicht mit.
- Der **Mauszeiger** erscheint nicht mehr auf der Tafel, wenn die Maus
  über den Bildschirmrand wandert.
- Ein **Bild, das aufs Steuerungsfenster gezogen wird**, ersetzt nicht
  mehr die ganze Bedienung.
- Ist eine Einstellungsdatei (Kader, Mannschaften, Texte) beschädigt,
  wird sie **beiseitegelegt statt überschrieben**, und oben im Fenster
  steht ein Hinweis. Vorher konnten dabei alle Kader verloren gehen.
- Wird das **HDMI-Kabel erst nach dem Programmstart** eingesteckt, geht
  die Anzeige jetzt von selbst auf die Tafel.
- Nach „Phase zurück“ bis vor den Anpfiff bietet der nächste Start kein
  Spiel mehr zum Fortsetzen an.

**Weniger Fehlbedienung**

- **„Neues Spiel“** ist im laufenden Spiel und in der Halbzeitpause
  gesperrt. Für einen Abbruch zuerst „Abpfiff“.
- **„−“ am Spielstand** fragt nach, wenn das Tor schon einen Torschützen
  hat – Schütze und Minute gingen sonst verloren.
- **„Anpfiff“** sagt, wenn schon Tore, Einträge oder Ecken dastehen
  (etwa vom Ausprobieren beim Aufbau).
- **Spieler aus dem Kader entfernen** fragt nach.
- Das Steuerungsfenster fragt auch **in der Halbzeitpause** nach, bevor
  es sich schließt.

**Neu**

- **Elfmeterschießen** nach dem Abpfiff, unter „Mehr für den Spieltag“:
  je Mannschaft „Treffer“, „Verschossen“ und Zurücknehmen. Die Tafel
  zeigt die Schüsse als Felder, nach „Beenden“ steht im Endstand
  „3:2 i. E.“.
- **Eigentor** und **Strafstoß**: Schalter „ET“ und „FE“ im Spielverlauf.
  Beim Eigentor steht ein Spieler des Gegners zur Wahl; auf der Tafel
  steht „Kowalski (ET)“ bzw. „Lange (FE)“.
- Im **Endstand** steht der Halbzeitstand dabei: „ENDSTAND (1:1)“. Ein
  Abpfiff schon in der 1. Halbzeit heißt auf der Tafel „SPIELABBRUCH“.
- **Fernsteuerung:** Knopf **„Neue PIN“**. Ein iPad mit der alten PIN
  fragt dann von selbst nach der neuen.
- **Fernsteuerung:** Ein zweiter Tipp auf denselben Knopf, während der
  erste noch unterwegs ist, zählt nicht doppelt. Eine goldene Leiste
  oben zeigt, dass gerade etwas gesendet wird. Bilder gehen nur noch
  einmal übers WLAN statt bei jedem Tor.
- Unter den Adressen der Fernsteuerung stehen keine virtuellen
  Netzwerkadapter mehr.
- Fassung und Datum stehen jetzt direkt hinter dem Titel oben links
  (vorher lagen sie bei schmaleren Bildschirmen über „Kader"), daneben
  „Programmiert von Joscha Fresmann".
- **Spielverlauf:** Heim steht immer links, Gast immer rechts, jedes
  Ereignis in einer eigenen Zeile – die Zeit läuft von oben nach unten,
  das Neueste steht unten. Die Vereinsnamen stehen einmal oben über den
  Spalten.

## 1.6.0 – 16.10.2026 (Testfassung)

**Wettbewerbslogo**

- Über der Begegnung vor dem Anpfiff kann jetzt das Logo des
  Wettbewerbs stehen (Kreisliga, Bezirksliga, Pokal …). Gewählt wird
  neben „Anstoß“ unter **Wettbewerb**; die Wahl bleibt bei „Neues Spiel“
  stehen.
- Die Logos liegen in `Vereinsdaten/Wettbewerbe/`. Der Name in der
  Auswahl kommt aus dem Dateinamen.
- Im Retro-Design steht der Name des Wettbewerbs in der Kopfzeile, im
  Wechsel mit dem Countdown.

## 1.5.0 – 16.10.2026 (Testfassung)

**Fernsteuerung vom iPad**

- Die Steuerung lässt sich jetzt vom iPad (oder jedem Gerät mit
  Browser) über das WLAN am Platz bedienen. Der Laptop bleibt per HDMI an
  der Tafel.
- Einschalten unter **Anzeige → Fernsteuerung im WLAN**. Dort stehen die
  Adresse für das iPad und eine sechsstellige **PIN**. Ohne PIN nimmt der
  Laptop keine Befehle an.
- Auf dem iPad: Adresse in Safari öffnen, PIN eingeben, über
  „Teilen → Zum Home-Bildschirm" ein Symbol anlegen.
- Auf dem iPad sind die Knöpfe größer, für den Finger.
- **Tormusik** vom iPad aus läuft **am Laptop**.
- Logo-, Portrait- und Dateiknöpfe fehlen auf dem iPad – sie öffnen ein
  Fenster am Laptop.
- Ist die Verbindung weg, zeigt das iPad einen roten Hinweis und
  verbindet sich selbst neu.
- **Beim ersten Einschalten fragt die Windows-Firewall:** „Private
  Netzwerke" erlauben.

## 1.4.0 – 16.10.2026 (Testfassung)

**Ein- und Auswechslungen**

- Neben den Ecken gibt es je Mannschaft den Knopf **„⇄ Wechsel"**. Er
  trägt den Wechsel mit der Minute in den Spielverlauf ein; dort wählt
  man, wer raus und wer rein geht.
- Sind beide Spieler gewählt, erscheint der Wechsel im Spiel und in der
  Halbzeit **von selbst** auf der Tafel, z. B. „Lange für Demir".
  Ohne Namen zeigt **„Einblenden"** ihn mit der Mannschaft.
- Für beide Mannschaften und in allen drei Designs.
- Danach stehen auf den Aufstellungsseiten die Eingewechselten, und bei
  Torschützen und Karten sind die Spieler auf dem Platz oben einsortiert.
  Der gespeicherte Kader bleibt unverändert.

**Torjubel länger** (alle Designs): Heimtor 4 s statt 1,8 s, Gegentor
3 s statt 2,2 s.

**Retro-Design nachgebessert**

- Passt sich jeder eingestellten Tafelauflösung an; vorher stand der
  Inhalt bei Bildschirmgröße winzig in der Mitte.
- Uhr kleiner, dafür stehen die **letzten drei Tore und Platzverweise**
  unter dem Spielstand – im Spiel, in der Halbzeit und beim Endstand.
- Die Null ohne Schrägstrich.
- „Unsere Partner" steht als Punktschrift über den Sponsoren.

## 1.3.0 – 16.10.2026 (Testfassung)

Ein drittes Design: **Retro**, eine Punktmatrix wie die alten
Stadiontafeln.

- Unter **Anzeige → Design** gibt es jetzt **Retro**. Die Leuchtfarbe
  lässt sich daneben wählen: **Bernstein** oder **Weiß**.
- Die Tafel besteht dann aus einzelnen Leuchtpunkten; die erloschenen
  bleiben als dunkles Raster sichtbar. Umlaute stehen ausgeschrieben da
  wie früher (KOELN).
- **Kurznamen statt Wappen:** Statt „Spvgg. Erkenschwick" steht
  „ERKENSCHWICK". Die App schlägt den Kurznamen selbst vor; unter
  **Teams & Logos → Kurzname im Retro-Design** lässt er sich ändern.
  Leer lassen heißt: Vorschlag verwenden.
- **Neuer Inhalt baut sich Punkt für Punkt auf**, etwa nach einem Tor.
  Die laufende Uhr springt dagegen einfach weiter.
- Torjubel, Torschütze, Karten, Ecken, Danksagung, Aufstellung und
  Termine haben ihre eigene Retro-Fassung. Eine volle Aufstellung
  blättert nach der halben Zeit zur zweiten Hälfte, damit lange Namen
  nicht abgeschnitten werden.
- Sponsorenlogos und Highlight-Bilder erscheinen als Bild über dem
  Punktraster. Ihre endgültige Retro-Gestaltung folgt noch.

## 1.2.2 – 16.10.2026 (Testfassung)

- **Aufstellungsseiten im Flutlicht-Design:** Wappen und Mannschaftsname
  stehen auf einer Indigo-Plakette, der Name geneigt wie die Ziffern. Die
  Spielernamen bleiben gerade, damit sie gut lesbar sind.

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
