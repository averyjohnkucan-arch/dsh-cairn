# Cairn boards for DeepSeek Harness

Keep a project board in your DSH chat. A **fact** records an observation, an **intent** links one or more facts to a proposed step, and a **hint** preserves advice for later. When you learn the result of a step, attach the new fact to its intent. You can also record which facts establish the goal.

## Install from GitHub

Open **Plugins → Add plugin** in DeepSeek Harness and paste the repository URL.

```text
https://github.com/averyjohnkucan-arch/dsh-cairn
```

For the DSH web profile, the equivalent CLI command is

```sh
dsh plugin --profile web add https://github.com/averyjohnkucan-arch/dsh-cairn
```

Open a new chat in that profile. The bundle appears as **Cairn boards** and uses your existing model configuration. It ships ready-to-load JavaScript. The standard DSH web profile supplies the Cordis `tools` and `storageDomain` services.

## Try it

> Create a Cairn board called `booklet` titled “Print a field guide.” I have a draft PDF. My goal is a legible printed booklet.

> Add a hint to use recycled paper. Propose printing one sample from the starting fact.

> I printed it. The map labels were legible. Record that as the fact concluding the sample-print intent, then show me the board.

DeepSeek uses two tools.

| Tool | What you can ask for |
| --- | --- |
| `cairn_board` | List boards, create or show a named board, import Cairn YAML into a new board, or export a snapshot. |
| `cairn_entry` | Add a fact or hint, propose an intent from fact IDs, conclude that intent with an observed fact, or link evidence to the goal. |

The starting and goal facts are named `origin` and `goal`. Showing the board returns fact and intent IDs. Each page includes up to 12 entries of each kind. Importing uses a new board name so the existing board stays available.

## Storage and interchange

Boards persist in the host’s configured Harness storage backend. Chats with the same working directory see the same boards on that host. A chat with no working directory gets its own boards. To move one, ask for a YAML export and paste the YAML into a chat in the destination workspace.

The importer accepts the project, facts, hints, and intents from Cairn’s YAML export, up to 1 MiB per import. It preserves multiple source facts, pending and concluded intents, and their author and timestamp fields. Cairn omits intent IDs from its YAML, so the plugin assigns display IDs in export order. Newly recorded timestamps use UTC. Worker names and bootstrap settings in imported snapshots are historical data. The tools store and display board entries locally. Proposed steps stay on the board for a person to carry out.

## Development

Use Node.js 24.9 or later.

```sh
npm ci
npm test
```

This independent Cordis implementation adapts Cairn’s board model and YAML format. It is distributed under the GNU Affero General Public License v3. [Upstream Cairn](https://github.com/oritera/Cairn) · [Upstream YAML exporter](https://github.com/oritera/Cairn/blob/8e7e0ea67552383851dfcabfba0c4e9c8d007878/cairn/src/cairn/server/routers/export.py) · [License](LICENSE)
