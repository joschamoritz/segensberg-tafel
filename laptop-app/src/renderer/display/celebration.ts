import { GoalEvent, GoalStage, goalStagesFor, MatchState, showsLeadChangeFrame, TeamId } from '../../shared/types';
import { applyLogoPlate } from './common';

// Torjubel: Vollbild, danach die einlaufende Ziffer in der Spielansicht.
// Der Ablauf selbst steht im Stylesheet, hier wird nur weitergeschaltet.

/** Zuletzt verarbeitetes Ereignis. Verhindert, dass der Jubel bei jedem
    Zustands-Update erneut startet. */
let lastSeenEventId = 0;

/** Laufende Zeitschalter des Torjubels: die Stufenwechsel und das Ende.
    Sammelt sie, weil ein zweites Tor kurz nach dem ersten den ganzen
    Ablauf zurücksetzen muss und nicht nur den letzten Schritt. */
const goalTimers: ReturnType<typeof setTimeout>[] = [];

/** Wartet auf das Ende des laufenden Jubels, siehe afterCelebration(). */
let afterwards: (() => void) | null = null;

/**
 * Führt `callback` aus, sobald kein Torjubel mehr läuft -- sofort, wenn
 * gerade keiner läuft. Gedacht für die Torschützen-Einblendung: Wer nach
 * dem Tor schnell den Schützen wählt und einblendet, soll den Jubel nicht
 * überdecken, und die Einblendung soll trotzdem ihre volle Zeit stehen.
 * Es wartet immer nur einer; ein neuer Auftrag ersetzt den alten.
 */
export function afterCelebration(callback: () => void): void {
  if (goalTimers.length === 0) {
    afterwards = null;
    callback();
  } else {
    afterwards = callback;
  }
}

/** Verwirft einen wartenden Auftrag (die Einblendung wurde abgeräumt). */
export function cancelAfterCelebration(): void {
  afterwards = null;
}

/**
 * Lässt die Ziffern einer Mannschaft im Spielstand der normalen Ansicht
 * von oben einlaufen.
 *
 * Bewusst dort und nicht auf einer eigenen Seite (Nutzerentscheidung
 * 19.08.2026): Der Zwischenstand soll da wechseln, wo die Zuschauer ihn
 * ohnehin suchen. Markiert werden alle Ziffern der treffenden
 * Mannschaft -- bei 9 -> 10 ist die Zehnerstelle ja tatsächlich neu.
 */
function rollScore(team: TeamId): void {
  const element = document.getElementById(`${team}-score`);
  if (!element) return;
  for (const zelle of element.children) zelle.classList.add('is-rolling');
}

/** Nimmt die Marken wieder weg, damit ein späterer Aufbau sauber steht. */
function clearScoreRoll(): void {
  for (const team of ['home', 'away'] as TeamId[]) {
    const element = document.getElementById(`${team}-score`);
    if (!element) continue;
    for (const zelle of element.children) zelle.classList.remove('is-rolling');
  }
}

/** Räumt den Jubel ab -- am Ende des Ablaufs und vor jedem Neustart. */
function endCelebration(): void {
  for (const timer of goalTimers) clearTimeout(timer);
  goalTimers.length = 0;
  document.body.classList.remove('celebrating', 'goal-lead-change', 'goal-home');
  delete document.body.dataset.goalStage;
  clearScoreRoll();
}

/**
 * Schaltet auf eine Stufe.
 *
 * `celebrating` gilt nur für die Vollbildstufen. In `boost` ist die
 * Vollbildfläche weg und die normale Spielansicht wieder da -- genau
 * dort läuft dann die Ziffer ein.
 */
function applyGoalStage(stage: GoalStage, team: TeamId): void {
  document.body.dataset.goalStage = stage;
  document.body.classList.toggle('celebrating', stage !== 'boost');
  if (stage === 'boost') rollScore(team);
}

/**
 * Startet den Torjubel für ein neues Ereignis. Wird nur aufgerufen, wenn
 * die Ereignis-Id noch nicht gesehen wurde -- sonst würde der Jubel bei
 * jedem Zustands-Update neu anlaufen.
 *
 * Der Ablauf unterscheidet Heim- und Gegentor (Nutzerwunsch): beim
 * eigenen Verein Wappen und "TOR!" auf pulsender Fläche, beim Gegner der
 * Mannschaftsname auf ruhigem Grund. Danach beide Male zurück auf die
 * Spielansicht, in der sich die neue Ziffer an ihren Platz schiebt.
 *
 * Ein Torschütze steht hier bewusst nicht: Er ist im Moment des Tores
 * praktisch nie eingetragen. Dafür gibt es den Knopf "Torschütze
 * einblenden" mit Portrait.
 */
function startCelebration(state: MatchState, goal: GoalEvent): void {
  // Ein zweites Tor kurz nach dem ersten setzt den Ablauf zurück, statt
  // sich mit ihm zu überlagern.
  endCelebration();

  const istHeimtor = goal.team === 'home';
  const teamState = state[goal.team];

  // Kein Ausrufezeichen beim Gegentor -- gejubelt wird hier nicht.
  document.getElementById('goal-word')!.textContent = istHeimtor ? 'TOR!' : 'TOR';

  // Das Wappen der treffenden Mannschaft -- bei BEIDEN. Für die
  // Gastvereine sind Logos genauso hinterlegt wie für den eigenen, und
  // der normale Spielbildschirm zeigt sie ohnehin nebeneinander. Ein
  // ausgeschriebener Name an dieser Stelle fiele aus dem Bild.
  //
  // Der Name bleibt die Rückfallebene, wenn für den Verein kein Logo
  // hinterlegt ist -- dieselbe Regel wie beim Wappen auf dem
  // Spielbildschirm, nur dass dort das Kürzel einspringt.
  const crest = document.getElementById('goal-crest') as HTMLImageElement;
  const team = document.getElementById('goal-team')!;
  const logo = teamState.logoDataUrl;
  if (logo) crest.src = logo;
  crest.hidden = logo === undefined;
  applyLogoPlate(crest, teamState.logoVariant);
  team.textContent = teamState.name;
  team.hidden = logo !== undefined;

  document.body.classList.toggle('goal-home', istHeimtor);
  document.body.classList.toggle('goal-lead-change', showsLeadChangeFrame(goal));

  const stufen = goalStagesFor(goal.team);

  // Die erste Stufe steht sofort: Über einen Timer mit 0 ms stünde für
  // einen Frame eine leere Fläche da.
  applyGoalStage(stufen[0].stage, goal.team);

  let versatz = 0;
  stufen.forEach(({ stage, ms }, i) => {
    if (i > 0) {
      const beginn = versatz;
      goalTimers.push(setTimeout(() => applyGoalStage(stage, goal.team), beginn));
    }
    versatz += ms;
  });
  goalTimers.push(
    setTimeout(() => {
      endCelebration();
      const next = afterwards;
      afterwards = null;
      next?.();
    }, versatz)
  );
}

/**
 * Prüft, ob seit dem letzten Update ein neues Tor dazugekommen ist.
 * Beim allerersten Aufruf werden bestehende Ereignisse nur als gesehen
 * vermerkt -- ein neu geöffnetes Anzeigefenster soll keinen alten
 * Torjubel nachholen.
 */
export function handleEvents(state: MatchState, isFirstRender: boolean): void {
  const latest = state.events[state.events.length - 1];
  const latestId = latest?.id ?? 0;

  if (isFirstRender) {
    lastSeenEventId = latestId;
    return;
  }

  if (latestId <= lastSeenEventId) {
    // Keine neuen Ereignisse. Bei einer Korrektur (Tor zurückgenommen)
    // sinkt die Id -- dann mitziehen, damit ein erneutes Tor wieder zündet.
    lastSeenEventId = latestId;
    return;
  }

  lastSeenEventId = latestId;
  if (latest && latest.type === 'goal' && latest.celebrate) {
    startCelebration(state, latest);
  }
}
