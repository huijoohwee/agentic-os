/** Print a canonical profile for bootstrap without mutating files or trust. */
import { createRepositoryProfile } from '../src/governance.mjs';
import { loadRepositoryProfile } from '../src/git-repository.mjs';
import { bindProfileToRemote } from '../src/github-provider.mjs';
import { option } from './agentic-os-argv.mjs';

export function runProfileInit(root, argv, out) {
  const repository = option(argv, 'repository');
  if (!/^[A-Za-z0-9.-]+(?::[0-9]{1,5})?\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository ?? '')) {
    throw new TypeError('repository must be host/owner/name');
  }
  const { profileDigest: omitted, ...source } = loadRepositoryProfile({ repository: root });
  const profile = createRepositoryProfile({ ...source, repository });
  if (profile.adapters.provider?.id === 'github') bindProfileToRemote(profile, root);
  out(JSON.stringify(profile, null, 2));
  return 0;
}
