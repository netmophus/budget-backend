import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { Scd2Entity } from '../entities/scd2.entity';

/**
 * Service générique SCD2.
 *
 * Paramétré par l'entité concrète et le **nom de propriété TS** de la
 * business key (ex. `'codeCompte'`, `'codeStructure'`). Toutes les
 * opérations multi-table passent par une transaction unique pour
 * préserver les invariants §6.2 du modèle de données.
 *
 * Usage type :
 * ```typescript
 * @Injectable()
 * export class StructuresService extends Scd2Service<DimStructure> {
 *   constructor(
 *     @InjectRepository(DimStructure) repo: Repository<DimStructure>,
 *     dataSource: DataSource,
 *   ) {
 *     super(repo, 'codeStructure', dataSource);
 *   }
 * }
 * ```
 */
export class Scd2Service<T extends Scd2Entity> {
  constructor(
    protected readonly repo: Repository<T>,
    /** Nom de la **propriété TS** servant de business key (camelCase). */
    protected readonly businessKeyProp: keyof T & string,
    protected readonly dataSource: DataSource,
  ) {}

  /** Version courante (active) à date pour une business key. */
  async findCurrent(businessKey: string): Promise<T | null> {
    const where = {
      [this.businessKeyProp]: businessKey,
      versionCourante: true,
    } as unknown as FindOptionsWhere<T>;
    return this.repo.findOne({ where });
  }

  /** Toutes les versions courantes (filtrées éventuellement). */
  async findAllCurrent(extra?: FindOptionsWhere<T>): Promise<T[]> {
    const base = { versionCourante: true } as unknown as FindOptionsWhere<T>;
    return this.repo.find({ where: { ...base, ...(extra ?? {}) } });
  }

  /** Version valide à une date donnée (selon `[debut, fin)`). */
  async findValidAt(businessKey: string, date: Date): Promise<T | null> {
    const dateStr = date.toISOString().slice(0, 10);
    const alias = 'e';
    return this.repo
      .createQueryBuilder(alias)
      .where(`${alias}.${this.businessKeyProp} = :businessKey`, { businessKey })
      .andWhere(`${alias}.dateDebutValidite <= :date`, { date: dateStr })
      .andWhere(
        `(${alias}.dateFinValidite IS NULL OR ${alias}.dateFinValidite > :date)`,
        { date: dateStr },
      )
      .getOne();
  }

  /**
   * Résout le surrogate id d'une dimension SCD2 vers la version
   * VALIDE À LA DATE MÉTIER fournie. Implémente Option B
   * (cf. `docs/modele-donnees.md` §6.3) — utilisable par toutes les
   * tables de faits (`fait_budget` au Lot 3.2B, puis fait_realise /
   * fait_capex / fait_bilan plus tard).
   *
   * Wrapper sur `findValidAt` avec :
   *  - acceptation d'une date sous forme `Date` ou `string` ISO
   *    (`YYYY-MM-DD`) — pratique pour les DTO sérialisés.
   *  - retour structuré `{ id, version }` : l'`id` est extrait pour
   *    l'utilisation directe en FK, la `version` pour les contrôles
   *    métier (lecture de `estActif`, `libelle`, etc.) côté caller.
   *  - `null` si aucune version valide à cette date — le caller
   *    doit gérer (typiquement 422 avec message indiquant LAQUELLE).
   */
  async resolveVersionAtDate(
    businessKey: string,
    dateMetier: Date | string,
  ): Promise<{ id: string; version: T } | null> {
    const date =
      typeof dateMetier === 'string' ? new Date(dateMetier) : dateMetier;
    const version = await this.findValidAt(businessKey, date);
    if (!version) return null;
    const id = (version as unknown as { id: string | number }).id;
    return { id: String(id), version };
  }

  /** Historique chronologique d'une business key. */
  async findHistory(businessKey: string): Promise<T[]> {
    const where = {
      [this.businessKeyProp]: businessKey,
    } as unknown as FindOptionsWhere<T>;
    return this.repo.find({
      where,
      order: { dateDebutValidite: 'ASC' } as never,
    });
  }

  /**
   * Crée une nouvelle version SCD2 :
   *  - en transaction unique
   *  - ferme la version courante (`date_fin_validite = today`,
   *    `version_courante = false`)
   *  - insère la nouvelle (`date_debut_validite = today`,
   *    `version_courante = true`)
   *
   * Si aucune version courante n'existe, insère simplement la première.
   */
  async createNewVersion(
    businessKey: string,
    attrs: Partial<T>,
    utilisateur: string,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      const today = new Date().toISOString().slice(0, 10);
      const target = this.repo.target;

      // 1. Fermer l'ancienne version courante si présente.
      await manager
        .createQueryBuilder()
        .update(target)
        .set({
          dateFinValidite: today,
          versionCourante: false,
          dateModification: () => 'CURRENT_TIMESTAMP',
          utilisateurModification: utilisateur,
        })
        .where(`${this.businessKeyProp} = :businessKey`, { businessKey })
        .andWhere('versionCourante = :true', { true: true })
        .execute();

      // 2. Insérer la nouvelle.
      //    Construction en 3 sections, ordre du spread important :
      //    a. Défauts applicatifs : override-ables par l'appelant via
      //       `attrs`. Permet par exemple PATCH SCD2 + désactivation
      //       atomique (`attrs.estActif = false`).
      //    b. Spread des attrs fournis par l'appelant.
      //    c. Invariants SCD2 verrouillés : non override-ables, pour
      //       préserver la sémantique de la dimension (au plus 1 ligne
      //       courante par business key, intervalles `[debut, fin)`
      //       disjoints, etc.).
      const row = manager.create(target, {
        // (a) Défauts applicatifs override-ables
        estActif: true,

        // (b) Spread des attrs fournis par l'appelant
        ...(attrs as object),

        // (c) Invariants SCD2 verrouillés (non override-ables)
        [this.businessKeyProp]: businessKey,
        dateDebutValidite: today,
        dateFinValidite: null,
        versionCourante: true,
        utilisateurCreation: utilisateur,
      } as never);
      // save() retourne T | T[] selon l overload, mais avec un seul argument
      // d entree, le runtime garantit single T. Cast direct au lieu du ternary.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- ESLint considere le cast inutile mais TS2352 sans le as unknown (overload typeorm mal infere)
      return (await manager.save(row)) as unknown as T;
    });
  }

  /** Ferme la version courante sans en créer de nouvelle (clôture). */
  async softClose(businessKey: string, utilisateur: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    await this.repo
      .createQueryBuilder()
      .update()
      .set({
        dateFinValidite: today,
        versionCourante: false,
        estActif: false,
        dateModification: () => 'CURRENT_TIMESTAMP',
        utilisateurModification: utilisateur,
      } as never)
      .where(`${this.businessKeyProp} = :businessKey`, { businessKey })
      .andWhere('versionCourante = :true', { true: true })
      .execute();
  }
}
