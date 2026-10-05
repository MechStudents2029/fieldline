/**
 * Turn the SQLite migration into Postgres DDL.
 * Types stay text and integer so the app code is unchanged.
 * Foreign keys are applied after every table exists. SQLite accepts them in any order; Postgres does not.
 */
export function toPostgresDdl(sqliteSql: string): string {
  const quoted = sqliteSql.replace(/--> statement-breakpoint/g, "").replace(/`/g, '"');
  const tables: string[] = [];
  const rest: string[] = [];
  const foreignKeys: string[] = [];
  for (const statement of splitSql(quoted)) {
    if (!/^create table\s+/i.test(statement)) {
      rest.push(statement);
      continue;
    }
    const name = statement.match(/^create table\s+"([^"]+)"/i)?.[1] ?? "table";
    const kept: string[] = [];
    let fkIndex = 0;
    for (const line of statement.split("\n")) {
      if (/^\s*foreign key\b/i.test(line.trim())) {
        const fk = line.trim().replace(/,\s*$/, "");
        foreignKeys.push(`alter table "${name}" add constraint "${name}_fk_${fkIndex}" ${fk}`);
        fkIndex += 1;
      } else {
        kept.push(line);
      }
    }
    for (let i = kept.length - 1; i >= 0; i--) {
      if (/^\)\s*;?\s*$/.test(kept[i].trim())) continue;
      kept[i] = kept[i].replace(/,\s*$/, "");
      break;
    }
    tables.push(kept.join("\n").replace(/;\s*$/, ""));
  }
  return [...tables, ...rest, ...foreignKeys].join(";\n") + ";\n";
}

/** Drizzle's SQLite dialect emits `?` placeholders and case-insensitive `like`. */
export function translateSqliteQuery(sql: string): string {
  const withLike = sql.replace(/\slike\s+\?/gi, " ilike ?");
  let index = 0;
  let out = "";
  for (let i = 0; i < withLike.length; i++) {
    const ch = withLike[i];
    if (ch === "'") {
      out += ch;
      for (i += 1; i < withLike.length; i++) {
        out += withLike[i];
        if (withLike[i] === "'" && withLike[i + 1] === "'") {
          out += withLike[i + 1];
          i += 1;
          continue;
        }
        if (withLike[i] === "'") break;
      }
      continue;
    }
    if (ch === "?") {
      index += 1;
      out += `$${index}`;
      continue;
    }
    out += ch;
  }
  return out;
}

export function splitSql(script: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    if (ch === "'") {
      current += ch;
      if (quoted && script[i + 1] === "'") {
        current += script[i + 1];
        i += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (ch === ";" && !quoted) {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}
