/**
 * Wandelt eine aus fussball.de (oder einer anderen Quelle) kopierte
 * Aufstellung in Spielerdatensätze um.
 *
 * Bewusst tolerant statt streng: Wie der kopierte Text genau aussieht,
 * hängt von Browser, Seitenbereich und Ansicht ab. Lieber ein paar Zeilen
 * zu viel erkennen und in der Vorschau korrigieren lassen, als bei der
 * kleinsten Abweichung gar nichts zu liefern.
 */

import { PlayerRole } from './types';

export interface ParsedPlayer {
  number: number | null;
  firstName: string;
  lastName: string;
  position: string;
  role: PlayerRole;
  isGoalkeeper: boolean;
  isCaptain: boolean;
}

export interface ParsedLineup {
  players: ParsedPlayer[];
  /** Trainername, falls im Text ein Trainer-Abschnitt vorkam */
  coach: string;
}

/** Zeilen, die eine Abschnittsüberschrift sind und die Position setzen. */
const SECTION_POSITIONS: Array<[RegExp, string]> = [
  [/^(tor(wart|hüter)?|tw|keeper)$/i, 'TW'],
  [/^(abwehr|verteidigung|defensive)$/i, 'ABW'],
  [/^(mittelfeld|zentrum)$/i, 'MF'],
  [/^(sturm|angriff|offensive)$/i, 'ST'],
  [/^(auswechselspieler|ersatz(bank|spieler)?|bank|reserve)$/i, 'BANK'],
];

/** Trainer-Abschnitt: die folgende Zeile ist der Trainername. */
const COACH_SECTION = /^trainer(in)?:?$/i;

/**
 * Abschnitte, ab denen keine Spieler mehr folgen (Betreuerstab, Spieldaten).
 * Ohne das würden solche Namen als Spieler übernommen.
 */
const STOP_SECTIONS = [
  /^co-?trainer(in)?:?$/i,
  /^betreuer(in)?:?$/i,
  /^schiedsrichter(in)?:?$/i,
  /^zuschauer:?/i,
  /^tore?:?$/i,
];

/** Zeilen, die reine Überschriften/Rauschen sind und übersprungen werden. */
const NOISE = [
  /^aufstellung$/i,
  /^startelf$/i,
  /^start(formation|aufstellung)$/i,
  /^mannschaft$/i,
  /^spielbericht$/i,
  /^heim$/i,
  /^gast$/i,
  /^\d+\s*$/, // alleinstehende Zahl (z. B. Spaltenkopf)
];

/** Gängige Positionskürzel. */
const POSITION_TOKENS = [
  'TW', 'TOR', 'ABW', 'IV', 'LV', 'RV', 'DM', 'ZM', 'OM',
  'MF', 'LM', 'RM', 'ST', 'MS', 'LA', 'RA',
];

/** Positionskürzel, das direkt in einer Spielerzeile stehen kann. */
const INLINE_POSITION = new RegExp(`^(${POSITION_TOKENS.join('|')})\\b[.:]?\\s*`, 'i');

function isNoise(line: string): boolean {
  return NOISE.some((pattern) => pattern.test(line));
}

function matchSectionPosition(line: string): string | null {
  for (const [pattern, position] of SECTION_POSITIONS) {
    if (pattern.test(line)) return position;
  }
  return null;
}

/**
 * Teilt "Müller, Max" bzw. "Max Müller" in Vor- und Nachname.
 *
 * Exportiert, um die Namenszusatz-Regel ("Max van der Berg") direkt
 * prüfen zu können -- über `parseLineup()` wäre sie nur mittelbar
 * erreichbar. Siehe `tests/lineupParser.test.js`.
 */
export function splitName(raw: string): { firstName: string; lastName: string } {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return { firstName: '', lastName: '' };

  if (name.includes(',')) {
    const [last, first = ''] = name.split(',');
    return { firstName: first.trim(), lastName: last.trim() };
  }

  const parts = name.split(' ');
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };

  // Namenszusätze gehören zum Nachnamen ("Max van der Berg")
  const particles = [
    'van', 'von', 'de', 'den', 'der', 'del', 'della', 'di', 'da', 'dos',
    'el', 'al', 'zu', 'ter', 'ten', 'op',
  ];
  let splitIndex = parts.length - 1;
  for (let i = 1; i < parts.length - 1; i++) {
    if (particles.includes(parts[i].toLowerCase())) {
      splitIndex = i;
      break;
    }
  }

  return {
    firstName: parts.slice(0, splitIndex).join(' '),
    lastName: parts.slice(splitIndex).join(' '),
  };
}

export function parseLineup(text: string): ParsedLineup {
  const players: ParsedPlayer[] = [];
  let coach = '';
  let currentPosition = '';
  let currentRole: PlayerRole = 'start';
  /** true, sobald ein Abschnitt beginnt, in dem keine Spieler mehr stehen */
  let stopped = false;
  /** true direkt nach "Trainer:" -- die nächste Namenszeile ist der Trainer */
  let expectCoach = false;

  for (const rawLine of text.split(/\r?\n/)) {
    // Tabulatoren entstehen beim Kopieren aus Tabellen -- als Trenner
    // behandeln, damit "12<TAB>Max Müller" sauber zerfällt.
    let line = rawLine.replace(/\t+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line) continue;

    if (COACH_SECTION.test(line)) {
      expectCoach = true;
      stopped = true;
      continue;
    }
    if (expectCoach) {
      // Zeile direkt nach "Trainer:" -- Nummer davor gibt es hier nicht
      coach = line.replace(/^[-–•·|]+/, '').trim();
      expectCoach = false;
      continue;
    }

    const section = matchSectionPosition(line);
    if (section) {
      currentPosition = section === 'BANK' ? '' : section;
      currentRole = section === 'BANK' ? 'bench' : 'start';
      stopped = false;
      continue;
    }
    if (STOP_SECTIONS.some((pattern) => pattern.test(line))) {
      stopped = true;
      continue;
    }
    if (stopped || isNoise(line)) continue;

    let position = currentPosition;

    // Positionskürzel am Zeilenanfang übernimmt die Position dieser Zeile
    const inlinePosition = INLINE_POSITION.exec(line);
    if (inlinePosition) {
      position = inlinePosition[1].toUpperCase();
      line = line.slice(inlinePosition[0].length).trim();
    }

    let number: number | null = null;

    // Nummer am Zeilenanfang: "7 Max Müller", "7. Max Müller", "#7 Max Müller"
    const leading = /^#?(\d{1,2})[.)]?\s+/.exec(line);
    if (leading) {
      number = Number(leading[1]);
      line = line.slice(leading[0].length).trim();
    } else {
      // Nummer am Zeilenende: "Max Müller 7"
      const trailing = /\s#?(\d{1,2})[.)]?$/.exec(line);
      if (trailing) {
        number = Number(trailing[1]);
        line = line.slice(0, trailing.index).trim();
      }
    }

    // Kapitänskennzeichnung steht meist als "(C)" hinter dem Namen
    const isCaptain = /\(\s*[CK]\s*\)/i.test(line);

    // Klammerzusätze entfernen: "Max Müller (C)" oder "(eingewechselt 60.)"
    line = line.replace(/\([^)]*\)/g, '').trim();
    // Trennzeichen am Rand entfernen
    line = line.replace(/^[-–•·|]+/, '').replace(/[-–•·|]+$/, '').trim();

    // Positionskürzel am Zeilenende (typisch beim Kopieren aus Tabellen:
    // "7  Max Müller  MF") -- sonst landet es im Nachnamen.
    const words = line.split(' ');
    if (words.length > 1) {
      const last = words[words.length - 1].replace(/[.:]$/, '');
      if (POSITION_TOKENS.includes(last.toUpperCase())) {
        position = last.toUpperCase();
        line = words.slice(0, -1).join(' ').trim();
      }
    }

    // "k.A." steht auf fussball.de, wenn kein Name hinterlegt ist. Der
    // Spieler wird trotzdem übernommen -- die Trikotnummer ist das, was
    // auf der Anzeigetafel zählt.
    if (/^k\.\s?a\.?$/i.test(line)) line = '';

    // Zeilen ohne Buchstaben sind keine Namen
    if (line && !/[a-zäöüßA-ZÄÖÜ]/.test(line)) continue;

    const { firstName, lastName } = splitName(line);
    // Ohne Namen nur übernehmen, wenn wenigstens eine Nummer dasteht
    if (!lastName && number === null) continue;

    players.push({
      number,
      firstName,
      lastName,
      position,
      role: currentRole,
      // Aus einem Torwart-Abschnitt bzw. Positionskürzel ableitbar
      isGoalkeeper: /^(TW|TOR)$/i.test(position),
      isCaptain,
    });
  }

  return { players, coach };
}
