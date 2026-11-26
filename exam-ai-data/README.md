# exam-ai-data

公务员行测真题数据解析、清洗与标准化工程（Node.js 20+ ES Modules，无 Python 依赖）。

将 Obsidian Markdown 与本地图片组织的国考、省考行测真题仓库，转换为结构化、可追溯、可验证的 JSONL 数据集（`papers.jsonl`、`materials.jsonl`、`questions.jsonl`、`images.jsonl`），用于后续模型微调数据准备。

## 目录结构

- `configs/`: 各阶段 YAML 配置文件（`source.yaml`, `parser.yaml`, `normalization.yaml`, `deduplication.yaml`, `validation.yaml`）
- `schemas/`: 四大核心实体 JSON Schema（`paper`, `material`, `question`, `image`）
- `src/discovery/`: 原始仓库扫描与 Markdown AST 结构分析
- `src/parsers/`: 基于 `unified` / `remark-parse` / `remark-gfm` 的 AST 解析器
- `src/extractors/`: 试卷、材料、题目、图片实体提取与图片索引器
- `src/normalization/`: 文本、选项与实体标准化（保留数学符号、百分号、单位、否定词）
- `src/deduplication/`: 四层重复检测（ID、精确题干、分桶 n-gram 相似题、图片 SHA256）
- `src/validation/`: JSON Schema 与结构一致性验证（PASS / REVIEW / REJECT）
- `src/cli/`: 统一命令行入口

## 常用命令

```bash
npm install
npm test

# 1. 扫描原始仓库
npm run scan -- --source D:/java/data/xingcezhenti-main

# 2. 分析 Markdown AST 结构
npm run analyze -- --source D:/java/data/xingcezhenti-main

# 3. 解析题目（支持 --year, --module, --limit, --resume, --force, --dry-run）
npm run parse -- --source D:/java/data/xingcezhenti-main

# 4. 建立图片索引与 SHA256 标准化副本
npm run images -- --source D:/java/data/xingcezhenti-main

# 5. 数据标准化
npm run normalize

# 6. 重复题与重复图片检测
npm run deduplicate

# 7. 数据质量验证
npm run validate

# 8. 一键运行全流程
npm run pipeline -- --source D:/java/data/xingcezhenti-main

# 9. 训练数据集分类（text-only / multimodal / review）
npm run cli -- dataset:classify --dry-run
npm run cli -- dataset:classify
npm run cli -- dataset:build --type text-only

# 10. 构建纯文本 SFT 训练数据（ChatML messages 格式）
npm run cli -- training:build --type answer
npm run cli -- training:build --type explanation
npm run cli -- training:build --type all

# 11. 验证数据集与数据泄漏检查
npm run cli -- training:validate
npm run cli -- training:report

# 12. 构建与验证独立 Baseline 测试集（与训练集/验证集严格隔离）
npm run cli -- evaluation:build --type text-only --dry-run
npm run cli -- evaluation:build --type text-only --version baseline-v1 --target-size 2000
npm run cli -- evaluation:validate --version baseline-v1
npm run cli -- evaluation:report --version baseline-v1
```

---

## Baseline Evaluation Dataset（独立基准测试集）

- **核心原则**：以完整 `paper_id` 为隔离单位，严格排除 SFT `train` 与 `validation` 所用试卷，并排除与训练集/验证集存在 `material_id` 或 `duplicate_questions.csv` 重复关联的试卷，确保零训练集泄漏与零答案泄漏。
- **输出目录 (`data/evaluation/text-only/baseline-v1/`)**：
  - `questions.jsonl`：仅包含模型推理所需字段（`question_id`、`module`、`year`、`exam_type`、`province`、`question_type`、`material_id`、`material`、`stem`、`options`），不含答案、解析、图片路径或正确选项标记。
  - `answer-key.jsonl`：独立存放标准答案与官方解析，仅用于离线评分，严禁传入模型。
  - `manifest.json` / `statistics.json` / `quality-report.json`：抽样清单、模块/年份/地区统计与隔离泄漏验证报告。
- **评估结果目录 (`data/evaluation/text-only/baseline-results/`)**：用于存放 Qwen 基座模型与 LoRA 微调后模型的推理预测与对比评分结果。


---

## Dataset Builder（训练数据集构建模块）

### 目录结构

- `configs/dataset.yaml` / `configs/training.yaml`：分类规则、Prompt 模板、划分比例与随机种子配置
- `src/dataset-builder/`：
  - `dataset-classifier.js`：纯文本 vs 多模态 vs 待人工审核判定
  - `text-only-builder.js` / `multimodal-builder.js`：分类结果流式导出至 `data/datasets/{text-only,multimodal,review}/`
  - `conversation-builder.js`：Qwen 兼容 ChatML `messages` 组装（含资料分析材料拼接）
  - `dataset-splitter.js`：基于并查集 + 固定种子的 `paper_id` / `material_id` / 重复题分组划分（默认 80/10/10）
  - `sft-builder.js`：生成 `data/training/text-only/sft/{answer,explanation}/{train,validation,test}.jsonl`
  - `dataset-validator.js`：分类一致性、SFT 格式与跨集合数据泄漏检查

### 分类规则

- **text-only**：题干、选项、关联材料均完整且不依赖任何图片（无题干图、选项图、材料图、公式图），支持包含纯文本材料的资料分析与篇章阅读。
- **multimodal**：图形推理题，或题干/选项/材料/解析中任一环节依赖图片或公式渲染图（`<img flag="tex">`）。
- **review**：缺少答案、空选项（如无选项文本的判断题 `- （选项）[]`）、题干掩码残缺（`****`）或关联图片缺失。

### 接入后续训练与多模态扩展

- **Qwen LoRA/QLoRA 微调**：可直接加载 `data/training/text-only/sft/answer/{train,validation,test}.jsonl` 与 `explanation/{train,validation,test}.jsonl`（标准 `messages` + `metadata` 格式，兼容 LlamaFactory / Swift / Axolotl）。
- **多模态扩展**：`data/datasets/multimodal/` 已完整保留 `questions.jsonl`、`materials.jsonl` 与 `image_manifest.jsonl`（含 SHA-256 与标准化路径），后续可直接对接 Qwen-VL / 多模态训练格式转换。

