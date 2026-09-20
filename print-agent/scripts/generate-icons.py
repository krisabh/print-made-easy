"""Generate PrintYantra Agent icon assets from the attached logo JPEG.

Removes baked-in checkerboard background, preserves PY mark + white outline,
writes multi-resolution ICO + PNGs under print-agent/build/.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
SRC = Path(
    r"C:\Users\Admin\.cursor\projects\c-Users-Admin-OneDrive-Documents-New-project\assets"
    r"\c__Users_Admin_AppData_Roaming_Cursor_User_workspaceStorage_939c4542c66576850ba012a70e5fdd0a"
    r"_images_Gemini_Generated_Image_yf2irlyf2irlyf2i-461a3b0c-82da-4663-ba76-fe3239fb562b.jpg"
)

SIZES = [256, 128, 64, 48, 32, 16]


def chroma(r: int, g: int, b: int) -> int:
    return max(r, g, b) - min(r, g, b)


def luminance(r: int, g: int, b: int) -> float:
    return 0.299 * r + 0.587 * g + 0.114 * b


def is_checker_like(r: int, g: int, b: int) -> bool:
    """True for gray checkerboard tiles (dark ~39 or light ~126) and JPEG bleed."""
    c = chroma(r, g, b)
    if c > 18:
        return False
    lum = luminance(r, g, b)
    # Any mid/dark gray without enough brightness to be the white outline
    if lum < 190:
        return True
    return False


def is_logo_keep(r: int, g: int, b: int) -> bool:
    """Colored fill or bright white outline."""
    c = chroma(r, g, b)
    lum = luminance(r, g, b)
    if c >= 22:
        return True
    # white / near-white outline only (checker never reaches this)
    if lum >= 200 and c <= 45:
        return True
    # soft AA on white stroke
    if lum >= 190 and c <= 30:
        return True
    return False


def remove_background(img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    w, h = rgba.size
    pixels = rgba.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out_px = out.load()

    for y in range(h):
        for x in range(w):
            r, g, b, _a = pixels[x, y]
            if is_logo_keep(r, g, b):
                out_px[x, y] = (r, g, b, 255)
                continue
            if is_checker_like(r, g, b):
                out_px[x, y] = (0, 0, 0, 0)
                continue
            # Ambiguous AA fringe between logo and checker
            c = chroma(r, g, b)
            lum = luminance(r, g, b)
            if c < 22 and lum < 195:
                out_px[x, y] = (0, 0, 0, 0)
            elif c < 40:
                alpha = max(0, min(255, int(((c - 18) / 22.0) * 220)))
                if alpha < 24:
                    out_px[x, y] = (0, 0, 0, 0)
                else:
                    out_px[x, y] = (r, g, b, alpha)
            else:
                out_px[x, y] = (r, g, b, 255)
    return out


def keep_largest_component(img: Image.Image, alpha_threshold: int = 24) -> Image.Image:
    """Drop stray opaque speckles left by JPEG artifacts."""
    w, h = img.size
    px = img.load()
    visited = [[False] * w for _ in range(h)]
    best: list[tuple[int, int]] = []

    for y in range(h):
        for x in range(w):
            if visited[y][x] or px[x, y][3] <= alpha_threshold:
                continue
            stack = [(x, y)]
            visited[y][x] = True
            component: list[tuple[int, int]] = []
            while stack:
                cx, cy = stack.pop()
                component.append((cx, cy))
                for nx, ny in (
                    (cx - 1, cy),
                    (cx + 1, cy),
                    (cx, cy - 1),
                    (cx, cy + 1),
                ):
                    if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx]:
                        visited[ny][nx] = True
                        if px[nx, ny][3] > alpha_threshold:
                            stack.append((nx, ny))
            if len(component) > len(best):
                best = component

    if not best:
        raise RuntimeError("No logo component found")

    keep = set(best)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out_px = out.load()
    for x, y in keep:
        out_px[x, y] = px[x, y]
    return out


def content_bbox(img: Image.Image, alpha_threshold: int = 16) -> tuple[int, int, int, int]:
    alpha = img.split()[-1]
    bbox = alpha.point(lambda a: 255 if a > alpha_threshold else 0).getbbox()
    if not bbox:
        raise RuntimeError("No opaque logo content found after background removal")
    return bbox


def square_pad(img: Image.Image, pad_ratio: float = 0.08) -> Image.Image:
    bbox = content_bbox(img)
    cropped = img.crop(bbox)
    cw, ch = cropped.size
    side = max(cw, ch)
    pad = max(2, int(side * pad_ratio))
    canvas_side = side + pad * 2
    canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    ox = (canvas_side - cw) // 2
    oy = (canvas_side - ch) // 2
    canvas.paste(cropped, (ox, oy), cropped)
    return canvas


def resize_icon(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    if not SRC.exists():
        raise SystemExit(f"Source logo not found: {SRC}")

    raw = Image.open(SRC)
    cleaned = keep_largest_component(remove_background(raw))
    master = square_pad(cleaned)

    master_path = BUILD / "icon-source.png"
    master.save(master_path, "PNG")
    print(f"Wrote {master_path} size={master.size}")

    icon_png = resize_icon(master, 256)
    icon_png_path = BUILD / "icon.png"
    icon_png.save(icon_png_path, "PNG")
    print(f"Wrote {icon_png_path}")

    tray = resize_icon(master, 32)
    tray_path = BUILD / "tray-icon.png"
    tray.save(tray_path, "PNG")
    print(f"Wrote {tray_path}")

    sized = [resize_icon(master, s) for s in SIZES]
    ico_path = BUILD / "icon.ico"
    # Pillow writes multi-size ICO when sizes= is provided
    sized[0].save(
        ico_path,
        format="ICO",
        sizes=[(s, s) for s in SIZES],
        append_images=sized[1:],
    )
    print(f"Wrote {ico_path} sizes={SIZES}")

    # Sanity: corner of master should be transparent
    corner = master.getpixel((0, 0))
    print(f"Master corner pixel={corner}")
    opaque = sum(1 for p in master.getdata() if p[3] > 16)
    total = master.size[0] * master.size[1]
    print(f"Opaque ratio={opaque / total:.3f} opaque={opaque} total={total}")


if __name__ == "__main__":
    main()
