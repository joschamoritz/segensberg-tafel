/**
 * Punktmatrix für das Retro-Design.
 *
 * Alte Stadiontafeln bestanden aus einzelnen Glühlampen in einem festen
 * Raster -- ein Zeichen war ein Muster aus Punkten, und die erloschenen
 * Punkte blieben als dunkles Raster sichtbar. Dieses Modul baut genau so
 * ein Raster auf: eine Fläche aus Punkten, die an oder aus sind.
 *
 * Es kennt weder DOM noch Canvas. Was auf der Tafel steht, entscheidet die
 * Anzeige (`display.ts`) und reicht es als `RetroScene` herein; hier wird
 * daraus ein Punktmuster. Dadurch lassen sich Schrift, Kürzungen und
 * Aufteilung in Node testen -- der Renderer selbst ist es mangels Canvas
 * in jsdom nicht.
 *
 * Ein Punkt belegt `RETRO_CELL` Tafelpixel im Quadrat: drei leuchten, eines
 * bleibt als Lücke dunkel. Bei 384×192 ergibt das 96×48 Punkte.
 */

/** Tafelpixel je Punkt (Kantenlänge). */
export const RETRO_CELL = 4;

/** Bezugsraster der Seitenaufteilung -- 384×192 geteilt durch `RETRO_CELL`. */
const BASE_COLS = 96;
const BASE_ROWS = 48;

// --------------------------------------------------------------------
// Schriften
// --------------------------------------------------------------------

/**
 * Zeichen als Zeilen aus 0 und 1, von oben nach unten. Die Breite ergibt
 * sich aus der Zeilenlänge -- Doppelpunkt und Punkt sind schmaler als
 * Buchstaben, so wie auf den Vorbildern.
 *
 * Umlaute gibt es bewusst nicht: Alte Tafeln schrieben "MUENCHEN" und
 * "KOELN", und in der kleinen Schrift wäre für die Punkte ohnehin kein
 * Platz. `normalizeRetroText()` übersetzt sie vorher.
 */
const GROSS: Record<string, string> = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  '0': '01110 10001 10011 10101 11001 10001 01110',
  '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111',
  '3': '11110 00001 00001 01110 00001 00001 11110',
  '4': '00010 00110 01010 10010 11111 00010 00010',
  '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110',
  '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110',
  '9': '01110 10001 10001 01111 00001 00010 01100',
  ':': '0 0 1 0 1 0 0',
  '-': '0000 0000 0000 1111 0000 0000 0000',
  '.': '0 0 0 0 0 0 1',
  ',': '00 00 00 00 00 01 10',
  "'": '1 1 0 0 0 0 0',
  '!': '1 1 1 1 1 0 1',
  '?': '01110 10001 00001 00010 00100 00000 00100',
  '+': '00000 00100 00100 11111 00100 00100 00000',
  '/': '00001 00010 00010 00100 01000 01000 10000',
  '(': '001 010 100 100 100 010 001',
  ')': '100 010 001 001 001 010 100',
  ' ': '000 000 000 000 000 000 000',
};

/**
 * Kleine Schrift für dichte Seiten (Aufstellung, Termine, lange Namen).
 * Drei Punkte breit bei 384×192 sind 12 Tafelpixel -- größer als die
 * kleinste Schrift des klassischen Designs.
 */
const KLEIN: Record<string, string> = {
  A: '010 101 111 101 101',
  B: '110 101 110 101 110',
  C: '011 100 100 100 011',
  D: '110 101 101 101 110',
  E: '111 100 110 100 111',
  F: '111 100 110 100 100',
  G: '011 100 101 101 011',
  H: '101 101 111 101 101',
  I: '111 010 010 010 111',
  J: '001 001 001 101 010',
  K: '101 101 110 101 101',
  L: '100 100 100 100 111',
  // M, N und W sind breiter als die übrigen Zeichen: Mit drei Punkten
  // sahen sie einander zum Verwechseln ähnlich ("WIENAND" las sich als
  // "NIENAND"). Die alten Tafeln hatten dasselbe Problem und lösten es
  // genauso.
  M: '10001 11011 10101 10001 10001',
  N: '10001 11001 10101 10011 10001',
  O: '010 101 101 101 010',
  P: '110 101 110 100 100',
  Q: '010 101 101 110 011',
  R: '110 101 110 101 101',
  S: '011 100 010 001 110',
  T: '111 010 010 010 010',
  U: '101 101 101 101 111',
  V: '101 101 101 101 010',
  W: '10001 10001 10101 11011 10001',
  X: '101 101 010 101 101',
  Y: '101 101 010 010 010',
  Z: '111 001 010 100 111',
  '0': '111 101 101 101 111',
  '1': '010 110 010 010 111',
  // Eckig, damit sie sich vom Z unterscheidet -- schräg gezeichnet sahen
  // beide gleich aus ("1. HZ" las sich als "1. H2").
  '2': '111 001 111 100 111',
  '3': '110 001 010 001 110',
  '4': '101 101 111 001 001',
  '5': '111 100 110 001 110',
  '6': '011 100 111 101 111',
  '7': '111 001 010 010 010',
  '8': '111 101 111 101 111',
  '9': '111 101 111 001 110',
  ':': '0 1 0 1 0',
  '-': '000 000 111 000 000',
  '.': '0 0 0 0 1',
  ',': '0 0 0 1 1',
  "'": '1 1 0 0 0',
  '!': '1 1 1 0 1',
  '?': '110 001 010 000 010',
  '+': '000 010 111 010 000',
  '/': '001 001 010 100 100',
  '(': '01 10 10 10 01',
  ')': '10 01 01 01 10',
  ' ': '00 00 00 00 00',
};

export type RetroFont = 'gross' | 'klein';

interface Font {
  height: number;
  glyphs: Record<string, string[]>;
}

function parseFont(table: Record<string, string>): Font {
  const glyphs: Record<string, string[]> = {};
  for (const [char, rows] of Object.entries(table)) glyphs[char] = rows.split(' ');
  return { height: glyphs.A.length, glyphs };
}

const FONTS: Record<RetroFont, Font> = { gross: parseFont(GROSS), klein: parseFont(KLEIN) };

/** Alle Zeichen einer Schrift -- für die Tests, die beide Schriften abgleichen. */
export function retroCharset(font: RetroFont): string[] {
  return Object.keys(FONTS[font].glyphs);
}

/** Zeilen eines Zeichens -- ebenfalls für die Tests. */
export function retroGlyph(font: RetroFont, char: string): string[] | undefined {
  return FONTS[font].glyphs[char];
}

/** Höhe einer Schrift in Punkten, ohne Vergrößerung. */
export function fontHeight(font: RetroFont): number {
  return FONTS[font].height;
}

/**
 * Bereitet einen Text für die Matrix auf: Großbuchstaben, Umlaute
 * ausgeschrieben wie auf den alten Tafeln (KOELN), Akzente entfernt,
 * Gedankenstriche zu Bindestrichen. Was die Schrift dann noch nicht kennt,
 * wird zur Lücke statt zu einem Fehler.
 */
export function normalizeRetroText(text: string): string {
  const upper = text
    .replace(/[äÄ]/g, 'AE')
    .replace(/[öÖ]/g, 'OE')
    .replace(/[üÜ]/g, 'UE')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[–—·•]/g, '-')
    .replace(/[’‘`´]/g, "'");
  return [...upper].map((c) => (c in GROSS ? c : ' ')).join('');
}

/** Breite eines (bereits aufbereiteten) Textes in Punkten. */
export function textWidth(text: string, font: RetroFont, scale = 1): number {
  if (text.length === 0) return 0;
  const glyphs = FONTS[font].glyphs;
  let width = 0;
  for (const char of text) width += ((glyphs[char] ?? glyphs[' '])[0].length + 1) * scale;
  return width - scale;
}

/**
 * Kürzt einen Text, bis er in `maxCols` passt. Ohne Auslassungszeichen:
 * Drei Punkte kosteten auf der Matrix ein halbes Zeichen, und die alten
 * Tafeln schnitten einfach ab. Ein Leerzeichen am Ende fällt mit weg.
 */
export function fitText(text: string, font: RetroFont, scale: number, maxCols: number): string {
  let result = text;
  while (result.length > 0 && textWidth(result, font, scale) > maxCols) {
    result = result.slice(0, -1);
  }
  return result.trimEnd();
}

/** Bricht einen Text an Leerzeichen in höchstens `maxLines` Zeilen um. */
export function wrapText(
  text: string,
  font: RetroFont,
  maxCols: number,
  maxLines: number
): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ').filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, font) <= maxCols) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  return lines.map((line) => fitText(line, font, 1, maxCols));
}

// --------------------------------------------------------------------
// Kurzname
// --------------------------------------------------------------------

/**
 * Vereinsformen, die im Kurznamen wegfallen. Großgeschrieben und ohne
 * Punkt verglichen ("Spvgg." = "SPVGG").
 */
const VEREINSFORMEN = new Set([
  'SPVGG', 'SPVG', 'SPIELVEREINIGUNG', 'SV', 'SSV', 'BSV', 'ESV', 'FSV', 'RSV', 'TSV',
  'FC', 'SC', 'TUS', 'ETUS', 'SUS', 'TURA', 'DJK', 'DJK-SPVGG', 'VFB', 'VFL', 'VFR',
  'BV', 'TV', 'SG', 'TSG', 'JSG', 'SF', 'SPFR', 'SPORTFREUNDE', 'FV', 'FK', 'EV', 'E.V',
]);

/**
 * Schlägt einen Kurznamen für das Retro-Design vor: der Vereinsname ohne
 * Vereinsform und ohne Gründungsjahr. "Spvgg. Erkenschwick" wird zu
 * "Erkenschwick", "SV Hochlar 28" zu "Hochlar", "1. FC Köln" zu "Köln".
 *
 * Nachvollziehbarer als das Kürzel ("SVH"), und auf eine Zeile der Matrix
 * passen nur rund sechzehn Zeichen (Nutzerwunsch 16.10.2026).
 *
 * Eine einzelne Ziffer bleibt stehen -- sie bezeichnet meist die zweite
 * Mannschaft ("Firtinaspor Marl 2"). Bleibt nach dem Kürzen nichts übrig,
 * gilt der ganze Name.
 */
export function deriveRetroName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const kept = words.filter((word) => {
    const key = word.toUpperCase().replace(/\.$/, '');
    if (VEREINSFORMEN.has(key)) return false;
    if (/^\d{2}$|^\d{4}$/.test(word)) return false;
    if (/^\d+\.$/.test(word)) return false;
    return true;
  });
  return kept.length > 0 ? kept.join(' ') : name.trim();
}

/** Der Name, der im Retro-Design steht: von Hand gesetzt oder vorgeschlagen. */
export function retroTeamName(team: { name: string; retroName?: string }): string {
  const manual = team.retroName?.trim();
  return manual ? manual : deriveRetroName(team.name);
}

// --------------------------------------------------------------------
// Punktfläche
// --------------------------------------------------------------------

export class DotMatrix {
  readonly dots: Uint8Array;

  constructor(
    readonly cols: number,
    readonly rows: number
  ) {
    this.dots = new Uint8Array(cols * rows);
  }

  set(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    this.dots[y * this.cols + x] = 1;
  }

  get(x: number, y: number): boolean {
    return this.dots[y * this.cols + x] === 1;
  }

  /** Schreibt einen aufbereiteten Text; `x`/`y` ist die linke obere Ecke. */
  text(text: string, x: number, y: number, font: RetroFont, scale = 1): void {
    const glyphs = FONTS[font].glyphs;
    let cursor = x;
    for (const char of text) {
      const glyph = glyphs[char] ?? glyphs[' '];
      for (let row = 0; row < glyph.length; row++) {
        for (let col = 0; col < glyph[row].length; col++) {
          if (glyph[row][col] !== '1') continue;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              this.set(cursor + col * scale + dx, y + row * scale + dy);
            }
          }
        }
      }
      cursor += (glyph[0].length + 1) * scale;
    }
  }

  centered(text: string, y: number, font: RetroFont, scale = 1, left = 0, width = this.cols): void {
    const fitted = fitText(text, font, scale, width);
    this.text(fitted, left + Math.floor((width - textWidth(fitted, font, scale)) / 2), y, font, scale);
  }

  rightAligned(text: string, right: number, y: number, font: RetroFont, scale = 1): void {
    this.text(text, right - textWidth(text, font, scale) + 1, y, font, scale);
  }

  block(x: number, y: number, w: number, h: number): void {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy);
  }
}

// --------------------------------------------------------------------
// Szenen
// --------------------------------------------------------------------

/**
 * Was auf der Tafel stehen soll, mit bereits fertigen Texten. Die Anzeige
 * entscheidet, welche Szene gerade gilt -- dieselben Zeitschalter wie in
 * den anderen Designs, damit Torjubel, Einblendungen und Diashow in allen
 * Designs gleich lange stehen.
 */
export type RetroScene =
  /** Nur das erloschene Raster, z. B. hinter einem Sponsoren-Fenster. */
  | { kind: 'blank' }
  | { kind: 'matchup'; home: string; away: string; line: string }
  | {
      kind: 'match';
      home: string;
      away: string;
      homeScore: number;
      awayScore: number;
      footer:
        | { kind: 'clock'; clock: string; half: string; stoppage: string }
        | { kind: 'phase'; text: string }
        | { kind: 'info'; title: string; value: string; name: string };
    }
  | { kind: 'goal'; word: string; team: string }
  | { kind: 'scorer'; title: string; name: string; detail: string }
  | { kind: 'thanks'; before: string; number: string; after: string }
  | { kind: 'lineup'; title: string; entries: { number: string; name: string }[] }
  | { kind: 'text'; title: string; lines: string[] };

/**
 * Schlüssel einer Szene OHNE die laufende Uhr und den Anstoß-Countdown.
 *
 * Ändert sich der Schlüssel, baut sich die Tafel Punkt für Punkt neu auf.
 * Uhr und Countdown wechseln jede Sekunde -- ein Aufbau jede Sekunde wäre
 * Unruhe statt Effekt, deshalb springen sie einfach um.
 */
export function retroSceneKey(scene: RetroScene): string {
  if (scene.kind === 'match' && scene.footer.kind === 'clock') {
    return JSON.stringify({ ...scene, footer: { ...scene.footer, clock: '' } });
  }
  if (scene.kind === 'matchup') return JSON.stringify({ ...scene, line: '' });
  return JSON.stringify(scene);
}

/**
 * Wählt die größte Schrift, in der ein Text vollständig passt, und setzt
 * ihn mittig in eine Zeile der Höhe `slot`. Passt er nirgends, wird er in
 * der kleinsten gekürzt.
 */
function autoLine(m: DotMatrix, text: string, y: number, slot: number, left: number, width: number): void {
  const options: [RetroFont, number][] = [
    ['gross', 2],
    ['gross', 1],
    ['klein', 1],
  ];
  const choice =
    options.find(([font, scale]) => textWidth(text, font, scale) <= width) ?? options[options.length - 1];
  const [font, scale] = choice;
  const height = fontHeight(font) * scale;
  m.centered(text, y + Math.floor((slot - height) / 2), font, scale, left, width);
}

/** Eine Tor-Ziffer groß, ohne Kürzung -- zweistellig passt sie noch. */
const SCORE_SCALE = 3;

function composeMatch(m: DotMatrix, scene: Extract<RetroScene, { kind: 'match' }>, x0: number, y0: number, w: number): void {
  const half = Math.floor(w / 2);

  // Namen in der obersten Zeile, Heim links, Gast rechts -- groß, wenn
  // beide nebeneinander passen, sonst klein.
  const room = half - 2;
  const big = textWidth(scene.home, 'gross') <= room && textWidth(scene.away, 'gross') <= room;
  const font: RetroFont = big ? 'gross' : 'klein';
  m.text(fitText(scene.home, font, 1, room), x0 + 1, y0 + 1, font);
  m.rightAligned(fitText(scene.away, font, 1, room), x0 + w - 2, y0 + 1, font);

  // Spielstand groß, der Trenner exakt in der Mitte
  const home = String(scene.homeScore);
  const away = String(scene.awayScore);
  m.rightAligned(home, x0 + half - 5, y0 + 10, 'gross', SCORE_SCALE);
  m.text(away, x0 + half + 4, y0 + 10, 'gross', SCORE_SCALE);
  m.block(x0 + half - 1, y0 + 15, 2, 2);
  m.block(x0 + half - 1, y0 + 23, 2, 2);

  const footer = scene.footer;
  if (footer.kind === 'clock') {
    m.centered(footer.clock, y0 + 34, 'gross', 2, x0, w);
    // Die Halbzeit in großer Schrift, wo sie neben die Uhr passt ("1.HZ"
    // ist 19 Punkte breit, die Uhr beginnt bei 23).
    const half = footer.half.replace(/\s+/g, '');
    const clockLeft = x0 + Math.floor((w - textWidth(footer.clock, 'gross', 2)) / 2);
    if (textWidth(half, 'gross') <= clockLeft - x0 - 3) m.text(half, x0 + 1, y0 + 38, 'gross');
    else m.text(half, x0 + 1, y0 + 39, 'klein');
    if (footer.stoppage) m.rightAligned(footer.stoppage, x0 + w - 2, y0 + 38, 'gross');
  } else if (footer.kind === 'phase') {
    if (textWidth(footer.text, 'gross', 2) <= w) m.centered(footer.text, y0 + 34, 'gross', 2, x0, w);
    else m.centered(footer.text, y0 + 38, 'gross', 1, x0, w);
  } else {
    // Einblendung (Karte, Ecken): ersetzt die Uhr wie in den anderen
    // Designs die Leiste. Kartenfarben gibt es auf einer einfarbigen
    // Tafel nicht -- die Karte steht deshalb als Wort da.
    const value = footer.value;
    m.text(fitText(footer.title, 'gross', 1, w - textWidth(value, 'gross') - 4), x0 + 1, y0 + 33, 'gross');
    m.rightAligned(value, x0 + w - 2, y0 + 33, 'gross');
    if (footer.name) m.text(fitText(footer.name, 'klein', 1, w - 2), x0 + 1, y0 + 42, 'klein');
  }
}

/**
 * Baut das Punktmuster einer Szene.
 *
 * Die Aufteilung ist für 96×48 Punkte gerechnet. Ist die Tafel größer
 * (etwa 384×224 = 96×56), steht der Inhalt mittig darin; ist sie kleiner,
 * wird am Rand abgeschnitten statt verzerrt.
 */
export function composeRetro(raw: RetroScene, cols: number, rows: number): DotMatrix {
  // Erst aufbereiten, dann messen: "Köln" wird zu "KOELN" und damit
  // breiter. Gemessen am Rohtext liefen Kürzung und Zentrierung daneben.
  const scene = JSON.parse(JSON.stringify(raw), (key, value) =>
    typeof value === 'string' && key !== 'kind' ? normalizeRetroText(value) : value
  ) as RetroScene;
  const m = new DotMatrix(cols, rows);
  const w = Math.min(cols, BASE_COLS);
  const x0 = Math.max(0, Math.floor((cols - BASE_COLS) / 2));
  const y0 = Math.max(0, Math.floor((rows - BASE_ROWS) / 2));

  switch (scene.kind) {
    case 'blank':
      break;

    case 'matchup':
      m.centered(fitText(scene.line, 'klein', 1, w), y0 + 1, 'klein', 1, x0, w);
      autoLine(m, scene.home, y0 + 8, 14, x0, w);
      m.centered('GEGEN', y0 + 24, 'klein', 1, x0, w);
      autoLine(m, scene.away, y0 + 31, 14, x0, w);
      break;

    case 'match':
      composeMatch(m, scene, x0, y0, w);
      break;

    case 'goal': {
      const scale = textWidth(scene.word, 'gross', 4) <= w ? 4 : 3;
      m.centered(scene.word, y0 + 4, 'gross', scale, x0, w);
      m.centered(scene.team, y0 + 37, 'gross', 1, x0, w);
      break;
    }

    case 'scorer':
      m.centered(scene.title, y0 + 3, 'gross', 1, x0, w);
      autoLine(m, scene.name, y0 + 13, 14, x0, w);
      m.centered(scene.detail, y0 + 34, 'klein', 1, x0, w);
      break;

    case 'thanks': {
      const before = wrapText(scene.before, 'klein', w - 2, 2);
      const after = wrapText(scene.after, 'klein', w - 2, 2);
      const numberScale = textWidth(scene.number, 'gross', 3) <= w ? 3 : 2;
      const numberHeight = fontHeight('gross') * numberScale;
      const lineStep = fontHeight('klein') + 1;
      const total = before.length * lineStep + numberHeight + after.length * lineStep + 4;
      let y = y0 + Math.max(0, Math.floor((BASE_ROWS - total) / 2));
      for (const line of before) {
        m.centered(line, y, 'klein', 1, x0, w);
        y += lineStep;
      }
      y += 2;
      m.centered(scene.number, y, 'gross', numberScale, x0, w);
      y += numberHeight + 2;
      for (const line of after) {
        m.centered(line, y, 'klein', 1, x0, w);
        y += lineStep;
      }
      break;
    }

    case 'lineup': {
      m.centered(scene.title, y0 + 1, 'gross', 1, x0, w);
      // Bis sechs Einträge einspaltig über die volle Breite -- rund zwanzig
      // Zeichen je Name. Mehr passt nur zweispaltig, und dort kürzte die
      // Matrix schon "BRINKMANN" auf "BRINKMA". Die Anzeige teilt eine
      // volle Aufstellung deshalb in zwei Hälften zu je sechs.
      const twoColumns = scene.entries.length > 6;
      const colWidth = twoColumns ? Math.floor(w / 2) : w;
      const numberWidth = textWidth('00', 'klein');
      scene.entries.slice(0, 12).forEach((entry, i) => {
        const left = x0 + (i < 6 ? 0 : colWidth) + 1;
        const y = y0 + 11 + (i % 6) * 6;
        m.rightAligned(entry.number, left + numberWidth - 1, y, 'klein');
        const nameLeft = left + numberWidth + 3;
        m.text(fitText(entry.name, 'klein', 1, colWidth - numberWidth - 5), nameLeft, y, 'klein');
      });
      break;
    }

    case 'text':
      m.centered(scene.title, y0 + 1, 'gross', 1, x0, w);
      scene.lines.slice(0, 6).forEach((line, i) => {
        m.centered(line, y0 + 11 + i * 6, 'klein', 1, x0, w);
      });
      break;
  }

  return m;
}
