import fs from 'node:fs'
import type { Db } from './db'
import { quoteIdentifier } from './db'

export type Backup = {
  updates: { table: string; pk: string; pkValue: unknown; before: Record<string, unknown> }[]
  inserted: { table: string; pk: string; pkValue: unknown }[]
}

export function newBackup(): Backup {
  return { updates: [], inserted: [] }
}

export async function mutateRow(db: Db, backup: Backup, opts: { table: string; pk: string; pkValue: unknown; changes: Record<string, unknown> }): Promise<void> {
  const { table, pk, pkValue, changes } = opts
  const columns = Object.keys(changes)
  if (!columns.length) return
  const { rows } = await db.query<Record<string, unknown>>(
    `select ${columns.map(quoteIdentifier).join(', ')} from ${quoteIdentifier(table)} where ${quoteIdentifier(pk)} = $1`,
    [pkValue],
  )
  if (!rows[0]) throw new Error(`Không thấy dòng ${table}.${pk}=${pkValue}.`)
  backup.updates.push({ table, pk, pkValue, before: rows[0] })
  const set = columns.map((column, index) => `${quoteIdentifier(column)} = $${index + 2}`).join(', ')
  await db.query(`update ${quoteIdentifier(table)} set ${set} where ${quoteIdentifier(pk)} = $1`, [pkValue, ...columns.map((column) => changes[column])])
}

export function recordInsert(backup: Backup, table: string, pk: string, pkValue: unknown): void {
  quoteIdentifier(table)
  quoteIdentifier(pk)
  backup.inserted.push({ table, pk, pkValue })
}

export async function restoreBackup(db: Db, backup: Backup): Promise<void> {
  await db.query('BEGIN')
  try {
    for (let i = backup.updates.length - 1; i >= 0; i--) {
      const item = backup.updates[i]
      const columns = Object.keys(item.before)
      if (!columns.length) continue
      const set = columns.map((column, index) => `${quoteIdentifier(column)} = $${index + 2}`).join(', ')
      await db.query(`update ${quoteIdentifier(item.table)} set ${set} where ${quoteIdentifier(item.pk)} = $1`, [item.pkValue, ...columns.map((column) => item.before[column])])
    }
    for (let i = backup.inserted.length - 1; i >= 0; i--) {
      const item = backup.inserted[i]
      await db.query(`delete from ${quoteIdentifier(item.table)} where ${quoteIdentifier(item.pk)} = $1`, [item.pkValue])
    }
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {})
    throw error
  }
}

export function saveBackupFile(file: string, backup: Backup): void {
  fs.writeFileSync(file, JSON.stringify(backup, null, 2), { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}

export function loadBackupFile(file: string): Backup {
  if (!fs.existsSync(file)) throw new Error(`Không thấy backup file ${file}.`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Backup
}
