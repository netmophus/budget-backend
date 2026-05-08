/**
 * Test sanity (Lot 5.4) — vérifie que la documentation Lot 5 ne
 * contient pas de placeholders Handlebars laissés (ex : "{{nom}}")
 * et que les liens internes pointent vers des fichiers existants.
 *
 * Inspiré du test équivalent du Lot 4
 * (`docs-lot4-sanity.spec.ts`). Détecte les régressions doc lors
 * d'un copier-coller de template oublié ou d'un renommage de
 * fichier sans mise à jour des liens.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const DOCS_DIR = resolve(process.cwd(), 'docs', 'lot-5');
const FICHIERS = [
  'README.md',
  'recette.md',
  'sequences.md',
  '5.2-tableau-bord-budget-vs-realise.md',
];

function lireDoc(rel: string): string {
  return readFileSync(join(DOCS_DIR, rel), 'utf-8');
}

describe('Doc Lot 5 — sanity check (Lot 5.4)', () => {
  for (const fichier of FICHIERS) {
    describe(`docs/lot-5/${fichier}`, () => {
      let contenu: string;
      beforeAll(() => {
        contenu = lireDoc(fichier);
      });

      it("ne contient pas de placeholder Handlebars laissé ({{xxx}})", () => {
        // Exclut les blocs de code ``` ``` (peuvent contenir
        // {{var}} légitime à fins de doc).
        const sansBlocsCode = contenu.split(/```[\s\S]*?```/g).join('');
        const sansBlocsInline = sansBlocsCode.replace(/`[^`\n]+`/g, '');
        const placeholders = sansBlocsInline.match(/\{\{[^}]+\}\}/g);
        expect(placeholders).toBeNull();
      });

      it("ses liens internes [text](./xxx.md) pointent vers des fichiers existants", () => {
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

  it("recette.md contient bien la grille de suivi vide (chantier 5.4.C)", () => {
    const contenu = lireDoc('recette.md');
    expect(contenu).toContain("Suivi d'exécution");
    expect(contenu).toContain('| **R1**');
    expect(contenu).toContain('| **R7**');
    // 7 lignes ⬜ initiales (R1 → R7)
    const lignesGrille = contenu
      .split('\n')
      .filter((l) => /^\| \*\*R\d/.test(l));
    expect(lignesGrille.length).toBe(7);
    for (const ligne of lignesGrille) {
      expect(ligne).toContain('⬜');
    }
  });

  it('README.md référence bien les sous-lots 5.1, 5.2, 5.3, 5.4', () => {
    const contenu = lireDoc('README.md');
    expect(contenu).toContain('Lot 5.1');
    expect(contenu).toContain('Lot 5.2');
    expect(contenu).toContain('Lot 5.3');
    expect(contenu).toContain('Lot 5.4');
  });

  it('sequences.md contient au moins 4 diagrammes mermaid', () => {
    const contenu = lireDoc('sequences.md');
    const matches = contenu.match(/```mermaid/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(4);
  });

  it('le compteur de tests dans le README est cohérent (1618 attendus)', () => {
    const contenu = lireDoc('README.md');
    expect(contenu).toContain('1618');
    expect(contenu).toContain('1082');
    expect(contenu).toContain('536');
  });
});
