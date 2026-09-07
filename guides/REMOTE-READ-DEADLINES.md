# Bounded remote ref reads

The shared Git owner bounds `ls-remote` transport execution to 15 seconds, using
native synchronous process deadlines on POSIX. Windows has an outer 17-second
watchdog including supervisor startup. Reads of one ref and
batched refs use the same owner. Local Git operations and writes retain their
existing semantics; no write is automatically retried.

Each read enforces a 64 KiB output limit per channel. It returns
advertisement bytes only after a successful exit. Timeout, overflow and ordinary
failure discard partial stdout and remain errors, never evidence that a remote
branch is absent. Existing publication receipts preserve unknown write outcomes
when a subsequent read fails.

POSIX execution uses one disposable process group for Git and its transport
helpers, terminated on deadline and drained after exit, without a Node supervisor
process. Windows uses a disposable supervisor with native task-tree termination.
Its parent watchdog also terminates the supervisor;
no persistent service or third-party runtime is introduced. Node injection
variables are removed from the supervisor environment; Git's existing sanitized
authentication environment is retained.

`remoteReadTimeoutMs` can narrow the deadline to an integer from 100 to 15000
milliseconds for bounded behavioral checks. Invalid values cannot disable it.
The supervisor's request and each response channel are bounded to 64 KiB.

Verification: `node --test __tests__/remote-read-deadline.test.mjs` checks success,
ordinary failure, a SIGTERM-resistant transport tree, an exited leader with a live helper, output
overflow and invalid
deadlines. Process-group assertions run on POSIX; Windows termination is not
claimed as runtime-tested on a POSIX host. Run the full `npm run check` before
release, including packed hook-runtime integrity and existing exact-ref tests.

The motivating observed failure waited 75 seconds for a Git connection error.
The new deadline bounds that class of wait; it is not a healthy-network throughput
benchmark. It neither provisions Commerce's independent evaluator nor replaces
claim, lease, fence or runtime-identity evidence with a shallow doctor result.
