"""用桌宠角色的头像生成应用图标与托盘图标。

用法：
  1) 先用 ffmpeg 从任意动画里导出一帧带 alpha 的 PNG
  2) python tools/make-pet-icon.py <frame.png>

产物：assets/icon.png（512）、assets/icon.ico（多尺寸）、assets/tray.png（32）

角色素材来自 dsh-pet，CC BY-NC-SA 4.0，详见 THIRD-PARTY-NOTICES.md
"""

from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
S = 4  # 超采样

# 角色在图中的有效区域（由 alpha>128 的包围盒推导，留一点余量）
CROP = (196, 46, 448, 300)


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


def load_frame(path: str) -> Image.Image:
    frame = Image.open(path).convert("RGBA")
    return frame.crop(CROP)


def build_app_icon(frame: Image.Image) -> Image.Image:
    size = 512 * S
    bg = vertical_gradient(size, size, (23, 40, 86), (7, 12, 24)).convert("RGBA")
    bg.putalpha(rounded_mask(size, int(112 * S)))

    # 顶部蓝色光晕
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((size * 0.08, -size * 0.4, size * 0.92, size * 0.5), fill=(77, 107, 254, 130))
    glow = glow.filter(ImageFilter.GaussianBlur(52 * S / 4))
    bg.alpha_composite(glow)

    # 角色：按高度铺满，底部略微超出画面（半身像）
    fw, fh = frame.size
    target_h = int(size * 0.94)
    scale = target_h / fh
    target_w = int(fw * scale)
    art = frame.resize((target_w, target_h), Image.LANCZOS)
    x = (size - target_w) // 2
    y = size - target_h + int(size * 0.02)
    bg.alpha_composite(art, (x, y))

    # 高光描边
    ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(ring).rounded_rectangle(
        (2 * S, 2 * S, size - 2 * S, size - 2 * S),
        radius=int(110 * S),
        outline=(150, 190, 255, 90),
        width=max(1, int(2 * S)),
    )
    bg.alpha_composite(ring)

    return bg.resize((512, 512), Image.LANCZOS)


def build_tray_icon(frame: Image.Image) -> Image.Image:
    """托盘图标：只留头部，透明底，深色任务栏上也看得清。"""
    fw, fh = frame.size
    head = frame.crop((int(fw * 0.02), 0, int(fw * 0.98), int(fh * 0.66)))
    size = 128
    target = size * 3
    scale = target / max(head.size)
    resized = head.resize((max(1, int(head.width * scale)), max(1, int(head.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (target, target), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((target - resized.width) // 2, (target - resized.height) // 2))
    return canvas.resize((size, size), Image.LANCZOS).resize((32, 32), Image.LANCZOS)


def main() -> None:
    if len(sys.argv) < 2:
        print("用法：python tools/make-pet-icon.py <frame.png>")
        sys.exit(1)

    frame_path = sys.argv[1]
    frame = load_frame(frame_path)

    icon = build_app_icon(frame)
    icon.save(os.path.join(ASSETS, "icon.png"))
    icon.save(
        os.path.join(ASSETS, "icon.ico"),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    tray = build_tray_icon(frame)
    tray.save(os.path.join(ASSETS, "tray.png"))

    print("icon ->", os.path.join(ASSETS, "icon.png"))
    print("ico  ->", os.path.join(ASSETS, "icon.ico"))
    print("tray ->", os.path.join(ASSETS, "tray.png"))


if __name__ == "__main__":
    main()
