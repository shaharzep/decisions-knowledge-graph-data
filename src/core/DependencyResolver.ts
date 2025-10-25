import {
  DependencyMatchField,
  JobDependency,
} from '../jobs/JobConfig.js';
import {
  DecisionMatchKey,
  JobResultLoader,
} from '../utils/jobResultLoader.js';
import { JobLogger } from '../utils/logger.js';

interface PreparedMatchField {
  row: string;
  dependency: string;
}

interface PreparedDependency {
  config: JobDependency;
  alias: string;
  required: boolean;
  baseDir: string;
  matchOn: PreparedMatchField[];
  cache?: Map<string, any>;
  unavailable?: boolean;
}

const DEFAULT_MATCH_FIELDS: PreparedMatchField[] = [
  { row: 'decision_id', dependency: 'decision_id' },
  { row: 'language_metadata', dependency: 'language' },
];

const SOURCE_TO_DIR: Record<string, string> = {
  batch: 'results',
  concurrent: 'concurrent/results',
};

function getByPath(source: any, path: string): any {
  if (!source || !path) return undefined;
  if (!path.includes('.')) return source[path];

  return path.split('.').reduce((current: any, key: string) => {
    if (current === undefined || current === null) return undefined;
    return current[key];
  }, source);
}

function extractRowValue(row: any, field: string): any {
  let value = getByPath(row, field);
  if (value !== undefined) return value;

  if (field === 'language_metadata') {
    value =
      getByPath(row, 'language_metadata') ??
      getByPath(row, 'language') ??
      getByPath(row, 'proceduralLanguage');
  } else if (field === 'language') {
    value =
      getByPath(row, 'language') ??
      getByPath(row, 'language_metadata') ??
      getByPath(row, 'proceduralLanguage');
  }

  return value;
}

function extractDependencyValue(record: any, field: string): any {
  let value = getByPath(record, field);
  if (value !== undefined) return value;

  if (field === 'language') {
    value =
      getByPath(record, 'language') ??
      getByPath(record, 'language_metadata') ??
      getByPath(record, 'proceduralLanguage');
  } else if (field === 'language_metadata') {
    value =
      getByPath(record, 'language_metadata') ??
      getByPath(record, 'language') ??
      getByPath(record, 'proceduralLanguage');
  }

  return value;
}

function buildKey(values: any[]): string | null {
  if (values.some((value) => value === undefined || value === null || value === '')) {
    return null;
  }
  return values.map((value) => String(value)).join('||');
}

function normalizeMatchFields(matchOn?: DependencyMatchField[]): PreparedMatchField[] {
  if (!matchOn || matchOn.length === 0) {
    return DEFAULT_MATCH_FIELDS;
  }

  return matchOn.map((field) => ({
    row: field.row,
    dependency: field.dependency ?? field.row,
  }));
}

function buildDefaultMatchKey(row: any): DecisionMatchKey | null {
  const decisionId = extractRowValue(row, 'decision_id');
  const language = extractRowValue(row, 'language_metadata');

  if (
    decisionId === undefined ||
    decisionId === null ||
    language === undefined ||
    language === null
  ) {
    return null;
  }

  return {
    decision_id: decisionId,
    language: String(language),
    id: extractRowValue(row, 'id') ?? undefined,
  };
}

export class DependencyResolver {
  private readonly logger: JobLogger;
  private readonly prepared: PreparedDependency[];

  constructor(jobId: string, dependencies: JobDependency[]) {
    this.logger = new JobLogger(`DependencyResolver:${jobId}`);
    this.prepared = dependencies.map((dependency) => ({
      config: dependency,
      alias: dependency.alias ?? dependency.jobId,
      required: dependency.required !== false,
      baseDir:
        SOURCE_TO_DIR[dependency.source ?? 'batch'] ??
        dependency.source ??
        'results',
      matchOn: normalizeMatchFields(dependency.matchOn),
    }));
  }

  async preload(): Promise<void> {
    await Promise.all(
      this.prepared.map(async (prepared) => {
        try {
          const records = await JobResultLoader.loadAllResults(
            prepared.config.jobId,
            prepared.baseDir
          );

          const map = new Map<string, any>();
          for (const record of records) {
            const keyValues = prepared.matchOn.map((field) =>
              extractDependencyValue(record, field.dependency)
            );
            const key = buildKey(keyValues);
            if (key) {
              map.set(key, record);
            } else {
              this.logger.warn('Skipping dependency record with incomplete key', {
                jobId: prepared.config.jobId,
                alias: prepared.alias,
                recordPreview: JSON.stringify(record).slice(0, 200),
              });
            }
          }

          prepared.cache = map;
          prepared.unavailable = false;

          this.logger.debug('Dependency preloaded', {
            dependency: prepared.config.jobId,
            alias: prepared.alias,
            records: map.size,
            baseDir: prepared.baseDir,
          });
        } catch (error) {
          if (prepared.required) {
            throw error;
          }

          prepared.cache = new Map();
          prepared.unavailable = true;
          this.logger.warn(
            `Optional dependency '${prepared.config.jobId}' unavailable`,
            {
              alias: prepared.alias,
              error:
                error instanceof Error ? error.message : String(error),
            }
          );
        }
      })
    );
  }

  async enrichRow(row: any): Promise<any> {
    if (this.prepared.length === 0) {
      return row;
    }

    const enriched: Record<string, any> = {};
    const missing: Array<{
      alias: string;
      jobId: string;
      reason: string;
      key?: string;
    }> = [];

    for (const prepared of this.prepared) {
      if (prepared.unavailable) {
        enriched[prepared.alias] = null;
        missing.push({
          alias: prepared.alias,
          jobId: prepared.config.jobId,
          reason: 'dependency_unavailable',
        });
        continue;
      }

      const rowValues = prepared.matchOn.map((field) =>
        extractRowValue(row, field.row)
      );
      const key = buildKey(rowValues);

      if (!key) {
        const reason =
          `missing_match_fields (${prepared.matchOn
            .map((field) => field.row)
            .join(', ')})`;
        if (prepared.required) {
          this.logger.warn(
            `Missing match fields for dependency '${prepared.config.jobId}'`,
            {
              alias: prepared.alias,
              expected: prepared.matchOn.map((field) => field.row),
            }
          );
        }
        missing.push({
          alias: prepared.alias,
          jobId: prepared.config.jobId,
          reason,
        });
        enriched[prepared.alias] = null;
        continue;
      }

      let record = prepared.cache?.get(key);

      if (!record) {
        try {
          const fallbackKey = buildDefaultMatchKey(row);
          if (fallbackKey) {
            record = await JobResultLoader.loadForDecision(
              prepared.config.jobId,
              fallbackKey,
              prepared.baseDir
            );
          }
        } catch {
          record = undefined;
        }
      }

      if (!record) {
        if (prepared.required) {
          this.logger.warn(
            `Dependency '${prepared.config.jobId}' not found for row`,
            {
              alias: prepared.alias,
              key,
              keyValues: rowValues,
            }
          );
        }
        missing.push({
          alias: prepared.alias,
          jobId: prepared.config.jobId,
          reason: 'record_not_found',
          key,
        });
        enriched[prepared.alias] = null;
        continue;
      }

      let payload = record;
      if (prepared.config.transform) {
        const transformed = await prepared.config.transform(record, {
          ...row,
          ...enriched,
        });
        if (transformed !== undefined) {
          payload = transformed;
        }
      }

      enriched[prepared.alias] = payload;
    }

    const result = {
      ...row,
      ...enriched,
    };

    if (missing.length > 0) {
      const existing = Array.isArray(row.__missingDependencies)
        ? row.__missingDependencies
        : [];
      Object.defineProperty(result, '__missingDependencies', {
        value: [...existing, ...missing],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }

    return result;
  }
}
