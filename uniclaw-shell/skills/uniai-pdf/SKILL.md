---
name: uniai-pdf
description: "对 PDF 做任何操作：读取/抽取文字与表格、合并、拆分、旋转、加水印、新建 PDF、填写 PDF 表单、加密解密、抽取图片、扫描件 OCR。Use whenever the user mentions a .pdf file or wants to produce/read/edit one. 触发词：PDF、生成PDF、导出PDF、合并PDF、拆分PDF、PDF转文字、提取表格、填表单、扫描件识别、加水印、PDF加密。"
license: Proprietary. LICENSE.txt has complete terms
metadata:
  OpenAgent: "📄"
  runtime: '{"os":["linux","darwin","win32"],"bins":[]}'
---

# PDF Processing Guide

对 PDF 做真实的读写处理（本技能会**实际执行代码生成文件**，不只是给参考）。基础库为纯 Python（`pypdf` / `pdfplumber` / `reportlab`），跨 Linux(Pro) 与 Windows(Lite) 均可运行；命令行工具（poppler / qpdf / pdftk / tesseract）在 Linux 沙箱通常可用，在 Windows host 可能缺失——**缺失时一律走纯 Python 路径**。

安装依赖（优先 uv）：
```bash
uv pip install pypdf pdfplumber reportlab || python -m pip install pypdf pdfplumber reportlab
```

进阶用法（pypdfium2、JS 的 pdf-lib、排障）见 `reference.md`；**填写 PDF 表单先读 `forms.md` 并按其步骤执行**。

## ⚠️ 中文 PDF 必读：注册 CJK 字体

reportlab 内置字体**不含中文字形**，直接写中文会变成空白/黑框。生成含中文的 PDF 前，先注册一个 CJK 字体：

```python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))   # reportlab 自带的中文 CID 字体，无需外部文件
# 之后在样式里用 fontName='STSong-Light'
```
若要更好看的字重/字形，注册系统 TTF：`pdfmetrics.registerFont(TTFont('YaHei', 'C:/Windows/Fonts/msyh.ttc'))`（Windows）或 Noto Sans SC（Linux）。表格/Paragraph 样式都要显式指定该 `fontName`。**同样别用 Unicode 上下标字符**（₀₁₂/⁰¹²）——内置字体缺这些字形会渲染成黑块，改用 `<sub>`/`<super>` 标签。

## Quick Start

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("document.pdf")
print(f"Pages: {len(reader.pages)}")
text = "".join(page.extract_text() for page in reader.pages)
```

## Python 库

### pypdf — 基础操作

**合并**
```python
from pypdf import PdfWriter, PdfReader
writer = PdfWriter()
for pdf_file in ["doc1.pdf", "doc2.pdf", "doc3.pdf"]:
    for page in PdfReader(pdf_file).pages:
        writer.add_page(page)
with open("merged.pdf", "wb") as f:
    writer.write(f)
```

**拆分**
```python
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter(); writer.add_page(page)
    with open(f"page_{i+1}.pdf", "wb") as f:
        writer.write(f)
```

**元数据 / 旋转 / 加密**
```python
meta = PdfReader("document.pdf").metadata           # meta.title / meta.author ...
page.rotate(90)                                      # 顺时针 90°
writer.encrypt("userpassword", "ownerpassword")      # 加密
```

### pdfplumber — 抽取文字与表格

```python
import pdfplumber, pandas as pd
with pdfplumber.open("document.pdf") as pdf:
    for i, page in enumerate(pdf.pages):
        text = page.extract_text()
        for j, table in enumerate(page.extract_tables()):
            df = pd.DataFrame(table[1:], columns=table[0])
            df.to_excel(f"table_p{i+1}_{j+1}.xlsx", index=False)
```

### reportlab — 创建 PDF

```python
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
styles = getSampleStyleSheet()
for s in styles.byName.values():          # 让所有样式默认用中文字体
    s.fontName = 'STSong-Light'

doc = SimpleDocTemplate("report.pdf", pagesize=A4)
story = [Paragraph("报告标题", styles['Title']), Spacer(1, 12),
         Paragraph("这是正文内容。" * 20, styles['Normal']), PageBreak(),
         Paragraph("第二页", styles['Heading1'])]
doc.build(story)
```

## 命令行工具（Linux 沙箱通常可用；Windows 缺失就用上面的纯 Python 等价实现）

```bash
pdftotext -layout input.pdf output.txt        # poppler：保留版式抽文字
qpdf --empty --pages a.pdf b.pdf -- merged.pdf # 合并
qpdf input.pdf --pages . 1-5 -- pages.pdf       # 拆分
qpdf --password=pw --decrypt in.pdf out.pdf     # 去密码
pdfimages -j input.pdf prefix                   # 抽取图片
```

## 常见任务

**扫描件 OCR**（需要 tesseract；中文识别装 `chi_sim` 语言包）
```python
# uv pip install pytesseract pdf2image
import pytesseract
from pdf2image import convert_from_path
text = ""
for i, img in enumerate(convert_from_path('scanned.pdf')):
    text += f"Page {i+1}:\n" + pytesseract.image_to_string(img, lang='chi_sim+eng') + "\n\n"
```
> Windows(Lite) 若无 tesseract/poppler，可改用 UniAI 工具箱里的 OCR 能力，或提示用户本机识别。

**加水印**
```python
from pypdf import PdfReader, PdfWriter
wm = PdfReader("watermark.pdf").pages[0]
reader, writer = PdfReader("document.pdf"), PdfWriter()
for page in reader.pages:
    page.merge_page(wm); writer.add_page(page)
with open("watermarked.pdf", "wb") as f:
    writer.write(f)
```

## Quick Reference

| 任务 | 首选工具 | 说明 |
|------|---------|------|
| 合并 | pypdf | `writer.add_page(page)` |
| 拆分 | pypdf | 每页一个文件 |
| 抽文字 | pdfplumber | `page.extract_text()` |
| 抽表格 | pdfplumber | `page.extract_tables()` |
| 新建 | reportlab | 含中文先注册 CID 字体 |
| OCR | pytesseract | 先转图片，中文用 `chi_sim` |
| 填表单 | pypdf / pdf-lib | 见 `forms.md` |

## 交付前自检
1. 文件大小非 0（0 字节=失败）
2. 打开确认页数正确
3. 中文/字体正常渲染，无黑框、无缺字
4. 输出写入 workspace，文件名语义化

## Next Steps
- 进阶（pypdfium2、pdf-lib、排障）→ `reference.md`
- 填 PDF 表单 → `forms.md`
