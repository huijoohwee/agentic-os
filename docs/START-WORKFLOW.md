# Start

`release:common start <scope> --write=<paths>`; new work uses committed `--plan`. Five slots/repo,
one checkout/task, no nesting. Resume its mission or clone. [Readmit](../guides/LANE-RECERTIFICATION.md).

START fetches protected ref before checks; failure stops pre-mutation.
[Recovery](../guides/VALIDATION-ECONOMY-EXECUTION.md).

## Static consumer bootstrap

Pin Agentic OS as local dev tooling to a full upstream SHA; never ship it in browser/production:

```sh
npm install --save-dev --save-exact agentic-os@git+https://github.com/agentic-os/agentic-os.git#<full-commit-sha>
npm exec -- agentic-os setup
npm exec -- agentic-os doctor
```

Reuse the pin for `start`, `run`, release; setup/doctor verify package and lock. No latest/external
path. Do not ship `node_modules`. Browser: `npm run dev`, then recheck URL; unsupported/headless
is not proof.
