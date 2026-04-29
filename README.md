# Inkwell — AI Storytelling Battle on GenLayer

Inkwell is a fully on-chain **AI Storytelling Battle** built on top of [GenLayer](https://genlayer.com) "Intelligent Contracts." Players submit short stories for a shared prompt, and an LLM running **inside** the smart contract — judged by GenLayer validator consensus — picks the winner. Wins accumulate on a transparent, on-chain scoreboard.

> Live preview: https://inkwell-game.lovable.app

---

## ✨ What makes Inkwell special

Most "AI dApps" call an LLM off-chain and then push the result onto a smart contract. Inkwell does the opposite: the LLM call is part of the contract execution itself. Every validator runs the model, and consensus is reached using GenLayer's **equivalence principle**, so the verdict is as trust-minimized as any other on-chain state transition.

- 🧠 **AI judging inside the contract** via `gl.nondet.exec_prompt`
- ⚖️ **Semantic consensus** via `gl.eq_principle.prompt_comparative` (no flaky `strict_eq` failures on creative JSON)
- 🏆 **Persistent on-chain scoreboard** that survives across rounds
- 🔁 **Multi-round play** — anyone can start a new round once the current one is judged
- 🎨 **Polished React frontend** with wallet connection, live state polling, and explorer links

---

## 🧱 Architecture

```
┌──────────────────────────┐        ┌─────────────────────────────┐
│   React + TanStack Start │        │   GenLayer Studio Network   │
│   (src/routes/index.tsx) │ ─────▶ │   StoryBattle.py contract   │
│                          │        │   - submit_story            │
│   genlayer-js + ethers   │ ◀───── │   - judge_round (LLM call)  │
│   MetaMask wallet        │        │   - get_state / getResult   │
└──────────────────────────┘        └─────────────────────────────┘
```

### Smart contract — `contracts/StoryBattle.py`

A GenLayer Python "Intelligent Contract" with state for:

- `round_id`, `prompt`, `is_open`, `is_judged`
- `authors` + `stories` (per-round submissions)
- `winner`, `winning_story`, `judge_reasoning`, `result`
- `scoreboard_keys` + `scores` (cross-round wins)

Key entry points:

| Method | Type | Description |
| --- | --- | --- |
| `submit_story(story)` | write | Submit / overwrite your story for the current round (10–600 chars). |
| `judge_round()` | write | Triggers the LLM to read all submissions and pick a winner. Requires ≥ 2 submissions. |
| `start_new_round(prompt)` | write | After judging, opens a fresh round with a new prompt. |
| `get_state()` | view | Returns the full round state, submissions, and scoreboard. |
| `getResult()` | view | Returns the latest judging result JSON. |

The judging prompt asks the model to score on **creativity**, **prompt fit**, and **imagery**, and to respond with strict JSON. The contract then:

1. Runs `gl.eq_principle.prompt_comparative(judge, "...")` so validators agree on the *same winner* without needing byte-identical text.
2. Safely parses the JSON, falling back to a deterministic default instead of reverting on malformed model output.
3. Increments the winner's score and emits a `JudgeCompleted` event.

### Frontend — `src/`

- **TanStack Start v1** (React 19, Vite 7) with file-based routing.
- **`src/lib/genlayer.ts`** — wallet connection, chain switching, `genlayer-js` write calls, JSON-RPC reads, judge-result polling.
- **`src/routes/index.tsx`** — the entire game UI: prompt display, story composer, submissions list, AI verdict panel, scoreboard, and tx history.
- **Tailwind v4 + shadcn/ui** for a clean, themed UI driven by semantic tokens in `src/styles.css`.

---

## 🌐 Network

| Field | Value |
| --- | --- |
| Chain | GenLayer Studio |
| Chain ID | `61999` (`0xF22F`) |
| RPC | `https://studio.genlayer.com/api` |
| Explorer | `https://explorer-studio.genlayer.com` |

The frontend will prompt MetaMask to add / switch to this chain automatically.

**Default deployed contract:** `0xdC6595506b8542d94f2d305464367bED7434dE9F`

You can paste a different contract address in the UI to point Inkwell at your own deployment.

---

## 🚀 Getting started locally

### Prerequisites

- [Bun](https://bun.sh) (or npm / pnpm)
- A wallet such as MetaMask
- Two wallet accounts (you need at least 2 different addresses to trigger judging)

### Install & run

```bash
bun install
bun run dev
```

Open the printed local URL, connect your wallet, and approve the network switch to GenLayer Studio.

### Build for production

```bash
bun run build
```

The app deploys cleanly to any edge host that runs the TanStack Start build output (Cloudflare Workers compatible).

---

## 🧙 Deploying your own StoryBattle contract

The contract source lives at [`contracts/StoryBattle.py`](./contracts/StoryBattle.py).

1. Open the [GenLayer Studio](https://studio.genlayer.com).
2. Paste the contents of `StoryBattle.py` into the editor.
3. Deploy with a constructor argument — the first round's prompt, e.g.:
   ```
   "Write a 3-sentence story about a lighthouse that whispers to ships."
   ```
4. Copy the deployed contract address.
5. In the Inkwell UI, paste the address into the **Contract** field and hit *Use*.

> ℹ️ The contract uses `gl.eq_principle.prompt_comparative` instead of `strict_eq` — this is what prevents the dreaded `Transaction ended with status: UNDETERMINED`, since validators rarely produce byte-identical creative JSON.

---

## 🎮 How to play (with two wallets)

You need **two wallet accounts** because `judge_round()` requires at least 2 submissions.

### Setup

1. In MetaMask, make sure you have **Account A** and **Account B** (or two different wallets / browser profiles).
2. Both accounts need a small amount of GenLayer Studio test ETH for gas. Use the studio faucet if needed.

### Step-by-step

1. **Open Inkwell** and click **Connect Wallet**. Approve the network switch.
2. **Account A** — Switch to your first account in MetaMask. Read the round's prompt, write a short story (10–600 chars), and click **Submit Story**. Confirm the transaction.
3. **Account B** — In MetaMask, switch to your second account. The site will pick up the new account on the next interaction (or click *Connect Wallet* again). Submit a different story.
4. **Trigger AI judge** — With either account, click **Trigger AI Judge**. This calls `judge_round()`, which:
   - Closes the round
   - Runs the LLM across all validators
   - Reaches consensus on the winner
   - Updates the on-chain scoreboard
5. **View the verdict** — Once the tx is finalized, Inkwell polls the contract and shows:
   - Winning address + story
   - Per-category scores (creativity / prompt fit / imagery)
   - The model's one-line reasoning
6. **Start a new round** — Anyone can call **Start New Round** with a fresh prompt to keep playing. Scores persist across rounds.

### Tips

- Keep stories punchy and within 10–600 characters.
- If a tx shows `UNDETERMINED`, you're likely on an older contract that still uses `strict_eq`. Redeploy `StoryBattle.py` (the latest version uses `prompt_comparative`).
- Click any tx hash in the **History** panel to open it on the GenLayer explorer.

---

## 🛠 Project structure

```
.
├── contracts/
│   └── StoryBattle.py          # GenLayer Intelligent Contract
├── src/
│   ├── lib/genlayer.ts         # Wallet, RPC, polling helpers
│   ├── routes/
│   │   ├── __root.tsx          # Root layout
│   │   └── index.tsx           # Inkwell game UI
│   ├── components/ui/          # shadcn/ui primitives
│   └── styles.css              # Tailwind v4 tokens & theme
├── package.json
├── vite.config.ts
└── README.md
```

---

## 🧪 Tech stack

- **GenLayer** — Intelligent Contracts (Python) + `genlayer-js` client
- **React 19 + TanStack Start v1** — SSR-ready file-based routing
- **Vite 7** — Build tool
- **Tailwind CSS v4** + **shadcn/ui** — Styling and components
- **framer-motion** — Animations
- **ethers v6** — Wallet/provider plumbing
- **sonner** — Toasts

---

## 🐛 Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Need at least 2 submissions` on judge | Only one wallet has submitted | Switch accounts in MetaMask and submit a second story |
| `Transaction ended with status: UNDETERMINED` | Contract uses `strict_eq` for LLM output | Redeploy with the current `StoryBattle.py` (`prompt_comparative`) |
| `No wallet detected` | MetaMask not installed / not selected | Install MetaMask or enable it for this site |
| Wrong network | Wallet not on chain `61999` | Click **Connect Wallet** — the site adds/switches to GenLayer Studio |
| Verdict never appears | Validators still finalizing | Wait ~30–90s; the UI polls `getResult()` / `get_state()` automatically |

---


---

## 🙌 Credits

Built with [Lovable](https://lovable.dev) on top of the [GenLayer](https://genlayer.com) protocol. Stories judged by an LLM that, for once, actually has to live with its decisions on-chain.
