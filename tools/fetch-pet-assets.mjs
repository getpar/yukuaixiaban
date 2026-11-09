/**
 * 拉取 dsh-pet 仓库的全部 96 个透明动画，生成 src/pet-manifest.js。
 *
 * 用法：node tools/fetch-pet-assets.mjs
 * 产物：
 *   assets/pet/all/<id>.webm   96 个动画（id 为 a001…a096，避免中文文件名在打包/URL 里的坑）
 *   src/pet-manifest.js        清单（id / 原名 / 分类），运行时按需索引
 *
 * 许可：CC BY-NC-SA 4.0，详见 THIRD-PARTY-NOTICES.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(ROOT, 'assets', 'pet', 'all');
const MANIFEST = path.join(ROOT, 'src', 'pet-manifest.js');
const RAW = 'https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/dsh-pet/assets/webm/';

const NAMES = [
  '三球抛接', '下五子棋', '东张西望', '中秋赏月吃月饼', '优雅女仆舞', '余额-分文不剩', '余额-数金皱眉',
  '余额-袋空如洗', '余额-金袋叮当', '余额-钱袋如常', '余额-钱袋满溢', '侧身急躁跑', '偷吃零食被抓住',
  '写代码', '写福字', '凭空生花', '动物环绕', '原地专心玩魔方', '原地小憩沉眠', '原地左转奔跑',
  '原地敲击桌面互动', '原地漂浮踏步', '原地跳跃抓碎头顶物品', '原地蹲下玩玩具汽车', '原地重力下蹲压缩',
  '变鸽子', '可爱宅舞', '吃Token', '吃冰淇淋融化', '吃午餐', '吃大闸蟹', '吃年糕', '吃早餐', '吃晚餐',
  '吃汤圆', '吃白饭', '吃粽子', '吃糖葫芦', '吃腊八粥', '吃西瓜', '吃重阳糕', '吃长寿面', '吃青团',
  '吃饭·碗饭', '吃饭团', '吃饺子', '吹气球', '吹笛子', '哈欠连天', '堆雪人', '大口吃零食', '女仆屈膝礼仪',
  '小幅度原地360度旋转展示', '小提琴演奏', '工作状态-原地踱步张望', '工作状态-垂头叹气冒汗',
  '工作状态-忙碌点按', '工作状态-思考冒泡', '工作状态-清点归档', '工作状态-雀跃庆祝', '开心小跑',
  '待机呼吸休闲', '悠闲哼歌', '扑克魔术', '打瞌睡被惊醒', '抽陀螺', '拆礼物', '插茱萸赏菊', '摇扇纳凉',
  '撸猫', '收红包', '放孔明灯', '放河灯', '放烟花', '放风筝', '整体换装试色', '是啊，吃什么', '晨间刷牙',
  '期待开饭', '涮火锅', '深度思考碎碎念', '点击回应-傲娇生气', '点击回应-元气挥手', '点击回应-害羞惊讶',
  '点击回应-开心跃动', '点击回应-挠痒咯咯笑', '照镜子', '玩水枪', '玩游戏气急败坏', '用鲸鱼尾巴拍打地面',
  '睡觉-开始', '睡觉-循环', '睡觉-起来', '碎碎念-发呆碎碎念', '碎碎念-对屏碎碎念', '碎碎念-擦桌碎碎念',
];

/** 分类规则：先匹配先生效。tags 决定动画能出现在哪一类池子里。 */
const RULES = [
  [/^点击回应-/, 'click'],
  [/^睡觉-|打瞌睡|小憩沉眠/, 'sleep'],
  [/^工作状态-/, 'work'],
  [/^余额-/, 'money'],
  [/^吃|涮火锅|期待开饭|是啊，吃什么/, 'eat'],
  [/中秋|端午|春节|元宵|重阳|腊八|福字|河灯|孔明灯|烟花|风筝|雪人|茱萸|汤圆|粽子|月饼|年糕|青团|长寿面|饺子|红包|拆礼物/, 'festival'],
  [/舞|礼仪|旋转展示/, 'dance'],
  [/原地|侧身|小跑|尾巴拍打/, 'move'],
  [/撸猫|照镜子|水枪|变鸽子|扑克|陀螺|气球|笛子|小提琴|五子棋|三球|魔方|玩具汽车|摇扇|换装|写代码|凭空生花|动物环绕|深度思考|碎碎念|东张西望|悠闲哼歌|哈欠|晨间刷牙|玩游戏|敲击桌面|跳跃抓碎|重力下蹲|吹/, 'play'],
  [/./, 'misc'],
];

function tagOf(name) {
  for (const [re, tag] of RULES) {
    if (re.test(name)) return tag;
  }
  return 'misc';
}

function idOf(index) {
  return `a${String(index + 1).padStart(3, '0')}`;
}

async function downloadOne(name, file) {
  const url = RAW + encodeURIComponent(`${name}.webm`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf.length;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const entries = [];
  let total = 0;
  let failed = 0;

  for (let i = 0; i < NAMES.length; i += 1) {
    const name = NAMES[i];
    const id = idOf(i);
    const file = path.join(OUT_DIR, `${id}.webm`);
    const tag = tagOf(name);
    let size = 0;

    if (fs.existsSync(file) && fs.statSync(file).size > 1000) {
      size = fs.statSync(file).size;
    } else {
      try {
        size = await downloadOne(name, file);
      } catch (err) {
        failed += 1;
        console.error(`✗ ${id} ${name}: ${err.message}`);
      }
    }

    if (size > 0) total += size;
    entries.push({ id, name, tag, size });
    if ((i + 1) % 12 === 0) console.log(`下载进度 ${i + 1}/${NAMES.length}  (${(total / 1048576).toFixed(1)} MB)`);
  }

  const moods = {
    sleep: byName(entries, '睡觉-循环'),
    slouch: byName(entries, '工作状态-垂头叹气冒汗'),
    soulless: byName(entries, '哈欠连天'),
    reviving: byName(entries, '工作状态-原地踱步张望'),
    hopeful: byName(entries, '期待开饭'),
    sprint: byName(entries, '工作状态-雀跃庆祝'),
    celebrate: byName(entries, '放烟花'),
  };

  const lines = [];
  lines.push('/**');
  lines.push(' * 大肥鱼桌宠动画清单（自动生成，请勿手改）');
  lines.push(' * 来源：https://github.com/PC2005-cloud/dsh-pet  CC BY-NC-SA 4.0');
  lines.push(` * 总数：${entries.length} 个，合计 ${(total / 1048576).toFixed(2)} MB`);
  lines.push(' */');
  lines.push('');
  lines.push('/** 七档基础情绪 → 动画 id。 */');
  lines.push(`export const PET_MOODS = ${JSON.stringify(moods, null, 2)};`);
  lines.push('');
  lines.push('/** 其余动画，按 tag 归类：click / sleep / work / money / eat / festival / dance / move / play / misc */');
  lines.push('export const PET_ACTIONS = [');
  entries.forEach((e) => {
    lines.push(`  { id: '${e.id}', name: '${e.name}', tag: '${e.tag}' },`);
  });
  lines.push('];');
  lines.push('');
  lines.push('/** 素材目录（相对 src/index.html）。 */');
  lines.push("export const PET_BASE = '../assets/pet/all/';");
  lines.push('');

  fs.writeFileSync(MANIFEST, lines.join('\n'), 'utf8');

  const byTag = entries.reduce((acc, e) => {
    acc[e.tag] = (acc[e.tag] || 0) + 1;
    return acc;
  }, {});

  console.log('---');
  console.log(`完成：${entries.length} 个，失败 ${failed} 个，合计 ${(total / 1048576).toFixed(2)} MB`);
  console.log('分类：', JSON.stringify(byTag));
  console.log('情绪映射：', JSON.stringify(moods));
}

function byName(entries, name) {
  const found = entries.find((e) => e.name === name);
  return found ? found.id : entries[0].id;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
