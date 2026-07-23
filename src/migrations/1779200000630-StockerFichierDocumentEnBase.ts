import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stockage du PDF des documents officiels DANS la base (colonne `bytea`)
 * au lieu du disque local.
 *
 * Motivation : les plateformes PaaS (Heroku, Render, Vercel) ont un
 * système de fichiers ÉPHÉMÈRE — un PDF écrit sur disque disparaît au
 * prochain redémarrage du dyno. Le stocker en base le rend persistant
 * et capturé par les sauvegardes Postgres (cohérence document +
 * métadonnée dans le même instantané — utile pour l'archivage BCEAO).
 *
 * Migration PUREMENT ADDITIVE :
 *  - `fichier_contenu` bytea      : les octets du PDF.
 *  - `fichier_taille`  integer    : taille en octets (affichage/audit
 *    sans charger le blob).
 *  - `fichier_mime`    varchar    : type MIME (toujours application/pdf
 *    aujourd'hui, gardé générique).
 *
 * `fichier_joint_nom` reste l'indicateur « le document a un fichier » et
 * le nom d'origine pour le téléchargement. `fichier_joint_path` (chemin
 * disque) devient vestigial : conservé pour ne pas casser
 * editer-document.dto / document-workflow.service, mais plus alimenté
 * par l'upload. Les lignes créées AVANT cette migration (contenu sur
 * disque, non migré) verront `fichier_contenu` = NULL : le service
 * renvoie alors un 404 explicite invitant à ré-uploader.
 */
export class StockerFichierDocumentEnBase1779200000630 implements MigrationInterface {
  name = 'StockerFichierDocumentEnBase1779200000630';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "document_officiel"
        ADD COLUMN IF NOT EXISTS "fichier_contenu" bytea,
        ADD COLUMN IF NOT EXISTS "fichier_taille" integer,
        ADD COLUMN IF NOT EXISTS "fichier_mime" varchar(100)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "document_officiel"
        DROP COLUMN IF EXISTS "fichier_mime",
        DROP COLUMN IF EXISTS "fichier_taille",
        DROP COLUMN IF EXISTS "fichier_contenu"
    `);
  }
}
