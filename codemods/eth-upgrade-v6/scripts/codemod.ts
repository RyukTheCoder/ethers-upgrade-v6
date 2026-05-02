import type { Codemod, RootKind, SgNode } from "codemod:ast-grep";
import { parseAsync } from "codemod:ast-grep";
import type JS from "codemod:ast-grep/langs/javascript";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";

import { normalizeConstants } from "../transforms/normalizeConstants.ts";
import { replaceBigNumberWithBigInt } from "../transforms/replaceBigNumberWithBigInt.ts";

// You can change the language to JS, TS, or TSX depending on your needs. Here we use a union type to support all three.
// Please note that TSX is different from TS in that it supports JSX syntax and treats type generics differently, so make sure to choose the one that best fits your codebase.
// - If you are targeting JSX files, use TSX.
// - If you are targeting plain TypeScript files without JSX, use TS.
// - If you do not care about TypeScript features and want to target plain JavaScript files, use JS.
//
// Make sure this is in sync with workflow.yaml where you specify the language for the codemod.
type JSOrTS = JS | TS | TSX;

type RootNode = SgNode<JSOrTS, RootKind<JSOrTS>>;
type FileTransform = (root: RootNode) => string;

async function runSequential(
  language: string,
  firstRoot: RootNode,
  transforms: FileTransform[],
): Promise<string> {
  if (transforms.length === 0) {
    return firstRoot.getRoot().source();
  }

  let source = transforms[0]!(firstRoot);
  for (let i = 1; i < transforms.length; i++) {
    const next = await parseAsync<JSOrTS>(language, source);
    source = transforms[i]!(next.root());
  }
  return source;
}

const codemod: Codemod<JSOrTS> = async (root, options) => {
  return runSequential(options.language, root.root(), [
    replaceBigNumberWithBigInt,
    normalizeConstants,
  ]);
};

export default codemod;
