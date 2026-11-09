"""生成应用图标与托盘图标：一条蓝色小胖鱼。

用法：python tools/make-icons.py
产物：assets/icon.png（512）、assets/tray.png（32）、assets/icon.ico（多尺寸）
"""

from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
S = 4  # 超采样倍数，缩小时自动抗锯齿


def vertical_gradient(width: int, height: int, top: tuple, bottom: tuple) -> Image.Image:
    grad = Image.new("RGB", (1, height))
    px = grad.load()
    for y in range(height):
        t = y / max(1, height - 1)
        px[0, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return grad.resize((width, height), Image.BICUBIC)


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def draw_fish(layer: Image.Image, cx: float, cy: float, w: float, h: float,
              body=(77, 107, 254, 255), belly=(214, 230, 255, 235),
              line=(18, 30, 66, 220), eyes=True) -> None:
    """在已有 RGBA 图层上画一条朝右的胖鱼；所有细节都按 w/h 比例缩放。"""
    d = ImageDraw.Draw(layer)
    half_w, half_h = w / 2, h / 2
    left, top, right, bottom = cx - half_w, cy - half_h, cx + half_w, cy + half_h

    # 尾巴：左侧两片分叉
    d.polygon(
        [
            (left + w * 0.03, cy),
            (left - w * 0.30, cy - h * 0.34),
            (left - w * 0.20, cy - h * 0.04),
            (left - w * 0.20, cy + h * 0.04),
            (left - w * 0.30, cy + h * 0.34),
        ],
        fill=body,
    )

    # 背鳍
    d.polygon(
        [(cx - w * 0.14, top + h * 0.09), (cx + w * 0.06, top - h * 0.19), (cx + w * 0.04, top + h * 0.12)],
        fill=body,
    )
    # 胸鳍
    d.polygon(
        [
            (cx + w * 0.02, cy + h * 0.06),
            (cx + w * 0.22, cy + h * 0.24),
            (cx + w * 0.03, cy + h * 0.30),
        ],
        fill=(body[0], body[1], body[2], 225),
    )

    # 身体
    d.ellipse((left, top, right, bottom), fill=body)

    # 肚皮
    d.ellipse(
        (left + w * 0.11, cy + h * 0.03, right - w * 0.04, bottom - h * 0.05),
        fill=belly,
    )

    if eyes:
        eye_r = h * 0.155
        ex, ey = cx + w * 0.19, cy - h * 0.17
        d.ellipse((ex - eye_r, ey - eye_r * 1.08, ex + eye_r, ey + eye_r * 1.08), fill=(240, 247, 255, 255))
        pupil_r = eye_r * 0.52
        d.ellipse(
            (ex - pupil_r + eye_r * 0.2, ey - pupil_r, ex + pupil_r + eye_r * 0.2, ey + pupil_r),
            fill=(11, 18, 36, 255),
        )
        hl_r = eye_r * 0.2
        d.ellipse(
            (ex - pupil_r * 0.1, ey - pupil_r * 0.75, ex - pupil_r * 0.1 + hl_r * 2, ey - pupil_r * 0.75 + hl_r * 2),
            fill=(255, 255, 255, 235),
        )

        # 腮红（不透明色，直接叠在肚皮上）
        d.ellipse(
            (cx + w * 0.03, cy + h * 0.05, cx + w * 0.03 + w * 0.11, cy + h * 0.05 + h * 0.12),
            fill=(255, 186, 202, 255),
        )

        # 微笑
        mx, my = cx + w * 0.31, cy + h * 0.11
        d.arc(
            (mx - w * 0.075, my - h * 0.07, mx + w * 0.075, my + h * 0.08),
            start=15,
            end=165,
            fill=line,
            width=max(2, int(w * 0.018)),
        )


def build_app_icon() -> Image.Image:
    size = 512 * S
    bg = vertical_gradient(size, size, (26, 44, 92), (8, 13, 26)).convert("RGBA")
    bg.putalpha(rounded_mask(size, int(112 * S)))

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        (size * 0.1, -size * 0.35, size * 0.9, size * 0.55),
        fill=(77, 107, 254, 120),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(60 * S / 4))
    bg.alpha_composite(Image.composite(glow, Image.new("RGBA", (size, size), (0, 0, 0, 0)), bg.getchannel("A")))

    fish_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_fish(fish_layer, cx=size * 0.53, cy=size * 0.55, w=size * 0.56, h=size * 0.42)
    bg.alpha_composite(fish_layer)

    # 水泡点缀
    bubbles = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bubbles)
    for (bx, by, br, alpha) in [
        (0.78, 0.20, 0.035, 150),
        (0.86, 0.31, 0.022, 110),
        (0.20, 0.22, 0.018, 90),
        (0.15, 0.72, 0.026, 70),
    ]:
        x, y, r = size * bx, size * by, size * br
        bd.ellipse((x - r, y - r, x + r, y + r), fill=(125, 227, 244, alpha))
    bg.alpha_composite(bubbles)

    return bg.resize((512, 512), Image.LANCZOS)


def build_tray_icon() -> Image.Image:
    size = 128
    scale = 2
    canvas = size * scale
    layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw_fish(
        layer,
        cx=canvas * 0.52,
        cy=canvas * 0.52,
        w=canvas * 0.62,
        h=canvas * 0.46,
        body=(255, 255, 255, 255),
        belly=(255, 255, 255, 255),
        line=(13, 22, 44, 255),
    )
    # 深色描边：把小一圈的白色鱼垫在深色轮廓上，浅色任务栏也能看清
    outline = Image.new("RGBA", (canvas, canvas), (14, 22, 44, 240))
    outline.putalpha(layer.getchannel("A").filter(ImageFilter.MaxFilter(11)))
    outline.alpha_composite(layer)
    return outline.resize((size, size), Image.LANCZOS).resize((32, 32), Image.LANCZOS)


def main() -> None:
    os.makedirs(ASSETS, exist_ok=True)

    # 只重建托盘图标：python tools/make-icons.py tray
    # （应用图标已改用角色头像，见 tools/make-pet-icon.py）
    if len(sys.argv) > 1 and sys.argv[1] == "tray":
        tray = build_tray_icon()
        tray_path = os.path.join(ASSETS, "tray.png")
        tray.save(tray_path)
        print("tray ->", tray_path)
        return

    icon = build_app_icon()
    icon_path = os.path.join(ASSETS, "icon.png")
    icon.save(icon_path)

    ico_path = os.path.join(ASSETS, "icon.ico")
    icon.save(ico_path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    tray = build_tray_icon()
    tray_path = os.path.join(ASSETS, "tray.png")
    tray.save(tray_path)

    print("icon ->", icon_path)
    print("ico  ->", ico_path)
    print("tray ->", tray_path)


if __name__ == "__main__":
    main()
