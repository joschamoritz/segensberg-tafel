import { BoardLinkState, BoardLinkStatus, MAX_BOARD_BRIGHTNESS, MIN_BOARD_BRIGHTNESS } from '../shared/types';
import type { TaurusPlayerInfo, TaurusVideoState } from './taurus';

// --------------------------------------------------------------------
// Verbindung zum TB50 im WLAN der Tafel
// --------------------------------------------------------------------
//
// Ein Zustandsautomat: suchen -> anmelden -> laufend lesen. Bricht etwas
// ab, beginnt er von vorn. Er hängt NICHT an Electron und bekommt Netz
// und Zeitschalter von außen (`BoardLinkDeps`) -- so laufen die Tests ohne
// Gerät und ohne echte Wartezeiten.
//
// Nichts hiervon ist für den Spielbetrieb nötig: Das Bild geht weiter per
// HDMI. Fällt die Verbindung aus, fehlen nur Anzeige und Helligkeit.

/** Was der Automat vom Taurus-Client braucht -- siehe `TaurusClient`. */
export interface BoardClient {
  login(sn: string, username: string, password: string): Promise<boolean>;
  getBrightness(): Promise<number | null>;
  setBrightness(percent: number): Promise<void>;
  getAmbientLight(): Promise<number | null>;
  getLedScreenSize(): Promise<{ width: number; height: number } | null>;
  getVideoState(): Promise<TaurusVideoState>;
  selectHdmi(): Promise<void>;
  onClose(listener: (error: Error) => void): void;
  close(): void;
}

export interface BoardLinkConfig {
  enabled: boolean;
  username: string;
  password: string;
  /** feste Adresse der Tafel; leer heißt per Rundruf suchen */
  host: string;
}

export interface BoardLinkDeps {
  discover(host: string): Promise<TaurusPlayerInfo[]>;
  connect(player: TaurusPlayerInfo): Promise<BoardClient>;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Abstände. Gesucht wird oft, weil das Hinzukommen des WLANs nicht gemeldet wird. */
export const BOARD_TIMING = {
  searchRetryMs: 5000,
  pollMs: 5000,
  /** Nach falschem Passwort nicht im Takt weiterprobieren -- ob das Gerät
      nach Fehlversuchen sperrt, ist unbekannt. */
  loginRetryMs: 60000,
  errorRetryMs: 5000,
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class BoardLink {
  private config: BoardLinkConfig;
  private state: BoardLinkState = 'off';
  private device: TaurusPlayerInfo | null = null;
  private client: BoardClient | null = null;
  private brightness: number | null = null;
  private ambientLight: number | null = null;
  private video: TaurusVideoState = { source: null, hdmiSignal: null };
  private ledSize: { width: number; height: number } | null = null;
  private message = '';
  private timer: unknown = null;
  /**
   * Zählt jeden Neustart des Automaten hoch. Ein Schritt, der nach einem
   * `await` merkt, dass sich die Nummer geändert hat, verwirft sein
   * Ergebnis -- sonst schriebe eine abgebrochene Suche ihren Fund noch
   * in einen inzwischen abgeschalteten Status.
   */
  private generation = 0;
  /** gewünschte Helligkeit, die noch nicht an der Tafel angekommen ist */
  private pendingBrightness: number | null = null;
  private brightnessInFlight = false;

  constructor(
    config: BoardLinkConfig,
    private readonly deps: BoardLinkDeps,
    private readonly onChange: () => void = () => {}
  ) {
    this.config = { ...config };
  }

  status(): BoardLinkStatus {
    const device = this.device;
    return {
      enabled: this.config.enabled,
      state: this.state,
      device: device
        ? { name: device.aliasName, product: device.productName, sn: device.sn, address: device.address }
        : null,
      brightness: this.brightness,
      ambientLight: this.ambientLight,
      source: this.video.source,
      hdmiSignal: this.video.hdmiSignal,
      ledSize: this.ledSize,
      username: this.config.username,
      host: this.config.host,
      message: this.message,
    };
  }

  getConfig(): BoardLinkConfig {
    return { ...this.config };
  }

  start(): void {
    this.restart();
  }

  stop(): void {
    this.generation++;
    this.clearTimer();
    this.dropClient();
  }

  setEnabled(enabled: boolean): void {
    this.config = { ...this.config, enabled };
    this.restart();
  }

  /** Neue Anmeldedaten oder Adresse: sofort neu verbinden. Leeres Passwort heißt „unverändert". */
  setConfig(update: { username: string; password: string; host: string }): void {
    this.config = {
      ...this.config,
      username: update.username,
      host: update.host,
      password: update.password === '' ? this.config.password : update.password,
    };
    this.restart();
  }

  /**
   * Helligkeit in Prozent. Beim Ziehen am Regler kommen dutzende Werte;
   * gesendet wird immer nur einer zugleich, und danach der jüngste
   * ausstehende -- die Zwischenwerte fallen weg.
   */
  setBrightness(percent: number): void {
    if (this.state !== 'connected') return;
    const value = Math.round(Math.min(MAX_BOARD_BRIGHTNESS, Math.max(MIN_BOARD_BRIGHTNESS, percent)));
    this.pendingBrightness = value;
    void this.flushBrightness();
  }

  /** Tafel auf das HDMI-Bild des Laptops schalten. */
  async selectHdmi(): Promise<void> {
    const client = this.client;
    if (this.state !== 'connected' || !client) return;
    const generation = this.generation;
    try {
      await client.selectHdmi();
      if (generation !== this.generation) return;
      this.video = await client.getVideoState();
      this.message = '';
    } catch (error) {
      if (generation !== this.generation) return;
      this.message = `Umschalten auf HDMI fehlgeschlagen: ${errorText(error)}`;
    }
    this.onChange();
  }

  private async flushBrightness(): Promise<void> {
    if (this.brightnessInFlight) return;
    this.brightnessInFlight = true;
    try {
      while (this.pendingBrightness !== null && this.client && this.state === 'connected') {
        const value = this.pendingBrightness;
        this.pendingBrightness = null;
        const generation = this.generation;
        try {
          await this.client.setBrightness(value);
          if (generation !== this.generation) return;
          this.brightness = value;
          this.message = '';
        } catch (error) {
          if (generation !== this.generation) return;
          this.message = `Helligkeit nicht gesetzt: ${errorText(error)}`;
        }
        this.onChange();
      }
    } finally {
      this.brightnessInFlight = false;
    }
  }

  private restart(): void {
    this.stop();
    this.pendingBrightness = null;
    this.device = null;
    this.brightness = null;
    this.ambientLight = null;
    this.video = { source: null, hdmiSignal: null };
    this.ledSize = null;
    this.message = '';
    if (!this.config.enabled) {
      this.setState('off');
      return;
    }
    void this.search(this.generation);
  }

  private setState(state: BoardLinkState): void {
    this.state = state;
    this.onChange();
  }

  private schedule(ms: number, step: () => void): void {
    this.clearTimer();
    this.timer = this.deps.setTimeout(() => {
      this.timer = null;
      step();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer !== null) this.deps.clearTimeout(this.timer);
    this.timer = null;
  }

  private dropClient(): void {
    const client = this.client;
    this.client = null;
    client?.close();
  }

  private async search(generation: number): Promise<void> {
    // Beim Wiederholen bleibt „nicht gefunden" stehen, statt alle fünf
    // Sekunden kurz auf „suche" zu springen.
    if (this.state !== 'not-found') this.setState('searching');
    let players: TaurusPlayerInfo[];
    try {
      players = await this.deps.discover(this.config.host);
    } catch (error) {
      players = [];
      this.message = errorText(error);
    }
    if (generation !== this.generation) return;

    if (players.length === 0) {
      this.device = null;
      this.setState('not-found');
      this.schedule(BOARD_TIMING.searchRetryMs, () => void this.search(generation));
      return;
    }
    // Am Platz gibt es genau eine Tafel. Antworten mehrere, nehmen wir die
    // erste und sagen es -- eine stille Wahl wäre bei einem zweiten Gerät
    // im Netz kaum zu durchschauen.
    this.device = players[0];
    this.message = players.length > 1 ? `${players.length} Tafeln gefunden – verbunden mit der ersten.` : '';
    await this.login(generation, players[0]);
  }

  private async login(generation: number, player: TaurusPlayerInfo): Promise<void> {
    this.setState('connecting');
    let client: BoardClient;
    try {
      client = await this.deps.connect(player);
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(generation, `Keine Verbindung zur Tafel: ${errorText(error)}`, BOARD_TIMING.errorRetryMs);
      return;
    }
    if (generation !== this.generation) {
      client.close();
      return;
    }
    this.client = client;
    client.onClose(() => {
      // Nur der eigene Abbruch zählt -- ein absichtlich geschlossener
      // alter Client darf den neuen Lauf nicht zurücksetzen.
      if (generation !== this.generation || this.client !== client) return;
      this.client = null;
      this.fail(generation, 'Verbindung zur Tafel getrennt', BOARD_TIMING.errorRetryMs);
    });

    try {
      // Die goracon-Anleitung schreibt „Admin", `@novastar/taurus` schickt
      // „admin" (dort aus ViPlex mitgeschnitten). Ob das Gerät auf Groß-
      // und Kleinschreibung achtet, wissen wir erst am Platz -- also beide.
      const names = [...new Set([this.config.username, this.config.username.toLowerCase()])];
      let ok = false;
      for (const name of names) {
        ok = await client.login(player.sn, name, this.config.password);
        if (ok || generation !== this.generation) break;
      }
      if (generation !== this.generation) return;
      if (!ok) {
        this.dropClient();
        this.message = 'Anmeldung abgelehnt – Benutzer oder Passwort prüfen.';
        this.setState('login-failed');
        this.schedule(BOARD_TIMING.loginRetryMs, () => void this.search(generation));
        return;
      }
      // Die Größe ändert sich nicht im Betrieb, einmal reicht.
      this.ledSize = await client.getLedScreenSize().catch(() => null);
      if (generation !== this.generation) return;
      await this.poll(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(generation, `Anmeldung fehlgeschlagen: ${errorText(error)}`, BOARD_TIMING.errorRetryMs);
    }
  }

  /**
   * Liest die laufenden Werte. Hält zugleich die Anmeldung am Leben:
   * Laut `@novastar/taurus` verfällt sie ohne Verkehr.
   */
  private async poll(generation: number): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      const brightness = await client.getBrightness();
      const video = await client.getVideoState();
      // Kein Sensor ist kein Fehler.
      const ambient = await client.getAmbientLight().catch(() => null);
      if (generation !== this.generation) return;
      // Ein Wert, der gerade unterwegs ist, gewinnt gegen den gelesenen --
      // sonst spränge der Regler beim Ziehen zurück.
      if (this.pendingBrightness === null && !this.brightnessInFlight) this.brightness = brightness;
      this.video = video;
      this.ambientLight = ambient;
      this.setState('connected');
      this.schedule(BOARD_TIMING.pollMs, () => void this.poll(generation));
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(generation, `Tafel antwortet nicht mehr: ${errorText(error)}`, BOARD_TIMING.errorRetryMs);
    }
  }

  private fail(generation: number, message: string, retryMs: number): void {
    this.dropClient();
    this.message = message;
    this.setState('error');
    this.schedule(retryMs, () => void this.search(generation));
  }
}
