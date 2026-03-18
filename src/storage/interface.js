/**
 * Storage interface — all implementations must provide these methods.
 * Designed for future Supabase migration.
 */
export class StorageInterface {
  /** Append rows to the named sheet/table */
  async appendRows(sheet, rows) { throw new Error('Not implemented'); }

  /** Read all rows from the named sheet/table */
  async readAll(sheet) { throw new Error('Not implemented'); }

  /** Update a specific cell by row number and column letter */
  async updateCell(sheet, row, col, value) { throw new Error('Not implemented'); }

  /** Find rows matching a filter function */
  async findRows(sheet, filterFn) {
    const all = await this.readAll(sheet);
    return all.filter(filterFn);
  }
}
