/**
 * Transform: Flatten ethers.constants usages for v6 migration.
 *
 * Purpose
 * - Replace deprecated `ethers.constants.*` member access with v6-compatible forms.
 * - Map renamed constants to their root `ethers.*` exports.
 * - Convert numeric namespace constants to native bigint literals.
 *
 * Rules Applied
 * 1) Renamed constants
 *    - `ethers.constants.AddressZero` -> `ethers.ZeroAddress`
 *    - `ethers.constants.HashZero`    -> `ethers.ZeroHash`
 *    - `ethers.constants.MaxUint256`  -> `ethers.MaxUint256`
 *    - `ethers.constants.MaxInt256`   -> `ethers.MaxInt256`
 *    - `ethers.constants.MinInt256`   -> `ethers.MinInt256`
 *    - `ethers.constants.WeiPerEther` -> `ethers.WeiPerEther`
 *    - `ethers.constants.EtherSymbol` -> `ethers.EtherSymbol`
 *
 * 2) Numeric constants to bigint constructor calls
 *    - `ethers.constants.NegativeOne` -> `BigInt("-1")`
 *    - `ethers.constants.Zero`        -> `BigInt("0")`
 *    - `ethers.constants.One`         -> `BigInt("1")`
 *    - `ethers.constants.Two`         -> `BigInt("2")`
 *
 * 3) Bare `constants.X` shape (named import from ethers)
 *    - Renamed constants are rewritten to `ethers.*` root exports; e.g.
 *      `constants.AddressZero` -> `ethers.ZeroAddress`.
 *      Numeric constants still become `BigInt("...")`.
 *    - Only applied when the local binding `constants` originates from an
 *      `import { ... } from "ethers"` in the same file. Locally declared
 *      bindings (e.g. `const constants = { ... }`) are left untouched.
 *
 * Behavioral Guarantees
 * - Idempotent: rewritten outputs do not match either source pattern, so
 *   repeated runs are no-ops.
 * - Scope-limited: only matching `MemberExpression` nodes are modified;
 *   import statements are intentionally NOT touched (handled by a separate
 *   imports transform later in the pipeline).
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

/** v5 constant name -> v6 root export name (kept under `ethers.` when namespaced). */
const RENAMED_CONSTANTS: Record<string, string> = {
  AddressZero: "ZeroAddress",
  HashZero: "ZeroHash",
  MaxUint256: "MaxUint256",
  MaxInt256: "MaxInt256",
  MinInt256: "MinInt256",
  WeiPerEther: "WeiPerEther",
  EtherSymbol: "EtherSymbol",
};

/** v5 numeric constant name -> string literal forwarded to `BigInt(...)`. */
const BIGINT_CONSTANTS: Record<string, string> = {
  NegativeOne: "-1",
  Zero: "0",
  One: "1",
  Two: "2",
};

const NAMESPACED_PATTERN = "ethers.constants.$NAME";
const BARE_PATTERN = "constants.$NAME";

function rangeStart(node: JsNode): number {
  const r = node.range() as { start: { index: number } };
  return r.start.index;
}

/** Replacement text for the namespaced shape `ethers.constants.X`; `null` if X is unknown. */
function namespacedReplacement(name: string): string | null {
  const renamed = RENAMED_CONSTANTS[name];
  if (renamed !== undefined) {
    return `ethers.${renamed}`;
  }
  const numeric = BIGINT_CONSTANTS[name];
  if (numeric !== undefined) {
    return `BigInt("${numeric}")`;
  }
  return null;
}

/** Replacement text for the bare shape `constants.X` (named import from ethers); `null` if X is unknown. */
function bareReplacement(name: string): string | null {
  const renamed = RENAMED_CONSTANTS[name];
  if (renamed !== undefined) {
    return `ethers.${renamed}`;
  }
  const numeric = BIGINT_CONSTANTS[name];
  if (numeric !== undefined) {
    return `BigInt("${numeric}")`;
  }
  return null;
}

/**
 * True iff the local binding `constants` in this file originates from an
 * `import { ... } from "ethers"` statement. Covers both the direct form
 * `import { constants } from "ethers"` and the rarer aliased form
 * `import { foo as constants } from "ethers"`.
 */
function importsConstantsFromEthers(
  rootNode: SgNode<JSOrTS, RootKind<JSOrTS>>,
): boolean {
  const importsFromEthers = rootNode.findAll({
    rule: {
      kind: "import_statement",
      has: {
        kind: "string",
        regex: "^[\"']ethers[\"']$",
      },
    },
  });

  for (const imp of importsFromEthers) {
    const specifiers = imp.findAll({ rule: { kind: "import_specifier" } });
    for (const spec of specifiers) {
      const alias = spec.field("alias");
      const localName = (alias ?? spec.field("name"))?.text();
      if (localName === "constants") {
        return true;
      }
    }
  }
  return false;
}

function findNamespacedConstantAccesses(
  rootNode: SgNode<JSOrTS, RootKind<JSOrTS>>,
): JsNode[] {
  return rootNode.findAll({ rule: { pattern: NAMESPACED_PATTERN } });
}

function findBareConstantAccesses(
  rootNode: SgNode<JSOrTS, RootKind<JSOrTS>>,
): JsNode[] {
  return rootNode.findAll({ rule: { pattern: BARE_PATTERN } });
}

/** Push edits for namespaced `ethers.constants.X` matches; unknown names are silently skipped. */
function appendNamespacedReplacements(
  pending: PendingEdit[],
  matches: JsNode[],
): void {
  for (const m of matches) {
    const name = m.getMatch("NAME")?.text();
    if (name === undefined) {
      continue;
    }
    const replacement = namespacedReplacement(name);
    if (replacement === null) {
      continue;
    }
    pending.push({ node: m, replacement });
  }
}

/** Push edits for bare `constants.X` matches; unknown names are silently skipped. */
function appendBareReplacements(
  pending: PendingEdit[],
  matches: JsNode[],
): void {
  for (const m of matches) {
    const name = m.getMatch("NAME")?.text();
    if (name === undefined) {
      continue;
    }
    const replacement = bareReplacement(name);
    if (replacement === null) {
      continue;
    }
    pending.push({ node: m, replacement });
  }
}

function sortEditsByDescendingPosition(pending: PendingEdit[]): void {
  pending.sort((a, b) => rangeStart(b.node) - rangeStart(a.node));
}

export function normalizeConstants(
  rootNode: SgNode<JSOrTS, RootKind<JSOrTS>>,
): string {
  const pending: PendingEdit[] = [];

  appendNamespacedReplacements(
    pending,
    findNamespacedConstantAccesses(rootNode),
  );

  // The bare `constants.X` form is only safe to rewrite when `constants`
  // is actually the named export from "ethers" in this file's scope.
  if (importsConstantsFromEthers(rootNode)) {
    appendBareReplacements(pending, findBareConstantAccesses(rootNode));
  }

  sortEditsByDescendingPosition(pending);

  return rootNode.commitEdits(
    pending.map((p) => p.node.replace(p.replacement)),
  );
}
