/**
 * Service générique d'import CSV — streaming + validation Zod.
 *
 * Lit le fichier en streaming (pas de chargement complet en mémoire),
 * valide chaque ligne contre un schéma Zod, et délègue l'insertion à
 * un callback `onRow` fourni par l'appelant.
 *
 * Les erreurs ne stoppent pas l'import par défaut : le rapport final
 * liste toutes les lignes invalides + lignes ayant échoué à
 * l'insertion. Pour un comportement strict (rollback immédiat), passer
 * `stopOnFirstError: true` et gérer la transaction côté appelant.
 *
 * Note : Zod est volontairement limité à la validation CSV. Pour les
 * DTO HTTP, le projet utilise `class-validator` (cohérent avec le
 * ValidationPipe global NestJS).
 */
import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse';
import { createReadStream } from 'node:fs';
import { ZodSchema } from 'zod';

export interface CsvImportOptions<T> {
  filePath: string;
  schema: ZodSchema<T>;
  onRow: (row: T, lineNo: number) => Promise<void>;
  stopOnFirstError?: boolean;
  /** Délimiteur (défaut `,`). Utiliser `;` pour les exports Excel FR. */
  delimiter?: string;
}

export interface CsvImportError {
  lineNo: number;
  error: string;
  rawRow?: Record<string, string>;
}

export interface CsvImportReport {
  totalLines: number;
  importedLines: number;
  errors: CsvImportError[];
}

@Injectable()
export class CsvImportService {
  async import<T>(opts: CsvImportOptions<T>): Promise<CsvImportReport> {
    const errors: CsvImportError[] = [];
    let totalLines = 0;
    let importedLines = 0;
    let lineNo = 1; // ligne 1 = entête

    const parser = createReadStream(opts.filePath).pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        delimiter: opts.delimiter ?? ',',
      }),
    );

    for await (const rawRow of parser as AsyncIterable<
      Record<string, string>
    >) {
      lineNo++;
      totalLines++;

      const result = opts.schema.safeParse(rawRow);
      if (!result.success) {
        errors.push({
          lineNo,
          error: result.error.issues
            .map((i) => `${i.path.join('.') || '<row>'}: ${i.message}`)
            .join('; '),
          rawRow,
        });
        if (opts.stopOnFirstError) break;
        continue;
      }

      try {
        await opts.onRow(result.data, lineNo);
        importedLines++;
      } catch (e) {
        errors.push({
          lineNo,
          error: e instanceof Error ? e.message : String(e),
          rawRow,
        });
        if (opts.stopOnFirstError) break;
      }
    }

    return { totalLines, importedLines, errors };
  }
}
