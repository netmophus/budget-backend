/**
 * Test sanity (Lot 4.4) — vérifie que la documentation Lot 4 ne
 * contient pas de placeholders Handlebars laissés (ex : "{{nom}}")
 * et que les liens internes pointent vers des fichiers existants.
 *
 * Détecte les régressions doc lors d'un copier-coller de template
 * oublié ou d'un renommage de fichier sans mise à jour des liens.
 *
 * Le test vit dans src/ pour être picked up par jest (rootDir=src),
 * et résout les chemins via process.cwd() (= racine repo backend
 * lors d'un `npm test`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const DOCS_DIR = resolve(process.cwd(), 'docs', 'lot-4');
const FICHIERS = [
  'README.md',
  'recette.md',
  'sequences.md',
  '4.1-multi-perimetres.md',
  '4.2-delegations.md',
  '4.3-notifications-email.md',
];

function lireDoc(rel: string): string {
  return readFileSync(join(DOCS_DIR, rel), 'utf-8');
}

describe('Doc Lot 4 — sanity check (Lot 4.4)', () => {
  for (const fichier of FICHIERS) {
    describe(`docs/lot-4/${fichier}`, () => {
      let contenu: string;
      beforeAll(() => {
        contenu = lireDoc(fichier);
      });

      it('ne contient pas de placeholder Handlebars laissé ({{xxx}})', () => {
        // On EXCLUT les blocs de code (entre ``` ```) qui peuvent
        // contenir {{var}} légitime à des fins de documentation.
        const sansBlocsCode = contenu.split(/```[\s\S]*?```/g).join('');
        const sansBlocsInline = sansBlocsCode.replace(/`[^`\n]+`/g, '');
        const placeholders = sansBlocsInline.match(/\{\{[^}]+\}\}/g);
        expect(placeholders).toBeNull();
      });

      it('ses liens internes [text](./xxx.md) pointent vers des fichiers existants', () => {
        const regex = /\[[^\]]+\]\((\.\.?\/[^)#]+\.md)(#[^)]+)?\)/g;
        const liens = [...contenu.matchAll(regex)].map((m) => m[1]!);
        const baseDir = dirname(join(DOCS_DIR, fichier));
        for (const lien of liens) {
          const cible = isAbsolute(lien) ? lien : resolve(baseDir, lien);
          expect({ lien, existe: existsSync(cible) }).toEqual({
            lien,
            existe: true,
          });
        }
      });
    });
  }

  it('recette.md contient bien la grille de suivi vide (chantier 4.4.C)', () => {
    const contenu = lireDoc('recette.md');
    expect(contenu).toContain("Suivi d'exécution");
    expect(contenu).toContain('| **R1**');
    expect(contenu).toContain('| **R7.B**');
    // Statut initial = ⬜ partout sur les 8 lignes
    const lignesGrille = contenu
      .split('\n')
      .filter((l) => /^\| \*\*R\d/.test(l));
    expect(lignesGrille.length).toBeGreaterThanOrEqual(8);
    for (const ligne of lignesGrille) {
      expect(ligne).toContain('⬜');
    }
  });
});
