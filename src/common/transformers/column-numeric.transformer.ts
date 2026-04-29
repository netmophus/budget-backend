import { ValueTransformer } from 'typeorm';

/**
 * Transformer pour les colonnes `numeric(p,s)` PostgreSQL → `number`
 * côté TypeScript.
 *
 * Sans transformer, TypeORM retourne les `numeric` en `string` (pour
 * préserver la précision arbitraire de PostgreSQL). Côté API et
 * service métier, on veut manipuler des `number` JS — ce transformer
 * convertit à la lecture (`from`) et laisse passer à l'écriture (`to`).
 *
 * **Limitation connue** : `Number` JS perd la précision au-delà de
 * 15-16 chiffres significatifs. Pour les montants budgétaires
 * (numeric(20,4) = 16 chiffres entiers max + 4 décimales), c'est OK
 * tant que les montants restent inférieurs à 1e15 FCFA (= 1 000 000
 * milliards). Au-delà, basculer en `bigint` ou utiliser
 * `decimal.js` côté service.
 */
export const ColumnNumericTransformer: ValueTransformer = {
  to(value: number | null | undefined): number | null | undefined {
    return value;
  },
  from(value: string | null | undefined): number | null | undefined {
    if (value === null || value === undefined) return value;
    return parseFloat(value);
  },
};
