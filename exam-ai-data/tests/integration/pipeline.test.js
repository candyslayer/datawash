import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import Ajv from 'ajv';
import { resolveProjectPath } from '../../src/utils/path-resolver.js';
import { extractFileEntities } from '../../src/extractors/file-extractor.js';

describe('Schema & Integration Check', () => {
  it('validates extracted entities against JSON Schemas', async () => {
    const ajv = new Ajv();
    const paperSchema = JSON.parse(await fs.readFile(resolveProjectPath('schemas/paper.schema.json'), 'utf8'));
    const matSchema = JSON.parse(await fs.readFile(resolveProjectPath('schemas/material.schema.json'), 'utf8'));
    const qSchema = JSON.parse(await fs.readFile(resolveProjectPath('schemas/question.schema.json'), 'utf8'));

    const validatePaper = ajv.compile(paperSchema);
    const validateMat = ajv.compile(matSchema);
    const validateQ = ajv.compile(qSchema);

    const sampleMd = `---
类型: "真题"
试卷: "2024年测试试卷"
地区: "云南"
年份: "2024"
模块: "判断推理"
题数: "1"
---
# 2024年测试试卷

## 第 1 题　<sub>qid 99999 · 图形推理</sub>

<p>请选择最合适的一项：</p><p><img src="../90-图片/题目图/test.png" /></p>

- **A**. A
- **B**. B　✅
- **C**. C
- **D**. D

**答案**：B

**官方解析**

选B。
`;

    const res = extractFileEntities({
      sourceRoot: 'D:/java/data/xingcezhenti-main',
      relPath: '05-判断推理/2024年测试试卷.md',
      rawText: sampleMd,
    });

    expect(validatePaper(res.paper)).toBe(true);
    for (const m of res.materials) expect(validateMat(m)).toBe(true);
    for (const q of res.questions) expect(validateQ(q)).toBe(true);
  });
});
