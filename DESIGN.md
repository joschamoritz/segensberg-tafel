# DESIGN.md – Anzeigetafel-Steuerungssoftware

Gilt für alle Zielplattformen (Laptop/Electron, später iPad, ggf. Controller-
App). Verbindliche Referenz für UI-Entscheidungen.

## Visual Theme

Die wichtigste Design-Randbedingung ist **keine ästhetische, sondern eine
physikalische**: Der Output der "Display"-Ansicht landet am Ende auf einer
384×192px LED-Wand, die aus mehreren Metern Entfernung abgelesen wird. Das
bedeutet:

- Extrem hoher Kontrast, keine subtilen Grautöne oder Verläufe im Content,
  der auf die LED-Wand geht
- Sehr große, fette Ziffern/Buchstaben – lieber zu groß als zu klein
- Keine feinen Linien, keine kleinen Icons als alleinige Information
- Die **Control-Ansicht** (Laptop-Bedienoberfläche) darf dagegen ruhig dichter
  und "normal" gestaltet sein wie eine übliche Desktop-App – dort sitzt die
  Person aus nächster Nähe davor

Gesamteindruck: sachlich-sportlich, nicht verspielt. Vorbild ist der
**Videowürfel eines Profi-Stadions** (Referenz: Schalke) – Spielstand groß in
der Mitte, Wappen flankierend, Uhr klar abgesetzt darunter.

## Color Palette

Übernommen aus dem bestehenden SVH-Website-Plugin
(`Website/Plugin_Spieltag_Hochlar/assets/style.css`), damit Anzeigetafel und
Vereinsauftritt zusammenpassen. **Diese Werte sind verbindlich, keine
Platzhalter mehr.**

| Token | Wert | Verwendung |
|---|---|---|
| `--svh` | `#29166f` | Vereins-Indigo, Primärfarbe (Hervorhebungen, aktive Buttons) |
| `--svh-dk` | `#1d0f52` | dunkleres Indigo (Kopfleisten, Uhr-Panel) |
| `--svh-lt` | `#3a2490` | helleres Indigo |
| `--svh-gold` | `#d4a843` | Akzentfarbe (Uhr, Trenner, Hervorhebungen) |
| `--svh-blue` | `#104a81` | Blau des Vereins-Hintergrundbildes, Flächenfarbe der Display-Ansicht |
| `--svh-txt` | `#1a1a2e` | Text (Control-Ansicht) |
| `--svh-mut` | `#6b6b78` | Sekundärtext |
| `--svh-bg` | `#f5f5f7` | Hintergrund Control-Ansicht |
| `--svh-brd` | `#e0e0e4` | Rahmen/Trennlinien |
| `--svh-win` / `--svh-loss` / `--svh-draw` | `#16a34a` / `#dc2626` / `#a16207` | Sieg / Niederlage / Unentschieden |
| `--svh-warn` | `#c2410c` | Warnung, Gelb-Rot |
| `--card-yellow` / `--card-red` | `#f5c518` / `#d90429` | Kartenfarben (Display) |
| `--stage-void` | `#000000` | Fläche neben der Bühne (Display) |
| `--tint-gold` / `--tint-warn` / `--tint-loss` | `#fdf6e3` / `#fff1e6` / `#fef2f2` | blasse Hinweisflächen, **nur Control** |
| `--svh-gold-dk` | `#7a5c12` | Text auf `--tint-gold` |
| `--sponsor-page-off` | `#3b2f7a` | gedämpfte Seitenmarke im Sponsoren-Fenster (Display) |
| `--flut-hi` / `--flut-mid` / `--flut-lo` | `#2a79c4` / `#124a86` / `#06142e` | Lichtkegel des Flutlicht-Designs, hell → dunkel |
| `--flut-beam` / `--flut-fade` / `--flut-glow` / `--flut-shadow` | Weiß 6 % / `--flut-lo` 90 % / Hellblau 75 % / Schwarz 45 % | halbtransparente Effekte, **nur Flutlicht**, je einzeln abschaltbar |

Die Tönungen (`--tint-*`) gehören zu je einer Signalfarbe darüber und
stehen deshalb als Token da – als Hex in den Komponenten liefen sie beim
nächsten Farbwechsel auseinander. Auf der Display-Ansicht haben sie
nichts zu suchen: So helle Töne verbietet die LED-Guardrail ohnehin.

**Kein Gelb als Phasenfarbe** – wirkt vereinsfremd. Phasen werden über
Indigo/Gold und die Textinhalte unterschieden, nicht über Signalfarben-Balken
am Bildrand.

## Assets

Vom Verein gepflegt, **außerhalb** der App unter `Vereinsdaten/`:

- `Liga-Logos/<Liga>/Farbe|Weiß/` – Vereinslogos
- `Werbung/` und `Highlights/` – Motive der Diashow. Sie füllen die
  ganze Fläche und werden **nicht** von der App nachbearbeitet. Für die
  LED-Wand gelten dieselben Regeln wie für alles andere: harte
  Flächenfarben, große Schrift, keine feinen Linien. Ein Sponsorenlogo
  auf weißem Grund ist auf der Tafel ein weißer Kasten – besser sind
  Motive, die im Vereinsblau oder auf dunklem Grund angelegt sind.
  Sinnvolles Seitenverhältnis ist 2:1 (wie die Tafel).

Im Repo unter `laptop-app/src/renderer/` bzw. `laptop-app/assets/`:

- **Hintergrundbild** `display/background.jpg` – aus `Vereinsdaten/
  HintergrundBlau.png` auf 1920×1080 herunterskaliert (Original 6000×3375
  wäre zu groß). Blaue Fläche mit Grunge-Textur und diagonalen weißen
  Streifen in zwei Ecken.
  *Offene Frage:* Auf der echten 384×192-LED könnte die feine Textur zu Rauschen
  werden. Falls ja: durch eine reine CSS-Nachbildung ersetzen (Flächenfarbe
  `--svh-blue` + hartkantige diagonale Streifen) – skaliert sauberer und
  entspricht den LED-Guardrails besser.
- **Vereinslogo** `assets/heim-logo.png` – weiße Variante
  (`SV Hochlar 28_Weiß.png`), passt auf den blauen Hintergrund.
  Die Indigo-Variante existiert ebenfalls für helle Untergründe.

## Typography

Ebenfalls aus dem Vereinsauftritt übernommen, self-hosted als Variable Fonts
unter `laptop-app/src/renderer/fonts/` (SIL OFL 1.1, keine externen Requests –
wichtig, da die CSP `font-src 'self'` setzt):

- **Oswald** (200–700) – condensed Grotesk. Für **alles auf der
  Display-Ansicht** (Ziffern, Wappen-Kürzel, Labels) sowie für Überschriften,
  Buttons und Zahlen in der Control-Ansicht. Die schmale Bauform bringt bei
  384px Breite deutlich mehr Zeichen unter als eine normale Grotesk.
- **Source Sans 3** (200–900) – Fließtext/Formulare in der Control-Ansicht.

Ziffern von Uhr und Spielstand immer mit `font-variant-numeric: tabular-nums`,
damit sie beim Hochzählen nicht springen.

## Components

- **Scoreline** (Display): Spielstand groß mittig, Doppelpunkt in Gold,
  Wappen links/rechts flankierend
- **Wappen (crest)**: zeigt **immer das Logo**, wenn vorhanden. Nur wenn kein
  Logo hinterlegt ist, erscheint das Kürzel als Rückfallebene. Niemals beides
  gleichzeitig.
  Hinter einer **farbigen** Logovariante liegt eine weiße Kontrastfläche
  (`.has-plate`, kleine Ecken): Farbige Logos sind für helle Untergründe
  gezeichnet und verschwänden mit ihren dunklen Linien auf dem blauen
  Grund. Hinter weißen Varianten – die es für alle Vereine der Bibliothek
  gibt – steht **keine** Fläche, und hinter dem Kürzel-Rückfall nie: Es
  ist selbst weiß und wäre darauf weg. Bei unbekannter Variante bleibt es
  ohne Fläche. Die Fläche sitzt am Bild, nicht am umgebenden `.crest` –
  der ist im laufenden Spiel spaltenbreit, eine Fläche darauf wäre ein
  weißer Balken quer über die Tafel.
- **Uhr-Panel** (Display): abgesetzte Vollfläche in `--svh-dk` unter dem
  Spielstand, Zeit in `--svh-gold`
- **Torschützenliste** (`.scorer-list`, Display): unter dem Wappen, Minute
  in `--svh-gold`, Name in Weiß, Platzverweise als Farbfläche. Beginnt
  eine halbe Wappenhöhe unter dem Wappen – der gemeinsame Anker steht als
  `--crest-top` an der `.team-column` (50 % im Spiel – dort bleibt das
  Wappen bewusst auf einer Höhe mit dem Spielstand –, 24 % in
  Halbzeit/Endstand). Sind ältere Einträge herausgefallen, steht darüber
  ein Zeichen aus drei kleinen Quadraten in `--svh-gold`.
- **Score-Stepper** (Control): großer +/- Button-Block pro Team,
  Fat-Finger-taugliche Zielgröße (gilt später besonders fürs iPad)
- **Phasen-Buttons** (Control): der im Spielverlauf fällige Schritt ist als
  `.btn-next` in Vereins-Indigo hervorgehoben, unpassende sind deaktiviert
- **Info-Leiste** (`.info-bar`, Display): schmale Vollflächen-Leiste am
  unteren Rand in `--svh-dk`, rund 4 Sekunden sichtbar, für Karte und
  Eckenstand. Wert rechts in `--svh-gold`, Label links in Weiß.
  **Ohne Blinken** – die Information soll ruhig ablesbar sein.
  Sie verdeckt dabei das Uhr-Panel: Bei 384×192 gibt es darunter keinen
  freien Streifen, und kleiner darf die Schrift nicht werden.
  Kartenfarben kommen aus den Tokens `--card-yellow`/`--card-red`,
  Gelb-Rot als hart geteilte Fläche aus beiden.
- **Diashow-Folie** (`.board-slides`, Display): Vollbild auf
  `--svh-blue` (im Flutlicht-Design durchsichtig auf dem Lichtkegel).
  Bilder werden mit `object-fit: contain` vollständig gezeigt, nie
  beschnitten – ein angeschnittenes Sponsorenlogo wäre schlimmer als ein
  Rand. Textfolien (Termine) mit Überschrift in `--svh-gold` und
  höchstens fünf Zeilen in Weiß.
- **Sponsoren-Fenster** (`.sponsor-window`, Display, alle Designs):
  Titelleiste „UNSERE PARTNER" in `--svh-gold` auf `--svh-dk`, darunter
  **2×2 gleich große weiße Kacheln**, Logo eingepasst (`contain`). Ab
  zwei Seiten zeigen kleine gefüllte Quadrate rechts in der Titelleiste
  die Seite an (aktive weiß, übrige `--sponsor-page-off`). Fehlen auf
  einer Seite Logos, bleiben Kacheln **leer** statt zu verschwinden –
  sonst würden die übrigen größer, und gleich große Partner sind der
  Zweck. Weiße Kacheln, weil Sponsorenlogos fast immer für hellen Grund
  gezeichnet sind; die frühere Regel „Motive im Vereinsblau anlegen"
  gilt damit nur noch für Highlights.
- **Torjubel** (`.board-goal` + `.goal-confetti`, Display): zwei Akte,
  gesteuert über `body[data-goal-stage]`.
  1. **Vollbild, für beide Mannschaften gleich aufgebaut:** das Wappen
     der treffenden Mannschaft über dem Schriftzug. Beim eigenen Tor
     (`word`, 1,8 s) „TOR!" in `--svh-gold`, 40cqh, und die Fläche pulst
     mit ~1,4 Hz zwischen `--svh` und `--svh-dk`. Beim Gegentor
     (`plain`, 2,2 s) „TOR" in Weiß, 20cqh, auf **ruhiger Fläche in
     `--svh-dk` ohne Wechsel**. Der Unterschied zwischen Feier und
     Meldung liegt in Farbe, Größe und Fläche – nicht im Aufbau.
     Der ausgeschriebene Vereinsname springt nur ein, wenn für den Verein
     kein Logo hinterlegt ist.
  2. **Zurück auf der Spielansicht** (`boost`): Die neue Ziffer schiebt
     sich von oben in den Spielstand, beim eigenen Tor fällt 16-teiliges
     hartkantiges Konfetti in Gold und Weiß darüber. Der Zwischenstand
     wechselt damit dort, wo die Zuschauer ihn ohnehin suchen.

  **Keine Zwischenseiten** für Mannschaftsname oder Torschütze: Die
  Mannschaft steht schon im Wappen, und der Torschütze ist im Moment des
  Tores praktisch nie eingetragen – für ihn gibt es die eigene
  Einblendung mit Portrait.

  **Kein Zittern** am Schriftzug – das wirkte hektisch, und die Fläche
  pulst ohnehin schon.

  Bei einem **eigenen Führungswechsel** pulst zusätzlich ein 3px starker
  Rahmen in `--svh-gold` dreimal hart auf. Beim Gegentor bleibt er aus,
  auch wenn dort die Führung wechselt: Der Rahmen ist eine Feier.
- **Danksagung** (`.board-thanks`, Display): Vollbild in `--svh-dk`, 8
  Sekunden, für die Zuschauerzahl. Die Zahl groß in `--svh-gold` als
  Motiv, Text darüber und darunter kleiner in Weiß. Ruhig gehalten –
  kein Blinken, kein Farbwechsel wie beim Torjubel. Eine Vollbildfläche
  statt einer Leiste, weil sie pro Spiel nur einmal erscheint und eher
  eine Geste ans Publikum ist als eine Zusatzinformation nebenher.

## Designs der Anzeige

Die Anzeige hat zwei Designs, umschaltbar im Steuerungsfenster unter
„Anzeige → Design" (`body[data-theme]`). Die Wahl liegt in `teams.json`,
gehört also zum Gerät.

- **Klassisch** – alles in diesem Dokument oberhalb dieses Abschnitts.
  Vorgabe, damit ein Update die Tafel nicht ungefragt umgestaltet.
- **Flutlicht** – modernes Design (Entwurf vom 16.10.2026), siehe unten.
- **Retro** – Punktmatrix wie alte Stadiontafeln, geplant (`Backlog.md`).
  Modern und Retro bleiben **strikt getrennt**: keine Segmentziffern oder
  Punktraster im modernen Design.

**Für alle Designs gilt: nur Vereinsfarben.** Die Tafel ist eine Heimtafel.
Indigo, Blau, Gold, Weiß – Gäste erscheinen ausschließlich über ihr Wappen,
nie über eine Farbfläche, und beide Spielstandseiten sind gleich gestaltet.
Ein Entwurf mit Indigo links und Blau rechts las sich als „Heim gegen
Gast" und wurde deshalb verworfen (Nutzer, 16.10.2026).

### Flutlicht

- **Hintergrund:** radialer Lichtkegel von oben Mitte (`--flut-hi` →
  `--flut-mid` → `--flut-lo`), unten zum Fuß hin abgedunkelt
  (`--flut-fade`), dazu drei weiche Lichtstrahlen (`.beams`,
  `--flut-beam`). Beides liegt **unter** allen Inhalten: der Verlauf als
  Hintergrund der Bühne, die Strahlen mit `z-index: -1` – die Bühne ist
  durch ihr `transform` ein Stapelkontext.
- **Vereinsstreifen** in **beiden oberen Ecken**, je ein breiter und ein
  schmaler. Abweichend vom Entwurf (dort oben links und unten rechts):
  Unten rechts läge ein großer Streifen in der Torschützenliste der Gäste.
  Sie sind so bemessen, dass sie über dem Wappen enden, und erscheinen nur
  im laufenden Spiel – in Halbzeit und Endstand rückt das Wappen nach oben.
- **Spielstand:** 52cqh (Pause/Endstand 38cqh), um 12° nach rechts geneigt
  wie in einer Fernseheinblendung. Die Mittelspalte ist dafür 48 statt
  40cqw breit; die Mannschaftsspalten verlieren je 15 px, die
  Torschützenliste kürzt lange Namen also etwas früher als im klassischen
  Design. Trenner: zwei goldene **Rauten**.
- **Keine Umrandungen** an Spielstand und Wappen (Nutzer, 16.10.2026) –
  abgesetzt wird über Helligkeit und Fläche.
- **Wappen** mit blauem Schein (`--flut-glow`).
- **Uhr-Plakette:** weißes Trapez, nach unten schmaler, Zeit in
  `--svh-dk`. Links daneben die Halbzeit („1. HZ") in Weiß, rechts die
  Nachspielzeit („+3") in Gold. Beide hängen absolut an der Plakette,
  damit die Uhr mittig bleibt, wenn „+3" dazukommt.
- **Effektschalter:** Verlauf, Lichtstrahlen, Leuchten und Schatten hängen
  an `body[data-fx~='…']` und lassen sich im Steuerungsfenster einzeln
  abschalten. Ohne Verlauf steht eine ruhige Fläche in `--flut-mid` da.
- **Noch im klassischen Look:** Torjubel, Info-Leiste, Torschützen-
  Einblendung, Danksagung, Aufstellung. Für sie ist eine eigene
  Skizzenrunde vorgesehen (`Backlog.md`).

**Ausnahme von den Guardrails:** Verläufe, Transparenz und Leuchten sind
im Flutlicht-Design erlaubt – aber **nur** dort, und jeder dieser Effekte
muss einzeln abschaltbar sein. Ob sie auf der echten Wand tragen, zeigt
erst der Test am Gerät; wer einen neuen solchen Effekt einführt, braucht
einen eigenen Schalter (`FlutlichtEffects` in `shared/types.ts`). Ein Test
prüft, dass jeder Schalter eine Regel im Stylesheet hat. Alle übrigen
Guardrails gelten unverändert, auch für Flutlicht.

## Layout

- Display-Fenster: füllt IMMER den kompletten Zielbildschirm, kein Rahmen,
  keine Scrollbars, kein Weißraum an den Rändern (siehe CLAUDE.md,
  Präsentationsmodus-Ansatz statt Pixel-Positionierung)
- Control-Fenster: klassisches Desktop-Fensterlayout, feste Mindestgröße,
  frei verschiebbar auf dem Laptop-Bildschirm

### Die Bühne (`.stage`)

Die Display-Ansicht rechnet ihr Layout **nicht in der Fenstergröße**,
sondern in einer Bühne von exakt der Auflösung der LED-Wand (Standard
384×192, im Steuerungsfenster einstellbar). Das Ergebnis wird per
`transform: scale()` formatfüllend hochskaliert und zentriert; was
daneben liegt, bleibt schwarz (`--stage-void`).

Zwei Folgen daraus:

- **Das Vorschaufenster zeigt exakt das Layout der Tafel** – dieselben
  Zeilenumbrüche, dieselben `text-overflow`-Kürzungen, dieselbe Zahl an
  Zeilen in der Torschützenliste. Gestaltungsfragen, die vorher nur am
  Gerät zu klären waren, lassen sich am Schreibtisch beurteilen.
- **Bei abweichendem Bildschirmformat verzerrt nichts mehr**, es
  entstehen schwarze Balken. Schwarz und nicht Vereinsblau: Ein Balken
  soll nicht wie ein Teil des Motivs aussehen.

Alle Größenangaben in `display.css` beziehen sich deshalb mit **`cqw`/
`cqh`** auf die Bühne (`container-type: size`), nicht mit `vw`/`vh` auf
das Fenster. Bei 384×192 gilt `1cqh = 1,92px` und `1cqw = 3,84px`.

Die Maße selbst stehen **nicht** im Stylesheet, sondern kommen als
`--board-w`/`--board-h` aus `display.ts` – siehe Guardrail unten. Den
Skalierungsfaktor (`--board-scale`) rechnet ebenfalls der Renderer: Eine
Länge durch eine Länge zu teilen geht in CSS nicht.

## Shadows

Auf der Display-Ansicht **keine Schatten** (LED-Wand stellt keine
Halbtöne/Transparenz sauber dar). Auf der Control-Ansicht sparsam einsetzbar
für Kartentrennung, aber kein Muss.

## Design Guardrails

- Nichts auf der Display-Ansicht darf von der tatsächlichen Auflösung des
  Zielbildschirms abhängig hart kodiert sein (kein "384x192" im CSS) – die
  Ansicht muss sich auf jede Zielauflösung skalieren, weil die exakte native
  Auflösung noch nicht final verifiziert ist (siehe Backlog.md). Die
  Bühnengröße ist deshalb eine **Einstellung** und erreicht das Stylesheet
  nur als Variable; die Rückfallwerte in `.stage` greifen ausschließlich,
  wenn der Renderer gar nicht anläuft.
- **Größen in der Display-Ansicht immer in `cqw`/`cqh`, nie in `vw`/`vh`.**
  Fensterbezogene Einheiten umgehen die Bühne: Bei einem 16:9-Bildschirm
  bezöge sich `44vh` auf die Fensterhöhe statt auf die 192px der Tafel,
  und die Vorschau zeigte ein anderes Layout als die LED-Wand. Aus
  demselben Grund liegt alles Sichtbare **innerhalb** von `.stage` –
  ein `position: fixed` außerhalb säße im Fenster statt auf der Tafel.
- Farbverläufe/Transparenzen im Display-Content vermeiden – LED-Wände stellen
  das oft schlecht dar. Harte, gesättigte Flächenfarben und harte Kanten sind
  dagegen unproblematisch (auch für Animationen). **Ausnahme:** das
  Flutlicht-Design, mit einzeln abschaltbaren Effekten (siehe „Designs der
  Anzeige")
- **Theme-Regeln immer an `body[data-theme='…']` hängen** und Sichtbarkeit
  dort über `visibility` oder ein eigenes Element steuern, nicht über
  `display` an Elementen, die schon eine Ausblende-Regel haben. Gleiche
  Spezifität, spätere Regel gewinnt – eine Theme-Regel mit `display`
  holte etwa die Vereinsstreifen über den Vollbild-Einblendungen zurück.
- Jede Textgröße auf der Display-Ansicht relativ in `vw`/`vh` angeben, nie in
  festen `px`
- Eckenradien klein halten (max. ~1–1,5vh) – große Rundungen wirken auf
  niedrigauflösenden LED-Matrizen treppig
- **CSS-Reihenfolge beachten:** Basis-Klasse `.btn` muss VOR ihren Varianten
  (`.btn-next`, `.btn-danger` …) stehen. Umgekehrt überschreibt die Basis die
  Variante (gleiche Spezifität, späteres gewinnt) – das hatte schon einmal zu
  weißer Schrift auf weißem Grund geführt.
- **Gekoppelte Positionen über eine CSS-Variable führen.** Wappen und
  Torschützenliste hängen zusammen: Die Liste beginnt eine halbe
  Wappenhöhe darunter. Beide lesen `--crest-top` an der `.team-column`,
  statt zwei Werte parallel zu pflegen – die liefen beim nächsten Umbau
  auseinander.
- **Klassennamen nicht doppelt vergeben.** `.scorer-name` existierte
  gleichzeitig für die kleine Liste unter dem Wappen und für die große
  Torschützen-Einblendung. Da ein *deklarierter* Wert einen *vererbten*
  schlägt – unabhängig von der Spezifität – erbte die Liste die 16vh der
  Einblendung. Die Einblendung heißt deshalb jetzt `.spotlight-*`.
- **Unterlängen brauchen Platz.** Oswald schneidet g, j und y bei
  `line-height: 1` unten ab. Für Fließtext mindestens `1.25`, für
  Listeneinträge `1.3`–`1.35`.
- **`display` im CSS macht das `hidden`-Attribut wirkungslos.** Eine
  Autoren-Regel schlägt die Browser-Regel `[hidden] { display: none }` –
  unabhängig von der Spezifität. Wer einem Element im CSS ein `display`
  gibt und es im Renderer über `element.hidden` schaltet, braucht
  zusätzlich eine `[hidden]`-Regel (siehe `.info-mark`). Elemente ohne
  eigene `display`-Angabe (`.crest-img`, `.stoppage`, `.spotlight-photo`)
  sind nicht betroffen.
- **Diagonale Streifen als CSS, nicht im Hintergrundbild.** Im Bild
  verschob sich ihre Position mit jedem Seitenverhältnis und sie landeten
  unter den weißen Wappen. Als `.deco`-Elemente liegen sie fest in den
  Ecken (`display.css`), außerhalb aller Inhaltsbereiche.
- **Kleine Zeichen als Fläche, nicht als Schrift.** Ein
  Auslassungszeichen, ein Aufzählungspunkt oder ein feiner Rahmen liegt
  bei den hier üblichen Größen unter 3px und verschwindet auf der
  LED-Matrix. Gefüllte Quadrate bleiben sichtbar – so gelöst beim
  Doppelpunkt des Spielstands (`.score-sep`) und beim Abschneide-Zeichen
  der Torschützenliste (`.scorer-more`).
- **Kein hochfrequentes Vollflächen-Blinken, und kein kontraststarkes.**
  Der Torjubel wechselt die Fläche mit ~1,4 Hz zwischen zwei Tönen
  **desselben Indigos** (`--svh` / `--svh-dk`, Kontrastverhältnis 1,16);
  der Text bleibt fest in seiner Farbe. Ein früherer Wechsel zwischen
  Indigo und dem Hintergrundblau lag bei 1,61 und stach spürbar. Die
  Fläche soll pulsen, nicht flackern. Gegenprobe bei so einem Wechsel:
  Bleibt der Text auf **beiden** Tönen gleich gut lesbar? (Gold liegt
  hier bei 6,6 und 7,6.) Und: Es pulst nur der Vollbildakt, nicht der
  ganze Jubel.
- **Bewegung sparsam und nur, wo sie etwas sagt.** Ein zitternder
  Schriftzug wirkte hektisch und ist wieder entfallen. Was bleibt, hat
  je eine Aussage: die einlaufende Ziffer zeigt, *was* sich geändert
  hat, der Rahmenpuls zeigt eine Führungsübernahme.
- **Eine Mannschaft wird durch ihr Wappen gezeigt, nicht durch ihren
  Namen** – überall, auch beim Gegner. Für alle Vereine der Bibliothek
  sind Logos hinterlegt, und der Spielbildschirm zeigt sie ohnehin
  nebeneinander; ein ausgeschriebener Name daneben fiele aus dem Bild.
  Der Name (bzw. das Kürzel) ist die Rückfallebene für den Fall ohne
  Logo, nicht die Alternative.
- **Eine Einblendung mit mehreren Stufen gehört ins CSS, nicht in den
  Renderer.** Der Torjubel schaltet nur `body[data-goal-stage]` weiter;
  welche Teile dann sichtbar sind und wie groß sie stehen, entscheidet
  `display.css`. Alle Teile liegen dafür nebeneinander im HTML statt in
  getrennten Blöcken je Stufe – so bleibt jede Element-Id einmalig und
  der Renderer braucht keinen zweiten Satz davon.
- **Sichtbarkeitsregeln je Stufe als `:not([hidden])` schreiben.**
  Wappen und Torschütze fehlen regelmäßig und werden im Renderer über
  `element.hidden` abgeschaltet. Eine Stufenregel mit blankem `display`
  schlüge das aus (siehe die Regel darüber).

## Responsive Behavior

- Display-Fenster: muss sich automatisch an die Auflösung des gewählten
  Zielbildschirms anpassen (verschiedene Controller-Generationen könnten
  unterschiedliche Auflösungen haben)
- Control-Fenster: feste Mindestgröße, aber frei größenveränderbar, kein
  hartes Layout-Brechen bei kleineren Laptop-Bildschirmen

## Agent Prompts

- "Baue eine neue Komponente für die Control-Ansicht" → helle Palette
  (`--svh-bg`/`--svh-txt`), Source Sans 3 für Text, Oswald für
  Überschriften/Zahlen/Buttons, Desktop-UI-Konventionen
- "Baue eine neue Komponente für die Display-Ansicht" → Oswald, sehr große
  `vh`-basierte Schriftgrößen, Vereinsfarben, kein Text unter einer Größe,
  die auf 384px Breite noch lesbar wäre
- Vereinsfarben immer über die CSS-Variablen referenzieren, nie Hex-Werte
  direkt in Komponenten schreiben. Beide Stylesheets halten das seit dem
  19.08.2026 vollständig ein – Hex-Werte stehen ausschließlich im
  `:root`-Block. Eine Prüfung dafür ist ein `grep` auf `#` außerhalb von
  `:root`.
