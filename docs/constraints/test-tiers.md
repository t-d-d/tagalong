# Test tiers
Relevance: Adding or moving a test, a fake or a test script, or editing what runs one: **/*.static.ts, **/*.test.ts, **/*.int.ts, test/**, fitness/**, the gate command, .github/workflows/**
Decision: Three tiers kept apart by file suffix, static, unit and integration, which together form an offline, secret-free gate.

Why: The gate is the reviewer, so it must run the same on a laptop and
a standard runner, and never reach WhatsApp, claude.ai or AWS.

## Rules

- A test's suffix fixes its tier: .static.ts static, .test.ts unit,
  .int.ts integration.
- Static reads the repo's own files. Unit touches memory only.
  Integration touches loopback, temporary folders and child processes
  run on them: git, tar, python3 and stand-ins for claude.
- The gate reaches loopback only and holds no secrets. test/offline.ts
  refuses anything else.
- WhatsApp is faked at the bridge's edge: its two SQLite databases with
  the bridge's own tables (test/bridge-db.ts), and its REST API on
  loopback (test/fake-bridge.ts).
- claude.ai is faked at the HTTP edge (test/fake-claude-api.ts), and
  the CLI and launcher by a runner (test/fake-run.ts). The launcher
  itself is tested in a real pseudo-terminal with a stand-in claude.
- AWS is faked behind the service's Aws interface (test/fake-aws.ts).
- The service's real modules are wired by createApp in tests, as in
  main.ts.
- An assertion goes in the lowest tier that can see it.

## Do not

- Call WhatsApp, claude.ai or AWS from the gate.
- Pair a real device in a test.
- Widen a tier's pattern to bare *.ts.
- Add a second test runner.

History: Set when the repo was made, October 2026, following spotimy.
