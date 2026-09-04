import { lstatSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as nodeModule from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { decodeNulFields, gitBlobOid, observeGit, rawTrackedFileMatches } from '../src/git-tracked.mjs';

const ACTIVE_TOKENS = new Set();

export async function withContainedModules(entries, errorPrefix, use) {
  const normalized = entries.map(({ root, relative }) => ({
    root: realpathSync(root),
    relative,
  }));
  const roots = [...new Set(normalized.map(entry => entry.root))];
  const fail = code => { throw new Error(`${errorPrefix}:${code}`); };
  for (const root of roots) {
    const topLevel = git(root, ['rev-parse', '--show-toplevel']);
    if (!topLevel || realpathOrNull(topLevel) !== root) fail('marketplace_module_git_root_unexpected');
  }
  const inspectedTargets = new Map();
  const inspectUrl = (value, expectedOwnerRoot = null) => {
    const url = new URL(value);
    if (url.protocol !== 'file:' || url.search || url.hash) fail('marketplace_module_url_invalid');
    const unresolved = fileURLToPath(url);
    if (expectedOwnerRoot) {
      if (!inside(expectedOwnerRoot, unresolved)) fail('marketplace_module_path_escaped');
      let declared;
      try { declared = lstatSync(unresolved); } catch { fail('marketplace_module_path_unreadable'); }
      if (!declared.isFile()) fail('marketplace_module_not_regular');
    }
    let target;
    try { target = realpathSync(unresolved); } catch { fail('marketplace_module_path_unreadable'); }
    if (path.resolve(unresolved) !== target) fail('marketplace_module_path_aliased');
    if (expectedOwnerRoot && !inside(expectedOwnerRoot, target))
      fail('marketplace_module_owner_boundary_crossed');
    const ownerRoot = expectedOwnerRoot ?? roots.find(root => inside(root, target));
    if (!ownerRoot) fail('marketplace_module_path_escaped');
    if (!lstatSync(target).isFile()) fail('marketplace_module_not_regular');
    const inspected = inspectedTargets.get(target);
    if (inspected && inspected.ownerRoot !== ownerRoot)
      fail('marketplace_module_owner_boundary_crossed');
    if (!inspected) {
      const entry = trackedEntry(ownerRoot, target);
      if (!entry) fail('marketplace_module_untracked');
      if (!trackedEntryMatches(ownerRoot, target, entry)) fail('marketplace_module_bytes_unbound');
      inspectedTargets.set(target, { ownerRoot, entry });
    }
    return target;
  };
  const entryOwners = new Map(normalized.map(({ root, relative }) => [
    pathToFileURL(path.resolve(root, relative)).href, root,
  ]));
  const token = `?agentic_os_composition=${randomUUID()}`;
  const containedUrl = target => `${pathToFileURL(target).href}${token}`;
  const hooks = nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('node:')) return nextResolve(specifier, context);
      if (!(specifier.startsWith('.') || specifier.startsWith('file:'))) {
        fail('marketplace_module_specifier_unsupported');
      }
      let requested;
      try { requested = new URL(specifier, context.parentURL); }
      catch { fail('marketplace_module_url_invalid'); }
      const requestedToken = requested.search;
      if (requestedToken && requestedToken !== token) {
        if (ACTIVE_TOKENS.has(requestedToken)) return nextResolve(specifier, context);
        fail('marketplace_module_url_invalid');
      }
      if (requested.hash) fail('marketplace_module_url_invalid');
      requested.search = '';
      let parentRoot = null;
      if (context.parentURL?.startsWith('file:')) {
        const parentUrl = new URL(context.parentURL);
        if (parentUrl.search && parentUrl.search !== token) {
          if (!ACTIVE_TOKENS.has(parentUrl.search)) fail('marketplace_module_url_invalid');
          if (requestedToken === token) fail('marketplace_module_owner_boundary_crossed');
          return nextResolve(specifier, context);
        }
        parentUrl.search = '';
        const parent = realpathOrNull(fileURLToPath(parentUrl));
        parentRoot = inspectedTargets.get(parent)?.ownerRoot
          ?? roots.find(root => parent && inside(root, parent)) ?? null;
      }
      const entryRoot = entryOwners.get(requested.href) ?? null;
      if (parentRoot && entryRoot && parentRoot !== entryRoot)
        fail('marketplace_module_owner_boundary_crossed');
      const expectedRoot = parentRoot ?? entryRoot;
      if (!expectedRoot) fail('marketplace_module_path_escaped');
      const target = inspectUrl(requested.href, expectedRoot);
      return { url: containedUrl(target), shortCircuit: true };
    },
    load(url, context, nextLoad) {
      if (url.startsWith('node:')) return nextLoad(url, context);
      const requested = new URL(url);
      if (requested.search !== token) {
        if (ACTIVE_TOKENS.has(requested.search)) return nextLoad(url, context);
        fail('marketplace_module_url_invalid');
      }
      if (requested.hash) fail('marketplace_module_url_invalid');
      requested.search = '';
      const target = inspectUrl(requested.href), { entry } = inspectedTargets.get(target);
      let source;
      try { source = readBoundedFile(target, 500_000, 'marketplace module', { expectedPath: target }); }
      catch { fail('marketplace_module_read_invalid'); }
      if (gitBlobOid(source, entry.oid) !== entry.oid) fail('marketplace_module_bytes_unbound');
      const extension = path.extname(target);
      const format = extension === '.ts' ? 'module-typescript'
        : ['.js', '.mjs'].includes(extension) ? 'module' : null;
      if (!format) fail('marketplace_module_format_unsupported');
      return { format, source, shortCircuit: true };
    },
  });
  ACTIVE_TOKENS.add(token);
  try {
    const initialTargets = normalized.map(({ root, relative }) => {
      const unresolved = path.resolve(root, relative);
      if (!inside(root, unresolved)) fail('marketplace_module_path_escaped');
      inspectUrl(pathToFileURL(unresolved).href, root);
      return unresolved;
    });
    const modules = await Promise.all(initialTargets.map(target => import(containedUrl(target))));
    const result = await use(modules);
    for (const [target, before] of inspectedTargets) {
      const after = trackedEntry(before.ownerRoot, target);
      if (!after || after.record !== before.entry.record
        || !trackedEntryMatches(before.ownerRoot, target, after)) {
        fail('marketplace_module_changed_during_probe');
      }
    }
    return result;
  } finally {
    try { hooks.deregister(); } finally { ACTIVE_TOKENS.delete(token); }
  }
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function realpathOrNull(value) {
  try { return realpathSync(value); } catch { return null; }
}

function git(root, args) {
  return observeGit(args, { cwd: root, allowFail: true });
}

function trackedEntry(root, target) {
  const relative = path.relative(root, target);
  const records = decodeNulFields(observeGit([
    '--literal-pathspecs', 'ls-files', '--stage', '-z', '--', relative,
  ], { cwd: root, binary: true, allowFail: true }));
  if (records?.length !== 1) return null;
  const tab = records[0].indexOf('\t');
  const match = tab < 0 ? null
    : records[0].slice(0, tab).match(/^([0-7]{6}) ([0-9a-f]{40}(?:[0-9a-f]{24})?) 0$/u);
  return match && records[0].slice(tab + 1) === relative
    ? { mode: match[1], oid: match[2], path: relative, record: records[0] } : null;
}

function trackedEntryMatches(root, target, entry) {
  const before = lstatSync(target, { bigint: true, throwIfNoEntry: false });
  return Boolean(before?.isFile()
    && rawTrackedFileMatches({ absolute: target, ...entry, before, cwd: root }));
}
