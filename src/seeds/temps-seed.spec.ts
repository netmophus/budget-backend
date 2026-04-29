import {
  generateTempsRows,
  HOLIDAYS_UMOA,
  isFerieFixe,
  isoWeek,
  isWeekend,
  libelleMois,
} from './temps-seed';

describe('temps-seed (pure functions)', () => {
  describe('libelleMois', () => {
    it('formats the French short month label', () => {
      expect(libelleMois(2026, 1)).toBe('Janv. 2026');
      expect(libelleMois(2026, 5)).toBe('Mai 2026');
      expect(libelleMois(2027, 12)).toBe('Déc. 2027');
    });
  });

  describe('isWeekend', () => {
    it('flags Saturday and Sunday', () => {
      expect(isWeekend(new Date(Date.UTC(2026, 0, 3)))).toBe(true); // Saturday
      expect(isWeekend(new Date(Date.UTC(2026, 0, 4)))).toBe(true); // Sunday
      expect(isWeekend(new Date(Date.UTC(2026, 0, 5)))).toBe(false); // Monday
    });
  });

  describe('isFerieFixe', () => {
    it('matches the 4 fixed UEMOA holidays', () => {
      expect(isFerieFixe(new Date(Date.UTC(2026, 0, 1)))).toBe(true); // 1er janv
      expect(isFerieFixe(new Date(Date.UTC(2026, 4, 1)))).toBe(true); // 1er mai
      expect(isFerieFixe(new Date(Date.UTC(2026, 7, 1)))).toBe(true); // 1er août
      expect(isFerieFixe(new Date(Date.UTC(2026, 11, 25)))).toBe(true); // 25 déc
    });

    it('returns false for non-holidays', () => {
      expect(isFerieFixe(new Date(Date.UTC(2026, 0, 2)))).toBe(false);
      expect(isFerieFixe(new Date(Date.UTC(2026, 6, 14)))).toBe(false);
    });

    it('exposes the 4 holidays in HOLIDAYS_UMOA', () => {
      expect(HOLIDAYS_UMOA).toHaveLength(4);
    });
  });

  describe('isoWeek', () => {
    it('returns 1 for the first Monday-anchored week of the year', () => {
      // 5 jan 2026 is the first Monday of 2026 → ISO week 2 actually
      // (1 jan 2026 is Thursday → week 1 spans Mon 29 dec 2025 to Sun 4 jan 2026).
      expect(isoWeek(new Date(Date.UTC(2025, 11, 29)))).toBe(1);
      expect(isoWeek(new Date(Date.UTC(2026, 0, 4)))).toBe(1);
      expect(isoWeek(new Date(Date.UTC(2026, 0, 5)))).toBe(2);
    });
  });

  describe('generateTempsRows', () => {
    it('generates 3652 rows over 10 years (2 leap years 2024 + 2028)', () => {
      const rows = generateTempsRows(2021, 2030);
      // 8 années 365j + 2 années bissextiles 2024/2028 = 3652
      expect(rows).toHaveLength(3652);
    });

    it('generates 366 rows for a leap year (2024)', () => {
      const rows = generateTempsRows(2024, 2024);
      expect(rows).toHaveLength(366);
    });

    it('generates 365 rows for a non-leap year (2026)', () => {
      const rows = generateTempsRows(2026, 2026);
      expect(rows).toHaveLength(365);
    });

    it('marks 1er mai 2026 (Friday) as not a working day (Labour Day)', () => {
      const rows = generateTempsRows(2026, 2026);
      const day = rows.find((r) => r.date === '2026-05-01');
      expect(day).toBeDefined();
      expect(day!.jourOuvre).toBe(false);
    });

    it('marks Tuesday 5 January 2027 as a working day', () => {
      const rows = generateTempsRows(2027, 2027);
      const day = rows.find((r) => r.date === '2027-01-05');
      expect(day).toBeDefined();
      expect(day!.jourOuvre).toBe(true);
    });

    it('flags est_fin_de_mois on the last working day of January 2026 (Fri 30/01, since Sat 31/01 is weekend)', () => {
      // Note : 31/01/2026 est un samedi → pas jour_ouvre. Per spec
      // §3.1 "Dernier jour ouvré du mois", est_fin_de_mois tombe sur
      // le dernier jour ouvré, soit le vendredi 30/01.
      const rows = generateTempsRows(2026, 2026);
      const fri30 = rows.find((r) => r.date === '2026-01-30');
      const sat31 = rows.find((r) => r.date === '2026-01-31');
      expect(fri30!.jourOuvre).toBe(true);
      expect(fri30!.estFinDeMois).toBe(true);
      expect(sat31!.jourOuvre).toBe(false);
      expect(sat31!.estFinDeMois).toBe(false);
    });

    it('flags est_fin_de_trimestre on Tuesday 31/03/2026', () => {
      const rows = generateTempsRows(2026, 2026);
      const day = rows.find((r) => r.date === '2026-03-31');
      expect(day!.jourOuvre).toBe(true);
      expect(day!.estFinDeTrimestre).toBe(true);
    });

    it('flags est_fin_d_annee on Thursday 31/12/2026', () => {
      const rows = generateTempsRows(2026, 2026);
      const day = rows.find((r) => r.date === '2026-12-31');
      expect(day!.jourOuvre).toBe(true);
      expect(day!.estFinDAnnee).toBe(true);
    });

    it('marks all weekends as non-working days across a sample year', () => {
      const rows = generateTempsRows(2026, 2026);
      const weekendsNotOuvres = rows.filter(
        (r) => {
          const d = new Date(`${r.date}T00:00:00Z`);
          const dayOfWeek = d.getUTCDay();
          return (dayOfWeek === 0 || dayOfWeek === 6) && r.jourOuvre;
        },
      );
      expect(weekendsNotOuvres).toHaveLength(0);
    });

    it('sets exercice_fiscal equal to annee', () => {
      const rows = generateTempsRows(2026, 2027);
      for (const r of rows) {
        expect(r.exerciceFiscal).toBe(r.annee);
      }
    });

    it('produces at most one est_fin_de_mois per (annee, mois)', () => {
      const rows = generateTempsRows(2026, 2026);
      const counts = new Map<string, number>();
      for (const r of rows) {
        if (!r.estFinDeMois) continue;
        const key = `${r.annee}-${r.mois}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const c of counts.values()) {
        expect(c).toBe(1);
      }
      // 12 months, 12 fin-de-mois flags.
      expect(counts.size).toBe(12);
    });
  });
});
