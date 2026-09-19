# Release workflow

1. Reuse bound proof; run affected checks once.
2. `npm run release:common -- publish --message="<message>"`  
   Land the exact checked diff by protected integration; default squash.
3. Wait for merge.
4. `npm run release:common -- finish --ref=<lane>`  
   `finish --ref=<lane>` retains refs.

- `npm run successor -- <scope> --expected-head=<published-head>` only after publish.
- [Cleanup](LIFECYCLE-COMPLETION.md), sync/deploy/rollback need separate receipts.
- Apply the global prompt and handover.
- Forbid unchanged repetition, recursion, duplicate/conflicting/overlapping execution.
- continue covered owner actions to authenticated live verification and the terminal release receipt; report gaps.
