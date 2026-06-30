/**
 * Tests du nettoyage Latin-1 (SOUS-LOT 1.2) — `nettoyerEmojis`.
 *
 * Helvetica standard pdfkit n'a pas les glyphes Unicode étendus :
 * on vérifie que les symboles problématiques sont convertis en ASCII
 * (>=, <=, ->) ou strippés, tout en PRÉSERVANT les caractères
 * typographiques CP1252 (– — ' ' " " • … €) qui rendent correctement.
 */
import { nettoyerEmojis } from './markdown-to-pdf';

describe('nettoyerEmojis (post-processing Latin-1)', () => {
  it('convertit les opérateurs de comparaison Unicode en ASCII', () => {
    expect(nettoyerEmojis('Seuil ATTENTION ≥ 5 %')).toBe(
      'Seuil ATTENTION >= 5 %',
    );
    expect(nettoyerEmojis('Coef ≤ 65 %')).toBe('Coef <= 65 %');
  });

  it('convertit les flèches en ASCII', () => {
    expect(nettoyerEmojis('2027-01 → 2027-03')).toBe('2027-01 -> 2027-03');
    expect(nettoyerEmojis('retour ← source')).toBe('retour <- source');
  });

  it('remplace les emojis de niveau par leur badge texte', () => {
    expect(nettoyerEmojis('🔴 Compte 7029')).toBe('[CRITIQUE] Compte 7029');
    expect(nettoyerEmojis('🟡 Vigilance')).toBe('[ATTENTION] Vigilance');
    expect(nettoyerEmojis('⚠️ Alerte')).toBe('[!] Alerte');
    expect(nettoyerEmojis('✅ Conforme')).toBe('[OK] Conforme');
  });

  it('strippe les barres de progression et box-drawing', () => {
    expect(nettoyerEmojis('Avancement ████▒▒▒▒')).toBe('Avancement ');
    expect(nettoyerEmojis('┌──────┐')).toBe('');
  });

  it('strippe les emojis décoratifs résiduels non mappés', () => {
    expect(nettoyerEmojis('Objectif 🎯 atteint 🚀')).toBe('Objectif  atteint ');
  });

  it('PRÉSERVE les caractères typographiques CP1252 (rendus OK en WinAnsi)', () => {
    const ok = 'Coût : 1 000 € — l’écart « important » • détail… –10 %';
    expect(nettoyerEmojis(ok)).toBe(ok);
  });

  it('ne laisse aucun symbole étendu problématique après nettoyage', () => {
    const sale = '## Synthèse 🔴\n\n> Écart ≥ 10 % → action ████';
    const propre = nettoyerEmojis(sale);
    expect(propre).not.toMatch(/[≥≤→←█▒░🔴]/u);
    // La structure markdown (##, >) et le texte restent intacts.
    expect(propre).toContain('## Synthèse [CRITIQUE]');
    expect(propre).toContain('> Écart >= 10 % -> action');
  });
});
