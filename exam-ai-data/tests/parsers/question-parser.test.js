import { describe, it, expect } from 'vitest';
import { extractFileEntities } from '../../src/extractors/file-extractor.js';

const SAMPLE_POLITICAL = `---
类型: "真题"
试卷: "2026年国家公务员录用考试《行测》题（地市级网友回忆版）"
地区: "国考"
年份: "2026"
模块: "政治理论"
题数: "2"
---

# 2026年国家公务员录用考试《行测》题（地市级网友回忆版）

## 第 1 题　<sub>qid 19526238 · 新思想</sub>

关于坚持自信自立，下列表述正确的有几项？
①走自己的路
②坚持独立自主

- **A**. 1项
- **B**. 2项　✅
- **C**. 3项
- **D**. 4项

**答案**：B

**官方解析**

本题考查理论与政策。
A项错误，B项正确。故正确答案为B。

---

## 第 2 题　<sub>qid 19526244 · 多选测试</sub>

下列哪些属于重点任务？

- **A**. 任务一
- **B**. 任务二
- **C**. 任务三
- **D**. 任务四
- **E**. 任务五

**答案**：ABDE

**官方解析**

A、B、D、E四项均正确。
`;

const SAMPLE_DATA_ANALYSIS = `---
类型: "真题"
试卷: "2024年云南公务员录用考试《行测》题（网友回忆版）"
地区: "云南"
年份: "2024"
模块: "资料分析"
题数: "2"
---

# 2024年云南公务员录用考试《行测》题（网友回忆版）

## 材料 1

<p>2022年中国锂电池出货量658GWh，同比增长101.1%。</p><p><img width="634px" height="198px" src="../90-图片/题目图/18e479bcafe3608.png" /></p>

### 第 1 题　<sub>qid 10204493 · 增长</sub>

以下指标中同比增速最快的是：

- **A**. 2021年储能锂电池出货量　✅
- **B**. 2021年动力锂电池出货量
- **C**. 2022年储能锂电池出货量
- **D**. 2022年动力锂电池出货量

**答案**：A

**官方解析**

<p>根据公式：增长率<img flag="tex" src="../90-图片/公式图/formula-9ad7a88fa1bfefd7.png" />。</p>

---

### 第 2 题　<sub>qid 10204494 · 综合</sub>

以下柱状图中，最能准确反映变化趋势的是：

- **A**. <p><img width="250px" height="140px" src="../90-图片/题目图/a.png" /></p>
- **B**. <p><img width="250px" height="140px" src="../90-图片/题目图/b.png" /></p>　✅
- **C**. <p><img width="250px" height="140px" src="../90-图片/题目图/c.png" /></p>
- **D**. <p><img width="250px" height="140px" src="../90-图片/题目图/d.png" /></p>

**答案**：（缺）

**官方解析**

略。
`;

describe('Markdown AST Parser & Extractors', () => {
  it('parses standard and multi-select (>4 options) questions accurately', () => {
    const res = extractFileEntities({
      sourceRoot: 'D:/java/data/xingcezhenti-main',
      relPath: '01-政治理论/2026年国考.md',
      rawText: SAMPLE_POLITICAL,
    });

    expect(res.paper.year).toBe(2026);
    expect(res.paper.exam_type).toBe('national');
    expect(res.paper.modules).toContain('political_theory');
    expect(res.questions).toHaveLength(2);

    const q1 = res.questions[0];
    expect(q1.source_qid).toBe('19526238');
    expect(q1.official_answer).toBe('B');
    expect(Object.keys(q1.options)).toEqual(['A', 'B', 'C', 'D']);
    expect(q1.options.B).toBe('2项');

    const q2 = res.questions[1];
    expect(Object.keys(q2.options)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(q2.official_answer).toBe('ABDE');
  });

  it('links data_analysis material_id without duplicating material into questions and handles missing answers', () => {
    const res = extractFileEntities({
      sourceRoot: 'D:/java/data/xingcezhenti-main',
      relPath: '06-资料分析/2024年云南.md',
      rawText: SAMPLE_DATA_ANALYSIS,
    });

    expect(res.paper.exam_type).toBe('provincial');
    expect(res.paper.province).toBe('云南');
    expect(res.materials).toHaveLength(1);
    expect(res.materials[0].content).toContain('658GWh');
    expect(res.materials[0].content).toContain('101.1%');
    expect(res.materials[0].images).toHaveLength(1);

    expect(res.questions).toHaveLength(2);
    expect(res.questions[0].material_id).toBe(res.materials[0].material_id);
    expect(res.questions[1].material_id).toBe(res.materials[0].material_id);
    expect(res.questions[0].stem).not.toContain('658GWh');

    // Formula image in explanation
    const formulaRefs = res.imageRefs.filter((r) => r.image_type === 'formula_image');
    expect(formulaRefs).toHaveLength(1);

    // Option images & missing answer （缺） -> falls back to checkmark B if present, or null
    const optRefs = res.imageRefs.filter((r) => r.image_type === 'option_image');
    expect(optRefs).toHaveLength(4);
    expect(res.questions[1].official_answer).toBe('B');
  });
});
