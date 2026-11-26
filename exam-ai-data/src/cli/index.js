#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from '../utils/config-loader.js';
import { createLogger } from '../utils/logger.js';
import { runScan } from '../discovery/source-scanner.js';
import { analyzeMarkdownStructures } from '../discovery/structure-analyzer.js';
import { runParse } from '../ingestion/parse-runner.js';
import { runImageIndexing } from '../extractors/image-indexer.js';
import { runNormalization } from '../normalization/normalizer-runner.js';
import { runDeduplication } from '../deduplication/deduplicator.js';
import { runValidation } from '../validation/validator.js';
import { runDatasetClassification } from '../dataset-builder/multimodal-builder.js';
import { runSftBuild } from '../dataset-builder/sft-builder.js';
import { runDatasetAndSftValidation } from '../dataset-builder/dataset-validator.js';
import { runEvaluationBuild } from '../evaluation/evaluation-builder.js';
import { runEvaluationValidation } from '../evaluation/evaluation-validator.js';
import fs from 'node:fs/promises';
import { resolveProjectPath } from '../utils/path-resolver.js';

const log = createLogger('cli');
const program = new Command();

async function getSourceRoot(optSource) {
  if (optSource) return optSource;
  const cfg = await loadConfig('source');
  return cfg.default_source;
}

function addCommonOptions(cmd) {
  return cmd
    .option('--source <path>', 'Path to source xingcezhenti repository')
    .option('--year <year>', 'Filter by year', (v) => parseInt(v, 10))
    .option('--module <module>', 'Filter by module ID')
    .option('--paper <paperId>', 'Filter by paper ID')
    .option('--limit <n>', 'Limit number of files', (v) => parseInt(v, 10))
    .option('--concurrency <n>', 'Worker concurrency', (v) => parseInt(v, 10), 8)
    .option('--resume', 'Resume incrementally using manifests', false)
    .option('--force', 'Force full reprocessing', false)
    .option('--dry-run', 'Run without writing output files', false);
}

program
  .name('exam-ai-data')
  .description('Civil Service Exam (行测) Markdown & Image Data Pipeline')
  .version('1.0.0', '--cli-version');

addCommonOptions(program.command('scan').description('Scan source repository and generate inventory')).action(
  async (opts) => {
    const sourceRoot = await getSourceRoot(opts.source);
    const res = await runScan({ sourceRoot, concurrency: opts.concurrency, writeReports: !opts.dryRun });
    console.log(JSON.stringify(res.summary, null, 2));
  }
);

addCommonOptions(program.command('analyze').description('Analyze Markdown AST structures')).action(
  async (opts) => {
    const sourceRoot = await getSourceRoot(opts.source);
    await analyzeMarkdownStructures({ sourceRoot });
    console.log('Generated reports/markdown_format_analysis.md');
  }
);

addCommonOptions(program.command('parse').description('Parse Markdown files into structured JSONL')).action(
  async (opts) => {
    const sourceRoot = await getSourceRoot(opts.source);
    const stats = await runParse({
      sourceRoot,
      year: opts.year,
      module: opts.module,
      paper: opts.paper,
      limitFiles: opts.limit,
      concurrency: opts.concurrency,
      resume: opts.resume,
      force: opts.force,
      dryRun: opts.dryRun,
    });
    console.log(JSON.stringify(stats, null, 2));
  }
);

addCommonOptions(program.command('images').description('Index, hash, and normalize images')).action(
  async (opts) => {
    const sourceRoot = await getSourceRoot(opts.source);
    const stats = await runImageIndexing({
      sourceRoot,
      concurrency: opts.concurrency,
      dryRun: opts.dryRun,
    });
    console.log(JSON.stringify(stats, null, 2));
  }
);

addCommonOptions(program.command('normalize').description('Normalize parsed papers, materials, and questions')).action(
  async (opts) => {
    const stats = await runNormalization({ dryRun: opts.dryRun });
    console.log(JSON.stringify(stats, null, 2));
  }
);

addCommonOptions(program.command('deduplicate').description('Detect duplicate questions and images')).action(
  async (opts) => {
    const stats = await runDeduplication({ dryRun: opts.dryRun });
    console.log(JSON.stringify(stats, null, 2));
  }
);

addCommonOptions(program.command('validate').description('Validate normalized dataset against JSON Schemas and rules')).action(
  async (opts) => {
    const summary = await runValidation({ dryRun: opts.dryRun });
    console.log(JSON.stringify(summary, null, 2));
  }
);

addCommonOptions(program.command('pipeline').description('Run full 8-stage pipeline end-to-end')).action(
  async (opts) => {
    const sourceRoot = await getSourceRoot(opts.source);
    log.info({ sourceRoot }, 'Running full pipeline');

    const scanRes = await runScan({ sourceRoot, concurrency: opts.concurrency, writeReports: !opts.dryRun });
    await analyzeMarkdownStructures({ sourceRoot });
    const parseStats = await runParse({
      sourceRoot,
      year: opts.year,
      module: opts.module,
      paper: opts.paper,
      limitFiles: opts.limit,
      concurrency: opts.concurrency,
      resume: opts.resume,
      force: opts.force,
      dryRun: opts.dryRun,
    });
    const imgStats = await runImageIndexing({
      sourceRoot,
      concurrency: opts.concurrency,
      dryRun: opts.dryRun,
    });
    const normStats = await runNormalization({ dryRun: opts.dryRun });
    const dedupStats = await runDeduplication({ dryRun: opts.dryRun });
    const valSummary = await runValidation({ dryRun: opts.dryRun });

    console.log(
      JSON.stringify(
        {
          scan: scanRes.summary,
          parse: parseStats,
          images: imgStats,
          normalize: normStats,
          deduplicate: dedupStats,
          validate: valSummary,
        },
        null,
        2
      )
    );
  }
);

program
  .command('dataset:classify')
  .description('Classify normalized questions into text-only, multimodal, and review datasets')
  .option('--limit <n>', 'Limit number of questions', (v) => parseInt(v, 10))
  .option('--dry-run', 'Preview classification without writing files', false)
  .action(async (opts) => {
    const res = await runDatasetClassification({
      targetType: 'all',
      limit: opts.limit,
      dryRun: opts.dryRun,
    });
    console.log(JSON.stringify(res, null, 2));
  });

program
  .command('dataset:build')
  .description('Build classified dataset subset (text-only or multimodal)')
  .option('--type <type>', 'Dataset type: text-only, multimodal, or all', 'text-only')
  .option('--limit <n>', 'Limit number of questions', (v) => parseInt(v, 10))
  .option('--dry-run', 'Preview without writing files', false)
  .action(async (opts) => {
    const res = await runDatasetClassification({
      targetType: opts.type,
      limit: opts.limit,
      dryRun: opts.dryRun,
    });
    console.log(JSON.stringify(res, null, 2));
  });

program
  .command('training:build')
  .description('Build text-only SFT training datasets (answer, explanation, or all)')
  .option('--type <type>', 'Task type: answer, explanation, or all', 'all')
  .option('--dry-run', 'Preview without writing files', false)
  .action(async (opts) => {
    const stats = await runSftBuild({
      taskType: opts.type,
      dryRun: opts.dryRun,
    });
    console.log(JSON.stringify(stats, null, 2));
  });

program
  .command('training:validate')
  .description('Validate classified datasets, SFT JSONL files, and check for data leakage')
  .option('--dry-run', 'Run validation without writing report file', false)
  .action(async (opts) => {
    const report = await runDatasetAndSftValidation({ dryRun: opts.dryRun });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'PASS') {
      process.exitCode = 1;
    }
  });

program
  .command('training:report')
  .description('Print text-only training dataset statistics report')
  .action(async () => {
    const statsPath = resolveProjectPath('data', 'training', 'text-only', 'dataset_statistics.json');
    const raw = await fs.readFile(statsPath, 'utf8');
    console.log(raw);
  });

program
  .command('evaluation:build')
  .description('Build isolated baseline evaluation dataset from unused text-only papers')
  .option('--type <type>', 'Dataset type (text-only)', 'text-only')
  .option('--version <version>', 'Evaluation dataset version', 'baseline-v1')
  .option('--target-size <n>', 'Target question count', (v) => parseInt(v, 10))
  .option('--seed <n>', 'Deterministic RNG seed', (v) => parseInt(v, 10))
  .option('--dry-run', 'Preview sampling without writing files', false)
  .action(async (opts) => {
    const res = await runEvaluationBuild({
      version: opts.version,
      targetSize: opts.targetSize,
      seed: opts.seed,
      dryRun: opts.dryRun,
    });
    console.log(JSON.stringify(res, null, 2));
  });

program
  .command('evaluation:validate')
  .description('Validate baseline evaluation dataset for isolation, completeness, and answer leakage')
  .option('--version <version>', 'Evaluation dataset version', 'baseline-v1')
  .option('--dry-run', 'Run validation without writing report', false)
  .action(async (opts) => {
    const report = await runEvaluationValidation({
      version: opts.version,
      dryRun: opts.dryRun,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'PASS') {
      process.exitCode = 1;
    }
  });

program
  .command('evaluation:report')
  .description('Print baseline evaluation dataset statistics')
  .option('--version <version>', 'Evaluation dataset version', 'baseline-v1')
  .action(async (opts) => {
    const statsPath = resolveProjectPath('data', 'evaluation', 'text-only', opts.version, 'statistics.json');
    const raw = await fs.readFile(statsPath, 'utf8');
    console.log(raw);
  });

program.parseAsync(process.argv).catch((err) => {
  log.error({ err: err.message, stack: err.stack }, 'CLI execution failed');
  process.exit(1);
});
