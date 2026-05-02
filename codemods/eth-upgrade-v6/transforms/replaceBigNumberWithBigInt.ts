/**
 * Transform: BigNumber constructors → native bigint
 *
 * Purpose
 * - Migrate safe `BigNumber.from(...)` constructor usage to native `BigInt(...)`.
 * - Flag chained BigNumber method flows for manual migration instead of rewriting.
 *
 * Rules Applied
 * 1) Non-chained constructor conversion
 *    - `ethers.BigNumber.from(x)` → `BigInt(x)`
 *    - `BigNumber.from(x)`        → `BigInt(x)`
 *
 * 2) Chained call handling
 *    - For chained calls (for example `BigNumber.from("2").pow(8)`), keep the
 *      expression unchanged and add a leading TODO comment on the enclosing
 *      statement:
 *      `// TODO: v6-bigint manual BigNumber chain migration`
 *    - If that TODO already exists on the statement, do not add a duplicate.
 *
 * Behavioral Guarantees
 * - Idempotent: repeated runs do not keep adding TODO comments or re-changing code.
 * - Scope-limited: only matching `CallExpression` nodes are considered.
 *
 * Note: `import { BigNumber } from "ethers"` cleanup is handled by imports transforms.
 */

import type { RootKind, SgNode } from "codemod:ast-grep";
import type JS from "codemod:ast-grep/langs/javascript";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";

type JSOrTS = JS | TS | TSX;
/** Any AST node in JS/TS/TSX (not necessarily the file root). */
type JsNode = SgNode<JSOrTS>;

type PendingEdit = {
  node: JsNode;
  replacement: string;
};

const TODO_MARKER = "// TODO: v6-bigint manual BigNumber chain migration";

const FROM_PATTERNS = [
  "BigNumber.from($ARG)",
  "ethers.BigNumber.from($ARG)",
] as const;

/** Match inserted line breaks to the file (tests and Windows checkouts often use CRLF). */
function eolFromSource(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

const STATEMENT_KINDS = new Set<string>([
  "expression_statement",
  "return_statement",
  "throw_statement",
  "variable_declaration",
  "lexical_declaration",
  "export_statement",
  "if_statement",
  "for_statement",
  "for_in_statement",
  "for_of_statement",
  "while_statement",
  "do_statement",
  "labeled_statement",
  "try_statement",
  "switch_statement",
  "switch_case",
  "switch_default",
  "public_field_definition",
  "field_definition",
]);

function rangeStart(node: JsNode): number {
  const r = node.range() as { start: { index: number } };
  return r.start.index;
}

function findEnclosingStatement(node: JsNode): JsNode | null {
  for (const anc of node.ancestors()) {
    if (STATEMENT_KINDS.has(anc.kind())) {
      return anc;
    }
  }
  return null;
}

/**
 * True when this `...from(arg)` call is immediately followed by a property access
 * (e.g. `.pow(8)`), so the BigNumber API chain must not be partially rewritten.
 */
function isChainedFromCall(node: JsNode): boolean {
  const parent = node.parent();
  if (!parent) {
    return false;
  }
  const kind = parent.kind();
  if (kind !== "member_expression" && kind !== "optional_member_expression") {
    return false;
  }
  const object = parent.field("object");
  return object !== null && object.id() === node.id();
}

/** Collect every `BigNumber.from` / `ethers.BigNumber.from` call node, deduped. */
function findBigNumberFromCalls(
  rootNode: SgNode<JSOrTS, RootKind<JSOrTS>>,
): JsNode[] {
  const byId = new Map<number, JsNode>();
  for (const pattern of FROM_PATTERNS) {
    for (const n of rootNode.findAll({ rule: { pattern } })) {
      byId.set(n.id(), n);
    }
  }
  return [...byId.values()];
}

type MatchClassification = {
  /** Each match node id → enclosing statement node id (when a statement exists). */
  matchStatementId: Map<number, number>;
  /** Statement ids that contain at least one chained `.from(...).` use; those statements skip `BigInt(...)` for every match inside them. */
  chainedStatementIds: Set<number>;
};

function classifyMatches(matches: JsNode[]): MatchClassification {
  const matchStatementId = new Map<number, number>();
  const chainedStatementIds = new Set<number>();

  for (const m of matches) {
    const stmt = findEnclosingStatement(m);
    if (!stmt) {
      continue;
    }
    matchStatementId.set(m.id(), stmt.id());
    if (isChainedFromCall(m)) {
      chainedStatementIds.add(stmt.id());
    }
  }

  return { matchStatementId, chainedStatementIds };
}

/** One statement node per id that needs a leading TODO (statements containing any chain). */
function statementNodesForTodo(
  matches: JsNode[],
  matchStatementId: Map<number, number>,
  chainedStatementIds: Set<number>,
): Map<number, JsNode> {
  const stmtTodoNodeById = new Map<number, JsNode>();
  for (const m of matches) {
    const stmtId = matchStatementId.get(m.id());
    if (stmtId === undefined || !chainedStatementIds.has(stmtId)) {
      continue;
    }
    const stmt = findEnclosingStatement(m);
    if (stmt) {
      stmtTodoNodeById.set(stmtId, stmt);
    }
  }
  return stmtTodoNodeById;
}

function appendTodoEdits(
  pending: PendingEdit[],
  statements: Map<number, JsNode>,
  eol: string,
): void {
  for (const stmt of statements.values()) {
    if (stmt.text().includes(TODO_MARKER)) {
      continue;
    }
    pending.push({
      node: stmt,
      replacement: `${TODO_MARKER}${eol}${stmt.text()}`,
    });
  }
}

/** Safe `from(...)` → `BigInt(...)` replacements; skips matches in statements flagged for manual chain migration. */
function appendBigIntReplacements(
  pending: PendingEdit[],
  matches: JsNode[],
  matchStatementId: Map<number, number>,
  chainedStatementIds: Set<number>,
): void {
  for (const m of matches) {
    const stmtId = matchStatementId.get(m.id());
    if (stmtId === undefined || chainedStatementIds.has(stmtId)) {
      continue;
    }
    if (isChainedFromCall(m)) {
      continue;
    }
    const arg = m.getMatch("ARG")?.text();
    if (arg === undefined) {
      continue;
    }
    pending.push({
      node: m,
      replacement: `BigInt(${arg})`,
    });
  }
}

function sortEditsByDescendingPosition(pending: PendingEdit[]): void {
  pending.sort((a, b) => rangeStart(b.node) - rangeStart(a.node));
}

export function replaceBigNumberWithBigInt(
  rootNode: SgNode<JSOrTS, RootKind<JSOrTS>>,
): string {
  const eol = eolFromSource(rootNode.getRoot().source());
  const matches = findBigNumberFromCalls(rootNode);
  const { matchStatementId, chainedStatementIds } = classifyMatches(matches);

  const pending: PendingEdit[] = [];
  appendTodoEdits(
    pending,
    statementNodesForTodo(matches, matchStatementId, chainedStatementIds),
    eol,
  );
  appendBigIntReplacements(
    pending,
    matches,
    matchStatementId,
    chainedStatementIds,
  );

  sortEditsByDescendingPosition(pending);

  return rootNode.commitEdits(
    pending.map((p) => p.node.replace(p.replacement)),
  );
}
