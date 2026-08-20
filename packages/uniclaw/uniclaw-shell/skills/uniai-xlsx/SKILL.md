---
name: uniai-xlsx
description: "创建、读取、编辑、修复 Excel/CSV 文件——加列、算公式、格式化、做图表、清洗脏数据、建财务模型、格式互转。Use whenever a spreadsheet (.xlsx/.xlsm/.xls/.csv/.tsv) is the primary input or output, especially when formulas, formatting, dates, types, or template fidelity matter. 触发词：Excel、表格、xlsx、csv、报表、公式、数据透视、财务模型、清洗数据、加一列、算合计、透视表、导出表格。Do NOT trigger when the deliverable is a Word doc, HTML report, or standalone script."
license: Proprietary. LICENSE.txt has complete terms
metadata:
  OpenAgent: "📊"
  runtime: '{"os":["linux","darwin","win32"],"bins":[]}'
---

# Excel / 电子表格

一句话选型：**分析、重塑、CSV 类任务用 `pandas`；要保留公式、样式、多表、合并单元格、模板保真用 `openpyxl`。** CSV 只是数据交换格式，不是 Excel 的功能全集。

安装：`uv pip install openpyxl pandas || python -m pip install openpyxl pandas`

## 交付硬要求

- **派生值一律写公式，禁止硬编码（第一优先级，最容易被违反）**：凡是"算出来的"值——合计、平均、占比、差额、环比、毛利、毛利率……——**必须写成 Excel 公式**（`sheet['B10']='=SUM(B2:B9)'`、`'=(C4-C2)/C2'`、`'=B2*C2'`），**绝不允许在 Python 里算好再把结果写进单元格**。哪怕只有一行合计，也要写公式。数字列要设 `number_format`（金额 `'#,##0'`、百分比 `'0.0%'`）。逐个自检：交付前扫一遍，任何一个"本该是公式却是数字"的派生单元格都算不合格。
- **零公式错误**：交付的每个工作簿必须 0 个 `#REF! / #DIV/0! / #VALUE! / #N/A / #NAME?`，别把已知错误留给用户。
- **字体**：中文交付默认用「微软雅黑 / 宋体」等中文字体（不要清一色 Arial 导致中文串码）；除非用户或既有模板另有约定。
- **保留既有模板**：改别人的文件时，**精确沿用**其格式、样式、列宽、冻结、筛选、打印区域、数据验证、条件格式——既有模板约定永远高于本文的通用建议，别强行套一套"标准格式"。

## 三个不同的工作（别用惯性做题）

读值、保住一个"活"工作簿、从零建模型——是三种不同的活。开工前先想清楚是哪一种。

### 数据分析（pandas）
```python
import pandas as pd
df = pd.read_excel('file.xlsx')                       # 默认首个 sheet
all_sheets = pd.read_excel('file.xlsx', sheet_name=None)   # 全部 sheet -> dict
df.head(); df.info(); df.describe()
df.to_excel('output.xlsx', index=False)
```
读取要点：显式指定类型避免推断出错 `pd.read_excel(..., dtype={'id': str})`；大文件只读需要的列 `usecols=[...]`；日期 `parse_dates=[...]`。

### 新建 / 编辑（openpyxl，保公式与格式）
```python
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment

wb = Workbook(); s = wb.active
s['A1'] = '合计'; s['A1'].font = Font(bold=True, color='FF0000')
s['B10'] = '=SUM(B2:B9)'                               # 写公式，别在 Python 里算好再硬写
s.column_dimensions['A'].width = 16
wb.save('output.xlsx')

wb = load_workbook('existing.xlsx'); s = wb['Sheet1']  # 编辑：保留原公式与样式
s.insert_rows(2); s.delete_cols(3)
wb.save('modified.xlsx')
```

## 核心规则

### 1. 该让 Excel 算的，就写公式，别硬编码
派生值（合计、占比、增长率、差值……）一律写成 Excel 公式，让表格保持"活的"、能随源数据重算。
```python
# ❌ total = df['Sales'].sum(); s['B10'] = total     # 硬编码 5000，源数据一改就错
# ✅ s['B10'] = '=SUM(B2:B9)'
# ✅ s['C5'] = '=(C4-C2)/C2'                          # 增长率
```
假设值（增长率、利润率、倍数）放**独立的假设单元格**，公式里用引用不用魔法数：`=B5*(1+$B$6)` 而不是 `=B5*1.05`。

### 2. 日期是"带遗留坑的序列号"
Excel 把日期存成序列号不是真日期对象；1900 日期系统含"假闰日"bug，有些簿用 1904 系统；时间是"一天的小数"。日期算对了还不够——数字格式没设对，用户看到的仍是错的。

### 3. 在 Excel 毁掉数据类型之前先保护它
长编号、手机号、邮编、带前导零的值——通常要**存成文本**。Excel 会静默截断超过 15 位的数字精度；科学计数法、被自动解析成日期、前导零被吃掉，都是**数据损坏**不是显示问题。

### 4. 数字格式（财务/报表）
- 年份：存成文本 `"2024"`（不要 `2,024`）
- 金额：`$#,##0` 或 `#,##0`，表头标单位（"收入（万元）"）
- 零显示为 `-`：`"#,##0;(#,##0);-"`
- 百分比：默认 `0.0%`（一位小数）
- 负数：用括号 `(123)` 不用 `-123`

### 5. 财务模型配色（行业惯例，除非用户/模板另有约定）
- **蓝字 (0,0,255)**：硬编码输入、用户会改的情景假设
- **黑字 (0,0,0)**：所有公式与计算
- **绿字 (0,128,0)**：同簿内跨表引用
- **红字 (255,0,0)**：外部文件引用
- **黄底 (255,255,0)**：需关注的关键假设
硬编码值旁边用批注注明来源：`来源：公司年报 FY2024, P45, 收入附注`。

## 美观硬规则（报表颜值——模板未约定时的默认，违反任一条 = 返工）

- **一个强调色锁（按业务气质五选一，全簿锁定）**：藏青 `1F4E79`（政企/通用首选）｜墨绿 `1E5C40`（金融审计）｜青碧 `0F766E`（科技数据）｜赭石 `9A3412`（消费文教）｜深灰 `404040`（极简中性）；配套浅底（汇总行/分组行用）依次 `EAF1F8 / E8F2EC / E5F2F0 / FAEEE7 / F2F2F2`。**别每个 sheet 换一套色，别整表撒荧光色**；强调色只落在表头、汇总行、关键单元格（视觉占比 ≤10%）。
- **字号与行高匹配**：正文 10-11pt 配行高 18-22；表头 11pt 加粗配行高 22-26；报表标题 14-16pt。正文字色用墨 `1F2937` 别纯黑；汇总行加粗 + 浅底而不是换个颜色。层级缩进用 `Alignment(indent=1/2)`，**禁用空格顶位**。
- **表头行**：深色底 + 白字加粗 + 居中；数据区从第 2 行起就 `freeze_panes = 'A2'`（多级表头冻结到表头下一行）。
- **边框纪律**：内部细浅灰（`D9D9D9` thin）或干脆只留"表头下框线 + 隔行浅灰底 `F2F2F2`"；**禁全黑粗网格**（默认网格观感最廉价）。
- **对齐**：文本左、数字右、日期右或居中、表头统一居中。**数字列左对齐 = 不合格**。
- **列宽**：按内容估宽（中文字符约 2 倍宽），不裁字、不留大片空白；长文本 `wrap_text=True` + 垂直顶端对齐。
- **标题区**：报表首行放标题（14-16pt 加粗）+ 副题/日期（灰字小号），与数据区空 1 行；合并居中只用于标题区，**数据区禁滥用合并单元格**（毁排序/筛选）。
- **条件格式点到为止**：占比/进度列用数据条，涨跌用双色（涨跌红绿遵循场景惯例：国内金融=红涨绿跌，一般业务=绿好红坏，先看用户语境，全簿统一）；**别整表铺色阶**。
- **图表**：配色与表头强调色同系；加数据标签、砍冗余图例/网格线；放数据区右侧或独立 sheet，**不压数据**。
- **打印视角**：横竖向、打印区域、`print_title_rows` 重复表头都设好——想象 A4 打出来是否体面。

**别手写这些样式——用 `scripts/xlsx_helpers.py`：**

```python
import sys; sys.path.insert(0, '<skill_dir>/scripts')
from xlsx_helpers import *

wb = Workbook(); ws = wb.active
add_title(ws, '2026 年上半年收入分析', '数据来源：公司财报', span=3)
h, f, l = write_table(ws, ['业务线','收入（万元）','占比'], rows, start_row=3)
tr = add_total_row(ws, f, l, cols='B')                 # 合计行写公式，不写算好的数
style_table(ws, header_row=h, first_row=f, last_row=l, total_row=tr,
            money_cols='B', percent_cols='C', theme='navy')   # 着色+格式+对齐+边框+冻结+斑马
autofit_columns(ws)                                    # 中文按 2 倍宽估，跳过标题合并格
```

> **为什么不要照着"`isinstance(c.value, (int,float))` 就右对齐"那种片段写**：
> 公式单元格的值是字符串 `'=SUM(B2:B9)'`，`isinstance` 为**假**——整个合计行不会被右对齐，
> 而本技能自己写着"数字列左对齐 = 不合格"。`style_table` 是**按列**判定的，不按单元格类型。
> 这个坑是实测出来的，别再踩。

财务模型配色也有对应函数：`mark_input(cell, note='来源：年报 P45')`（蓝字+批注）、
`mark_formula(cell)`（黑字）、`mark_link(cell, external=True)`（红字）。

## 重算公式（用了公式就必须做）

openpyxl 写入的公式**只是字符串、没有计算结果**。用 `scripts/recalc.py` 触发重算并扫描错误：

```bash
python scripts/recalc.py output.xlsx [timeout_seconds]
```

脚本依赖 **LibreOffice**（`soffice`，三平台常见安装位置都会找，也认 `SOFFICE_BIN` 环境变量），
首次运行自动装宏，扫描全表错误，返回 JSON：

```json
{"status":"success","total_errors":0,"total_formulas":42,"recalculated":true}
```

四种 `status` 各自怎么处理：

| status | 含义 | 怎么办 |
|---|---|---|
| `success` | 算过了，零错误 | 可以交付 |
| `errors_found` | 算过了，有 `#REF!` 之类 | 按 `error_summary` 的 locations 定位修复，再重算 |
| `not_recalculated` | soffice 跑了但公式没有缓存值 | **别当成零错误**，按下面的兜底说明处理 |
| `no_soffice` | 本机没装 LibreOffice | 走兜底，退出码 1，`fallback` 字段里有原话 |

> **跨平台兜底**：没有 LibreOffice 时（Lite 的 Windows host 常见），`recalc.py`
> **不会崩，会返回 `{"status":"no_soffice", "fallback": ...}`**。两条路二选一：
> ① 交付文件并说明"用 Excel/WPS 打开会自动重算"，同时确保公式本身正确；
> ② 结果值必须内嵌时，在 Python 侧算好写成静态值，并注明这是静态快照。
> **不要假装重算成功了。**

## 交付闸门

```bash
python scripts/check_xlsx.py out/report.xlsx      # 规则自检，有 ERROR 就是返工
python scripts/recalc.py     out/report.xlsx      # 公式重算 + 错误扫描
```

`check_xlsx.py` 只依赖 openpyxl，任何环境都能跑，查的是：**派生值被硬编码成数字**、
公式错误、裸表头、**数字列左对齐**（含公式单元格）、没设数字格式、没冻结、
中文用西文字体、列宽裁字、数据区滥用合并单元格、强调色不止一个。
它**不能**替代 `recalc.py`——公式算不算得出来只有真算一遍才知道。

改完这个技能跑 `python scripts/selftest.py`（不依赖 LibreOffice）。

## 编辑模式的致命陷阱
- `load_workbook(..., data_only=True)` 读的是**缓存值**；用它读完再 `save`，会把公式**永久替换成静态值**、毁掉活模型。要保公式就别用 `data_only=True` 保存。
- 缓存值可能是陈旧的，编辑后别盲信。
- 复制公式要检查相对/绝对引用（`$`）——一个错的区间会顺着填充铺满整块，即使"看起来还能算"。

## 交付前检查
- [ ] `check_xlsx.py` 无 ERROR（WARN 逐条确认过）
- [ ] `recalc.py` 的 `status` 是 `success`；不是的话已按上表处理并**如实告知用户**
- [ ] 2–3 个样本引用先验证取值正确，再整块铺开
- [ ] 无 `#REF!/#DIV/0!/#VALUE!/#NAME?`，无意外循环引用
- [ ] 隐藏行列/命名区域/数据验证/条件格式/打印区域未被误删
- [ ] 中文字体正常、列宽不裁字、换行单元格已 `wrap_text`
- [ ] 输出写入 workspace，文件名语义化

## 代码风格
生成的 Python 力求精简、少注释、少无谓 print；但**Excel 文件本身**要给复杂公式、关键假设、硬编码来源加单元格批注。

## 生成代码的语法自检（防嵌套括号错误）

f-string 里嵌套 `len(set(...))`、`len([x for x in ...])` 等多层括号时，**每层括号必须成对匹配**。常见错误：

```python
# ❌ 多了一个 ) —— set(...) 的 ) 和 len(...) 的 ) 之间多了一个
print(f'Unique sectors: {len(set(r[0] for r in data)))}')
#                                                 ↑ 多余的 )

# ✅ 正确：set 一个 )，len 一个 )，f-string 一个 }
print(f'Unique sectors: {len(set(r[0] for r in data))}')
```

**自检方法**：生成代码后，从最内层往外逐层配对括号——每层一个右括号/花括号，不多不少。如果用了 `pylanceSyntaxErrors` 或 `pylanceFileSyntaxErrors` 工具，在写入文件前先跑一遍语法检查。
