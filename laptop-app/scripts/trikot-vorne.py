"""
Baut das Heimtrikot (Vorderseite) für die Aufstellung auf dem Spielfeld:
`src/renderer/display/trikot-heim-vorne.png`.

Quelle ist ein Produktfoto auf weißem Grund (`Vereinsdaten/Trikot-vorne.jpg`).
Darauf kommen das Vereinswappen (weiße Fassung) auf die linke Brust des
Trägers -- im Bild rechts, spiegelbildlich zum Ausrüsterlogo -- und der
Trikotsponsor Ott (weiße Fassung) mittig auf die Brust (Nutzerwunsch
21.10.2026).

Ausführen aus dem Ordner laptop-app (Pillow nötig):

    uv run --native-tls --with pillow python scripts/trikot-vorne.py

Bei einem neuen Trikotfoto, Wappen oder Sponsor nur die Eingabedateien
tauschen und neu ausführen. Lage und Größe der Aufdrucke stehen als
Anteile der Trikotbreite unten in PLACEMENT.
"""

from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SHIRT = ROOT / "Vereinsdaten" / "Trikot-vorne.jpg"
CREST = ROOT / "Vereinsdaten" / "SV Hochlar 28_Weiß.png"
SPONSOR = ROOT / "Vereinsdaten" / "Werbung" / "Partner" / "Ott_weiß.png"
OUT = ROOT / "laptop-app" / "src" / "renderer" / "display" / "trikot-heim-vorne.png"

# Ab diesem Wert (in allen drei Kanälen) gilt ein Bildpunkt als
# Hintergrund. Der Grund des Fotos ist reines Weiß (255); die weißen
# Einsätze am Ärmel sind leicht schattiert und hängen nicht am Rand.
BACKGROUND_MIN = 248

# Mittelpunkt und Breite der Aufdrucke, als Anteil der freigestellten
# Trikotbreite bzw. -höhe.
PLACEMENT = {
    "crest": {"cx": 0.665, "cy": 0.215, "width": 0.13},
    "sponsor": {"cx": 0.50, "cy": 0.42, "width": 0.36},
}

# Ausgabegröße: Auf der Tafel steht ein Trikot rund 21 px hoch; 512 px
# lassen Luft für eine spätere größere Darstellung.
OUT_SIZE = 512


def remove_background(img: Image.Image) -> Image.Image:
    """Macht den weißen Grund vom Rand her durchsichtig (Flutfüllung).

    Nur was mit dem Rand verbunden ist, wird durchsichtig -- weiße Flächen
    im Trikot (Ärmeleinsätze, Kragen) bleiben stehen.
    """
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    seen = bytearray(w * h)
    queue = deque()

    def is_bg(x: int, y: int) -> bool:
        r, g, b = px[x, y]
        return r >= BACKGROUND_MIN and g >= BACKGROUND_MIN and b >= BACKGROUND_MIN

    for x in range(w):
        queue.append((x, 0))
        queue.append((x, h - 1))
    for y in range(h):
        queue.append((0, y))
        queue.append((w - 1, y))

    while queue:
        x, y = queue.popleft()
        i = y * w + x
        if seen[i] or not is_bg(x, y):
            continue
        seen[i] = 1
        if x > 0:
            queue.append((x - 1, y))
        if x < w - 1:
            queue.append((x + 1, y))
        if y > 0:
            queue.append((x, y - 1))
        if y < h - 1:
            queue.append((x, y + 1))

    out = rgb.convert("RGBA")
    alpha = Image.frombytes("L", (w, h), bytes(0 if s else 255 for s in seen))
    out.putalpha(alpha)
    return out.crop(out.getbbox())


def paste_centered(base: Image.Image, overlay: Image.Image, cx: float, cy: float, width: float) -> None:
    ov = overlay.convert("RGBA")
    ov = ov.crop(ov.getbbox())
    target_w = round(base.width * width)
    target_h = round(ov.height * target_w / ov.width)
    ov = ov.resize((target_w, target_h), Image.LANCZOS)
    x = round(base.width * cx - target_w / 2)
    y = round(base.height * cy - target_h / 2)
    base.alpha_composite(ov, (x, y))


def main() -> None:
    shirt = remove_background(Image.open(SHIRT))
    paste_centered(shirt, Image.open(CREST), **PLACEMENT["crest"])
    paste_centered(shirt, Image.open(SPONSOR), **PLACEMENT["sponsor"])

    scale = OUT_SIZE / max(shirt.size)
    shirt = shirt.resize((round(shirt.width * scale), round(shirt.height * scale)), Image.LANCZOS)
    shirt.save(OUT, optimize=True)
    print(f"{OUT.name}: {shirt.size[0]}x{shirt.size[1]}")


if __name__ == "__main__":
    main()
