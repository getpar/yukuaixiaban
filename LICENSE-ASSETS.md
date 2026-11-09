# 素材许可证 · Asset License

本文件说明仓库中**素材类文件**的授权，与根目录 [LICENSE](LICENSE)（覆盖源代码的 MIT 许可证）相互独立。

## 1. 桌宠动画 `assets/pet/all/*.webm`

- **内容**：96 个大肥鱼（蓝鲸娘）透明动画，约 45.6 MB。
- **来源**：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)
- **许可证**：**CC BY-NC-SA 4.0** — 署名 · 非商业性使用 · 相同方式共享
  <https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans>
- **你可以**：在个人、学习、非商业项目中自由使用、修改、分享，但必须：
  1. **署名**：注明来源仓库与原作者；
  2. **非商业**：不得用于商业目的、对外售卖或商业分发；
  3. **相同方式共享**：基于这些动画的衍生作品须以 CC BY-NC-SA 4.0 发布。
- **角色说明**：角色为社区创作的 DeepSeek「大肥鱼」（蓝鲸娘），**非 DeepSeek 官方形象**；
  原仓库标注原型出自 B 站创作者，版权归原作者所有。

> 若你要**商业使用**，请先联系原素材作者获得授权，或改用本仓库 `src/mascot.js` /
> `src/mascot.css` 中的**原创 SVG 大肥鱼**（由本项目自行绘制，属于 MIT 覆盖范围，可商用）。
> 切换方式：把 `src/app.js` 顶部的 `import * as MascotModule from './pet.js'` 改为 `'./mascot.js'`。

## 2. 本项目自绘素材（MIT）

以下文件由本项目原创，属于 [LICENSE](LICENSE) 的 MIT 覆盖范围，可自由商用：

- `src/mascot.js` / `src/mascot.css` — 原创 SVG 蓝色胖鱼与情绪动效
- `assets/icon.png` / `assets/icon.ico` / `assets/tray.png` — 程序图标（`tools/make-icons.py` 绘制）

## 3. 第三方依赖

运行时/开发依赖（Electron、electron-builder 等）遵循各自许可证，见 `node_modules/*/LICENSE`。
本项目不分发这些依赖的源码。

---

完整署名与来源记录另见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
