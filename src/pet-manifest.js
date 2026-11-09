/**
 * 大肥鱼桌宠动画清单（自动生成，请勿手改）
 * 来源：https://github.com/PC2005-cloud/dsh-pet  CC BY-NC-SA 4.0
 * 总数：96 个，合计 45.62 MB
 */

/** 七档基础情绪 → 动画 id。 */
export const PET_MOODS = {
  "sleep": "a092",
  "slouch": "a056",
  "soulless": "a049",
  "reviving": "a055",
  "hopeful": "a079",
  "sprint": "a060",
  "celebrate": "a074"
};

/** 其余动画，按 tag 归类：click / sleep / work / money / eat / festival / dance / move / play / misc */
export const PET_ACTIONS = [
  { id: 'a001', name: '三球抛接', tag: 'play' },
  { id: 'a002', name: '下五子棋', tag: 'play' },
  { id: 'a003', name: '东张西望', tag: 'play' },
  { id: 'a004', name: '中秋赏月吃月饼', tag: 'festival' },
  { id: 'a005', name: '优雅女仆舞', tag: 'dance' },
  { id: 'a006', name: '余额-分文不剩', tag: 'money' },
  { id: 'a007', name: '余额-数金皱眉', tag: 'money' },
  { id: 'a008', name: '余额-袋空如洗', tag: 'money' },
  { id: 'a009', name: '余额-金袋叮当', tag: 'money' },
  { id: 'a010', name: '余额-钱袋如常', tag: 'money' },
  { id: 'a011', name: '余额-钱袋满溢', tag: 'money' },
  { id: 'a012', name: '侧身急躁跑', tag: 'move' },
  { id: 'a013', name: '偷吃零食被抓住', tag: 'misc' },
  { id: 'a014', name: '写代码', tag: 'play' },
  { id: 'a015', name: '写福字', tag: 'festival' },
  { id: 'a016', name: '凭空生花', tag: 'play' },
  { id: 'a017', name: '动物环绕', tag: 'play' },
  { id: 'a018', name: '原地专心玩魔方', tag: 'move' },
  { id: 'a019', name: '原地小憩沉眠', tag: 'sleep' },
  { id: 'a020', name: '原地左转奔跑', tag: 'move' },
  { id: 'a021', name: '原地敲击桌面互动', tag: 'move' },
  { id: 'a022', name: '原地漂浮踏步', tag: 'move' },
  { id: 'a023', name: '原地跳跃抓碎头顶物品', tag: 'move' },
  { id: 'a024', name: '原地蹲下玩玩具汽车', tag: 'move' },
  { id: 'a025', name: '原地重力下蹲压缩', tag: 'move' },
  { id: 'a026', name: '变鸽子', tag: 'play' },
  { id: 'a027', name: '可爱宅舞', tag: 'dance' },
  { id: 'a028', name: '吃Token', tag: 'eat' },
  { id: 'a029', name: '吃冰淇淋融化', tag: 'eat' },
  { id: 'a030', name: '吃午餐', tag: 'eat' },
  { id: 'a031', name: '吃大闸蟹', tag: 'eat' },
  { id: 'a032', name: '吃年糕', tag: 'eat' },
  { id: 'a033', name: '吃早餐', tag: 'eat' },
  { id: 'a034', name: '吃晚餐', tag: 'eat' },
  { id: 'a035', name: '吃汤圆', tag: 'eat' },
  { id: 'a036', name: '吃白饭', tag: 'eat' },
  { id: 'a037', name: '吃粽子', tag: 'eat' },
  { id: 'a038', name: '吃糖葫芦', tag: 'eat' },
  { id: 'a039', name: '吃腊八粥', tag: 'eat' },
  { id: 'a040', name: '吃西瓜', tag: 'eat' },
  { id: 'a041', name: '吃重阳糕', tag: 'eat' },
  { id: 'a042', name: '吃长寿面', tag: 'eat' },
  { id: 'a043', name: '吃青团', tag: 'eat' },
  { id: 'a044', name: '吃饭·碗饭', tag: 'eat' },
  { id: 'a045', name: '吃饭团', tag: 'eat' },
  { id: 'a046', name: '吃饺子', tag: 'eat' },
  { id: 'a047', name: '吹气球', tag: 'play' },
  { id: 'a048', name: '吹笛子', tag: 'play' },
  { id: 'a049', name: '哈欠连天', tag: 'play' },
  { id: 'a050', name: '堆雪人', tag: 'festival' },
  { id: 'a051', name: '大口吃零食', tag: 'misc' },
  { id: 'a052', name: '女仆屈膝礼仪', tag: 'dance' },
  { id: 'a053', name: '小幅度原地360度旋转展示', tag: 'dance' },
  { id: 'a054', name: '小提琴演奏', tag: 'play' },
  { id: 'a055', name: '工作状态-原地踱步张望', tag: 'work' },
  { id: 'a056', name: '工作状态-垂头叹气冒汗', tag: 'work' },
  { id: 'a057', name: '工作状态-忙碌点按', tag: 'work' },
  { id: 'a058', name: '工作状态-思考冒泡', tag: 'work' },
  { id: 'a059', name: '工作状态-清点归档', tag: 'work' },
  { id: 'a060', name: '工作状态-雀跃庆祝', tag: 'work' },
  { id: 'a061', name: '开心小跑', tag: 'move' },
  { id: 'a062', name: '待机呼吸休闲', tag: 'misc' },
  { id: 'a063', name: '悠闲哼歌', tag: 'play' },
  { id: 'a064', name: '扑克魔术', tag: 'play' },
  { id: 'a065', name: '打瞌睡被惊醒', tag: 'sleep' },
  { id: 'a066', name: '抽陀螺', tag: 'play' },
  { id: 'a067', name: '拆礼物', tag: 'festival' },
  { id: 'a068', name: '插茱萸赏菊', tag: 'festival' },
  { id: 'a069', name: '摇扇纳凉', tag: 'play' },
  { id: 'a070', name: '撸猫', tag: 'play' },
  { id: 'a071', name: '收红包', tag: 'festival' },
  { id: 'a072', name: '放孔明灯', tag: 'festival' },
  { id: 'a073', name: '放河灯', tag: 'festival' },
  { id: 'a074', name: '放烟花', tag: 'festival' },
  { id: 'a075', name: '放风筝', tag: 'festival' },
  { id: 'a076', name: '整体换装试色', tag: 'play' },
  { id: 'a077', name: '是啊，吃什么', tag: 'eat' },
  { id: 'a078', name: '晨间刷牙', tag: 'play' },
  { id: 'a079', name: '期待开饭', tag: 'eat' },
  { id: 'a080', name: '涮火锅', tag: 'eat' },
  { id: 'a081', name: '深度思考碎碎念', tag: 'play' },
  { id: 'a082', name: '点击回应-傲娇生气', tag: 'click' },
  { id: 'a083', name: '点击回应-元气挥手', tag: 'click' },
  { id: 'a084', name: '点击回应-害羞惊讶', tag: 'click' },
  { id: 'a085', name: '点击回应-开心跃动', tag: 'click' },
  { id: 'a086', name: '点击回应-挠痒咯咯笑', tag: 'click' },
  { id: 'a087', name: '照镜子', tag: 'play' },
  { id: 'a088', name: '玩水枪', tag: 'play' },
  { id: 'a089', name: '玩游戏气急败坏', tag: 'play' },
  { id: 'a090', name: '用鲸鱼尾巴拍打地面', tag: 'move' },
  { id: 'a091', name: '睡觉-开始', tag: 'sleep' },
  { id: 'a092', name: '睡觉-循环', tag: 'sleep' },
  { id: 'a093', name: '睡觉-起来', tag: 'sleep' },
  { id: 'a094', name: '碎碎念-发呆碎碎念', tag: 'play' },
  { id: 'a095', name: '碎碎念-对屏碎碎念', tag: 'play' },
  { id: 'a096', name: '碎碎念-擦桌碎碎念', tag: 'play' },
];

/** 素材目录（相对 src/index.html）。 */
export const PET_BASE = '../assets/pet/all/';

/**
 * 跑步彩蛋用到的动画常量（下班跑出桌面彩蛋，手动维护）。
 * 说明：全部素材统一为 10.042s / 241 帧 @24fps 的长动画，且不严格无缝循环。
 * - side: 侧身朝向（a012 是唯一干净的“侧身向前跑”，朝右；向左跑用 CSS 镜像翻转）。
 * - cadenceBob: 该动画里身体上下起伏的大致周期（毫秒），用于给窗口叠加与步频同步的竖向小颠。
 * - baseRate: 自然播放速率；跑得越快时由主进程按位移速度微调 playbackRate 让腿“捣腾”更凶。
 * 数值是基于逐帧观察的近似值，用于“观感耦合”，不追求像素级机械对齐。
 */
export const RUNNER_ANIM = {
  run: {
    clip: 'a012', // 侧身急躁跑（源素材朝左！）
    facesRight: false, // 源素材朝向：左（face 在左，头发/尾巴拖向右）
    cadenceBobMs: 320, // 身体起伏周期 ~0.32s
    baseRate: 1.0, // 自然速度
    maxRate: 1.35, // 冲刺腿上限（越快步频越快）
  },
  // 收尾/过渡用的表演动画
  hop: 'a023', // 原地跳跃抓碎头顶物品
  celebrate: 'a074', // 放烟花（撒花）
  wave: 'a083', // 点击回应-元气挥手（告别）
  spin: 'a053', // 原地 360 度旋转（急停转身）
};

