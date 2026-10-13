# ff-worker

Worker package for ff-kit workspaces. It reads the workspace `ff.config.yaml`, polls the configured task source, writes task dossiers, starts one exact tmux session per task, and sends notifications through the configured one-way channel.

```sh
npx ff-worker --config ./ff.config.yaml
```

Run it through `ff worker start` so a supervisor can restart it after config changes. The worker binds HTTP only to `127.0.0.1`; its bearer token is stored in `.ff/worker.json` with file mode `0600`. Do not share that file.

Node.js 20.10 or newer is required. Build the publishable bundle from the ff-kit repository with `npm run build`.
