import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { CsvImportService } from './csv-import.service';

const rowSchema = z.object({
  code: z.string().min(1),
  libelle: z.string().min(1),
  montant: z.string().regex(/^\d+(\.\d+)?$/),
});

type Row = z.infer<typeof rowSchema>;

describe('CsvImportService', () => {
  let service: CsvImportService;
  let tmpDir: string;

  beforeAll(() => {
    service = new CsvImportService();
    tmpDir = mkdtempSync(join(tmpdir(), 'csv-import-test-'));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeCsv(name: string, lines: string[]): string {
    const path = join(tmpDir, name);
    writeFileSync(path, lines.join('\n'), 'utf-8');
    return path;
  }

  it('imports 5 valid rows nominally', async () => {
    const path = writeCsv('nominal.csv', [
      'code,libelle,montant',
      'A,Alpha,100',
      'B,Bravo,200',
      'C,Charlie,300',
      'D,Delta,400',
      'E,Echo,500',
    ]);

    const collected: Row[] = [];
    const report = await service.import<Row>({
      filePath: path,
      schema: rowSchema,
      onRow: async (row) => {
        collected.push(row);
      },
    });

    expect(report).toEqual({ totalLines: 5, importedLines: 5, errors: [] });
    expect(collected).toHaveLength(5);
    expect(collected.map((r) => r.code)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('reports validation errors with their line numbers and continues', async () => {
    const path = writeCsv('mixed.csv', [
      'code,libelle,montant',
      'A,Alpha,100', //   line 2 - valid
      ',Bravo,200', //    line 3 - invalid (empty code)
      'C,Charlie,300', // line 4 - valid
      'D,,400', //        line 5 - invalid (empty libelle)
      'E,Echo,500', //    line 6 - valid
    ]);

    const collected: Row[] = [];
    const report = await service.import<Row>({
      filePath: path,
      schema: rowSchema,
      onRow: async (row) => {
        collected.push(row);
      },
    });

    expect(report.totalLines).toBe(5);
    expect(report.importedLines).toBe(3);
    expect(report.errors).toHaveLength(2);
    expect(report.errors.map((e) => e.lineNo).sort()).toEqual([3, 5]);
    expect(collected.map((r) => r.code)).toEqual(['A', 'C', 'E']);
  });

  it('returns an empty report when the CSV has only the header', async () => {
    const path = writeCsv('empty.csv', ['code,libelle,montant']);

    const onRow = jest.fn(async () => undefined);
    const report = await service.import<Row>({
      filePath: path,
      schema: rowSchema,
      onRow,
    });

    expect(report).toEqual({ totalLines: 0, importedLines: 0, errors: [] });
    expect(onRow).not.toHaveBeenCalled();
  });

  it('stops on the first error in strict mode', async () => {
    const path = writeCsv('strict.csv', [
      'code,libelle,montant',
      'A,Alpha,100', //  line 2 - valid
      ',Bravo,200', //   line 3 - invalid → stop here
      'C,Charlie,300', //line 4 - never reached
      ',Delta,400', //   line 5 - never reached
    ]);

    const collected: Row[] = [];
    const report = await service.import<Row>({
      filePath: path,
      schema: rowSchema,
      stopOnFirstError: true,
      onRow: async (row) => {
        collected.push(row);
      },
    });

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]!.lineNo).toBe(3);
    expect(report.importedLines).toBe(1);
    expect(collected).toHaveLength(1);
  });

  it('captures async onRow errors with the correct lineNo and continues (non-strict)', async () => {
    const path = writeCsv('onrow-throw.csv', [
      'code,libelle,montant',
      'A,Alpha,100',
      'B,Bravo,200',
      'C,Charlie,300',
    ]);

    const onRow = jest.fn(async (row: Row, _lineNo: number) => {
      if (row.code === 'B') {
        throw new Error('insert failed for B');
      }
    });

    const report = await service.import<Row>({
      filePath: path,
      schema: rowSchema,
      onRow,
    });

    expect(report.totalLines).toBe(3);
    expect(report.importedLines).toBe(2);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]!.lineNo).toBe(3); // header=1, A=2, B=3
    expect(report.errors[0]!.error).toBe('insert failed for B');
    expect(onRow).toHaveBeenCalledTimes(3);
  });

  /**
   * Note : la version courante de `CsvImportService` n'a pas d'option
   * `batchSize` — chaque ligne validée déclenche un `onRow` indépendant.
   * On vérifie donc l'invariant équivalent : nombre d'appels `onRow` =
   * nombre de lignes ayant passé la validation Zod (1 appel = 1 ligne
   * validée). Le batching pourra être ajouté en Lot 5 si l'usage l'exige.
   */
  it('calls onRow exactly once per validated row', async () => {
    const path = writeCsv('count.csv', [
      'code,libelle,montant',
      'A,Alpha,100',
      ',Bravo,200', // invalid → no onRow call
      'C,Charlie,300',
      'D,Delta,400',
    ]);

    const onRow = jest.fn(async () => undefined);
    await service.import<Row>({
      filePath: path,
      schema: rowSchema,
      onRow,
    });

    expect(onRow).toHaveBeenCalledTimes(3);
  });
});
