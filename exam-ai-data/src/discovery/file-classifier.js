import path from 'node:path';
import { toPosixPath } from '../utils/path-resolver.js';

export const MODULE_DIR_MAP = {
  '01-政治理论': 'political_theory',
  '02-常识判断': 'general_knowledge',
  '03-言语理解与表达': 'verbal_comprehension',
  '04-数量关系': 'quantitative_reasoning',
  '05-判断推理': 'logical_reasoning',
  '06-资料分析': 'data_analysis',
};

export const MODULE_CN_MAP = {
  政治理论: 'political_theory',
  常识判断: 'general_knowledge',
  言语理解与表达: 'verbal_comprehension',
  数量关系: 'quantitative_reasoning',
  判断推理: 'logical_reasoning',
  资料分析: 'data_analysis',
};

const PROVINCES = [
  '新疆兵团', '黑龙江', '内蒙古', '北京', '天津', '河北', '山西', '辽宁',
  '吉林', '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南',
  '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州', '云南',
  '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆',
];

export function classifyModuleFromPath(relPath) {
  const posix = toPosixPath(relPath);
  const topDir = posix.split('/')[0];
  return MODULE_DIR_MAP[topDir] || null;
}

export function classifyExamType(region, paperName = '') {
  const combined = `${region || ''} ${paperName || ''}`;
  if (/国考|国家公务员/.test(combined)) return 'national';
  if (/选调|市考|区考|行政执法|综合知识/.test(combined) && !/省/.test(combined)) {
    // Check if it has a province name
    for (const p of PROVINCES) {
      if (combined.includes(p)) return 'provincial';
    }
    return 'municipal';
  }
  if (region === '省考' || PROVINCES.some((p) => combined.includes(p))) {
    return 'provincial';
  }
  return 'unknown';
}

export function extractProvince(region, paperName = '') {
  if (region && PROVINCES.includes(region)) return region;
  const combined = `${region || ''} ${paperName || ''}`;
  for (const p of PROVINCES) {
    if (combined.includes(p)) return p;
  }
  return null;
}

export function isExamMarkdown(relPath, frontmatterObj) {
  const posix = toPosixPath(relPath);
  const base = path.basename(posix);
  if (base === 'README.md' || base === '蒸馏方法参考.md') return false;
  if (frontmatterObj && frontmatterObj['类型'] === '真题') return true;
  return Boolean(classifyModuleFromPath(posix));
}
