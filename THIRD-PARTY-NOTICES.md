# 第三方素材声明

## 大肥鱼（蓝鲸娘）桌宠动画

- **来源仓库**：<https://github.com/PC2005-cloud/dsh-pet>
- **使用文件**：`assets/pet/all/*.webm` —— **该仓库全部 96 个动画**，约 45.6 MB。文件按 `a001`…`a096` 重命名，中文原名与分类记录在 `src/pet-manifest.js`（由 `tools/fetch-pet-assets.mjs` 自动生成）。
- **调度方式**：7 个作为基础情绪循环；其余分别用于随机摸鱼小动作、整点彩蛋、工资里程碑（「余额」系列）和点击回应。
- **许可协议**：**CC BY-NC-SA 4.0**（署名 · 非商业性使用 · 相同方式共享）
  <https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans>
- **角色说明**：角色为社区创作的 DeepSeek「大肥鱼」（蓝鲸娘），**非 DeepSeek 官方形象**；原仓库标注原型出自 B 站创作者，版权归原作者所有。
- **本项目使用范围**：个人、非商业用途的桌面小工具。若你要将其用于商业产品或对外分发售卖，**必须先获得原作者授权**，或改用本仓库 `src/mascot.js` 中的原创 SVG 大肥鱼（通过修改 `src/app.js` 的一行 import 即可切换，无第三方素材依赖）。

## 原创部分

- `src/mascot.js` / `src/mascot.css`：原创 SVG 蓝色胖鱼与 7 档情绪动效，本项目自行绘制，无第三方素材。
- `assets/icon.png`、`assets/icon.ico`、`assets/tray.png`：由 `tools/make-icons.py` 用 Pillow 绘制。
- 其余代码（Electron 外壳、计算内核、界面）均为本项目原创。

## 若二次分发

按 CC BY-NC-SA 4.0 的「相同方式共享」条款，包含这些动画的衍生作品需以相同协议发布，并保留本声明与署名。
