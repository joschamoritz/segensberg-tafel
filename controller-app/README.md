# Controller-Test-App

Minimale Android-Diagnose-App, um später zu verifizieren, ob und wie sich eine
eigene App über den `novasoft`-Mechanismus auf dem NovaStar Taurus TB50
installieren lässt (siehe `CLAUDE.md` im Projekt-Root, Abschnitt
"Rechercheergebnisse: Ansteuerung des TB50").

Die App macht bewusst noch nichts Produktives – sie zeigt nur:
- Gerätemodell und Android-Version
- lokale IP-Adresse(n) (relevant für spätere Netzwerk-Fernsteuerung)
- die tatsächliche Fenster-Auflösung in Pixeln (klärt die offene Frage
  384x192 vs. 384x224 aus `Backlog.md`)
- einen laufenden Sekundenzähler als Liveness-Beweis (zeigt, dass die App
  wirklich läuft und nicht nur ein Standbild ist)

Läuft im Vollbild (Status-/Navigationsleiste ausgeblendet), hält den
Bildschirm wach und startet im Querformat.

## Build-Status

Android Studio ist auf der Maschine installiert (`D:\Programme\Android
Studio`, SDK unter `D:\Programme\Android Studio SDK Components`,
`local.properties` in diesem Ordner ist schon darauf eingestellt). Ein
Gradle-Build **über die Kommandozeile aus dem Agenten-Tool heraus** ist
allerdings fehlgeschlagen (`Unable to establish loopback connection` – ein
Java-NIO/Socket-Problem der Shell-Ausführungsumgebung des Agenten, kein
Problem im Projekt selbst). compileSdk/targetSdk (36) und die AGP-/Kotlin-
Plugin-Versionen (8.7.3 / 2.0.21) sind bereits passend zum installierten SDK
gesetzt.

**Der Build muss deshalb direkt in Android Studio (GUI) erfolgen** – dort
sollte er ohne die genannten Probleme funktionieren, da die IDE außerhalb der
eingeschränkten Shell-Umgebung läuft.

## Bauen & zuerst auf einem normalen Gerät testen

1. Diesen Ordner (`controller-app/`) in Android Studio öffnen ("Open") –
   Android Studio erzeugt beim ersten Öffnen automatisch den Gradle-Wrapper
2. Gradle-Sync abwarten – falls Android Studio eine neuere AGP-/Gradle-Version
   vorschlägt, den Vorschlag annehmen
3. **Wichtig: Erst auf einem Emulator oder einem beliebigen vorhandenen
   Android-Handy/-Tablet testen** (auf dieser Maschine ist z. B. auch
   BlueStacks installiert, das sich dafür eignen könnte), bevor überhaupt ein
   TB50 zur Verfügung steht – einfach über "Run" in Android Studio. So lässt
   sich der App-Code selbst verifizieren, unabhängig vom `novasoft`-
   Mechanismus.
4. Für eine installierbare APK-Datei: Build > Build App Bundle(s) / APK(s) >
   Build APK(s)

## Nächster Schritt

Sobald der TB50-Controller verfügbar ist (laut Planung Ende 2026/Anfang
2027), folgt das Testprotokoll in `../Testprotokoll-TB50-novasoft.md`.
