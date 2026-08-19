# PPTX 速查（每写一页前重读一次）

## ⚠️ 铁律一：不写坐标；密度和变化靠 `page.free` 拼
版式由 `pptkit.js` 负责，两条路都不用算坐标：
- **`page.free({ blocks:[…] })`** —— 一页放 **2–4 个块**自由组合（`statStrip`/`table`/`kv`/`numbers`/`callout`/`chart`/`bullets`/`cards`/`bars`/`compare`/`row`），高度由引擎按内容算。**要密度、要变化就用它。**
- **`page.cards / kpiChart / kpiBars / compare / flow / timeline / split / layers / matrix / quote`** —— 标准页的快捷配方。

**slides.js 里出现手写的 x/y 数字 = 溢出、重叠、怪换行的开始。** 用法见 [components.md](components.md)。

## ⚠️ 铁律二：密度靠"多摆几块"，不靠"把每条写长"
每张内容页 **2–3 个块 / ≥12 个信息单元**。一页一个块 = 空一半 = 廉价；
但**每块内部的文案预算一个字都不能放宽**（放宽 = 字号被收到 9pt = 更难看）。
详见 components.md「信息密度目标」。

## 起手式（每份 slides.js 都这样开头）
```javascript
const pptxgen = require("pptxgenjs");
const THEME   = require("./theme.js");
let pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
const K = require("./pptkit.js")(pres, THEME);     // ← 必须！删了就字超框
const { contentSlide, rowsOf, colsOf, featureRow, statRow, chartBlock, charts } = K;
```
> 前置：`cp <技能根>/scripts/pptkit.js ./pptkit.js`（联通线另见 unicom-template.md）

## 每页工作流（强制）
1. 重读本文 → 2. 写这一页 → 3. `node slides.js` → 4. **看体检输出**：
   - `[pptkit] ✅ 体检通过` → 调 PptxProgress，进下一页
   - `[pptkit] ⚠ …` → **先改掉再继续**，不要攒到最后
5. 全部完成 → PresentToUser

## 体检报警对照
| 报警 | 改法 |
| --- | --- |
| `文案过长(字号被迫 x→y pt)` | 精简文案（页标题≤20字/卡要点≤14字/KPI值≤5字符），或调大它的区域 |
| `越界` | 你手写坐标了 → 改用 `rowsOf/colsOf` |
| `色块交叉重叠`·`文字互相压盖` | 同一块区域喂给了两个区块 → 先 `rowsOf` 切开 |
| `文字探出卡片` | 别手搓卡片，用 `featureRow`/`bulletBlock` |
| `图层错(内容被盖成空白卡)` | 卡底必须画在内容**之前**（`K.card()` 先调） |
| `版式坍缩(第 x/y/z 页几乎一样)` | 同一种正文结构最多用两次 → 把点名的那几页换成别的区块组合 |

## PptxGenJS 硬规则
- 颜色 6 位 hex 无 `#`：`"FF0000"`
- 透明用 `transparency`，**不要**写 8 位 hex
- 项目符号用 `bullet:true`，不要打 `"•"`
- option 对象每次新建，pptxgenjs 会就地改写，**不可复用**
- 阴影 offset 必须非负
- **代码的字符串定界符**只用 ASCII 直引号 `"` / `'`（别用中文引号当定界符，会崩）
- **文案内容里要加引号强调时，只能用「」或《》**——在 `"..."` 里再写一个 ASCII `"` 会把字符串截断，
  直接 SyntaxError。写 `title: "从「能用」转向「好用」"`，**不要**写 `title: "从"能用"转向"好用""`
- `rectRadius:0` 会被当 falsy 忽略 → 想直角就用 `RECTANGLE`
- **库是 pptxgenjs，绝不要装 python-pptx**

## 图层顺序 Z-ORDER
后添加的元素盖在先添加的之上。永远 **背景 → 卡底 → 内容**。
用 pptkit 的区块就不会错；自己画时，`K.card()` 必须在文字之前。

## 文案预算
页标题≤20字（写**观点句**：结论+数字） · kicker≤14字符 · 卡标题≤8字 · 卡要点≤14字/条、≤4条 · KPI 值≤5字符、标签≤10字。
最强的 3 个数字 → `statRow`。每页 `note:` 写 1–2 句讲稿。

## 版式纪律
相邻两页不得同主区块；**同一种区块组合全篇最多用两次**（体检会查「版式坍缩」，写完自查一遍有没有两页长得一样）；
每页≥2种视觉元素；纯文字页只允许 `quoteBlock`；正文左对齐；标题下**绝不**加装饰线。
10 页的稿子请覆盖到：图表≥2页、`timeline/process/compare/matrix/layers/quote/table` 里取≥3种不同的、实景题材另见 skill.md 的用图量表。
