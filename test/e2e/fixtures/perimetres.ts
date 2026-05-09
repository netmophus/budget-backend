/**
 * Fixtures e2e — affectation d'un périmètre CR à un utilisateur via
 * SQL direct (in-process), conformément à la convention "fixtures
 * pré-requis = in-process, objet du test = HTTP réel".
 *
 * Schéma user_perimetres (cf. migration 1779200000080) :
 *   fk_user, cible_type ('CR' | 'STRUCTURE' | 'GLOBAL'), cible_id,
 *   origine, actif, ...
 */
import type { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

export async function affecterPerimetreCR(
  app: INestApplication,
  userEmail: string,
  codeCr: string,
): Promise<void> {
  const ds = app.get<DataSource>(getDataSourceToken());
  await ds.query(
    `INSERT INTO user_perimetres
       (fk_user, cible_type, cible_id, origine, actif, utilisateur_creation)
     SELECT u.id, 'CR', cr.id, 'PRINCIPAL', true, 'system (e2e fixture)'
     FROM "user" u, dim_centre_responsabilite cr
     WHERE u.email = $1
       AND cr.code_cr = $2
       AND cr.version_courante = true
       AND NOT EXISTS (
         SELECT 1 FROM user_perimetres up
         WHERE up.fk_user = u.id
           AND up.cible_id = cr.id
           AND up.actif = true
       )`,
    [userEmail, codeCr],
  );
}
