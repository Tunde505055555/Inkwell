# Inkwell — AI Storytelling Battle on GenLayer

> A multiplayer, on-chain creative-writing game where an LLM judges stories inside a GenLayer intelligent contract. Every submission, every judgment, and every score is a real, explorer-verifiable transaction.

---

## Table of Contents

1. [What Is Inkwell?](#what-is-inkwell)
2. [Live Deployment](#live-deployment)
3. [Key Features](#key-features)
4. [Architecture Overview](#architecture-overview)
5. [The Smart Contract](#the-smart-contract)
6. [The Frontend](#the-frontend)
7. [GenLayer Integration](#genlayer-integration)
8. [Game Flow](#game-flow)
9. [New Features & Improvements](#new-features--improvements)
10. [Getting Started (Local Dev)](#getting-started-local-dev)
11. [Deploying Your Own Contract](#deploying-your-own-contract)
12. [Project Structure](#project-structure)
13. [Tech Stack](#tech-stack)
14. [Troubleshooting](#troubleshooting)
15. [License](#license)

---

## What Is Inkwell?

Inkwell is a **decentralized AI storytelling battle**.

1. A prompt is posted on-chain (e.g. *"The lighthouse keeper opened the door beneath the waves..."*).
2. Players submit micro-stories (10–600 characters) as real blockchain transactions.
3. When at least two stories are in, anyone can trigger the **AI judge**.
4. The judge is not a server — it is an **LLM running inside the GenLayer smart contract** via the *equivalence principle* (consensus across multiple validators).
5. The contract scores every story on **creativity**, **prompt fit**, and **imagery** (0–10 each), then deterministically awards the win to the highest total score. Ties are allowed — multiple winners can share the round.
6. A global scoreboard tracks cumulative wins across all rounds.

---

## Live Deployment

| Resource | URL |
|----------|-----|
| **Frontend (Published)** | https://inkwell-game.lovable.app |
| **GenLayer Explorer** | https://explorer-studio.genlayer.com |
| **Live Contract** | `0x856C0d737d9b52aEc5A32cA9d4E10d1161A02C91` |
| **RPC Endpoint** | `https://studio.genlayer.com/api` |
| **Chain ID** | `61999` (`0xF22F`) |

---

## Key Features

### Multiplayer & Multi-Winner Support
- Any number of wallets can submit stories to the same round.
- The AI judge scores every story individually.
- **Multiple players can win** if their total scores tie for the highest.
- All winners are stored on-chain in a `DynArray[Address]`.

### Per-Story Scorecards
After judging, every submission is displayed with:
- The author's wallet address (linked to the explorer)
- The full story text
- Three animated score bars: **Creativity**, **Prompt Fit**, **Imagery** (0–10)
- A one-sentence AI critique
- Total score out of 30
- A "Winner" badge for tied top scorers

### Round-Based Gameplay
- Each round has an **on-chain prompt**.
- Rounds can be **open** (accepting submissions) or **closed** (judged).
- After a round is judged, anyone can **start a new round** by posting a fresh prompt.
- Round ID, status, and prompt are visible in the UI in real time.

### Deterministic Winner Computation
The contract does **not** rely on the LLM to name a winner. Instead:
- The LLM returns scores for every story.
- The contract **deterministically adds** the three category scores.
- All addresses tied for the `max_total` are awarded a win point.
- This reduces the chance of `UNDETERMINED` consensus results.

### Robust Verdict Polling
- After triggering the judge, the UI waits up to **5 minutes** for the transaction to finalize.
- If the verdict is not yet readable, a **"Refresh verdict"** button lets users re-read the on-chain result at any time.
- The verdict auto-loads on page mount if it already exists.

### Wallet Integration
- One-click **MetaMask connect**.
- One-click **GenLayer testnet** network switch/add.
- Connected wallet address shown in the header with a live pulse indicator.

### On-Chain Transaction Log
Every action (`submit_story`, `judge_round`, `start_new_round`) is logged in the UI with:
- Transaction hash (shortened)
- Timestamp
- Direct link to the GenLayer explorer

### Dark Editorial UI
- Deep ink palette with electric mint (`#3ECF8E`) and amber (`#F2C94C`) accents.
- Fraunces serif display font + JetBrains Mono for code/data.
- Framer Motion animations for cards, score bars, and verdict reveals.
- Responsive layout (mobile-first, up to 6-column desktop grid).

---

## Architecture Overview

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────────┐
│   React 19 UI   │──────│  genlayer-js SDK │──────│  GenLayer Studio    │
│  (TanStack Start)│      │  (RPC + wallet)  │      │  (Intelligent       │
│                 │      │                  │      │   Contract Engine)  │
└─────────────────┘      └──────────────────┘      └─────────────────────┘
                                                        │
                                                        ▼
                                              ┌──────────────────┐
                                              │  StoryBattle.py  │
                                              │  (LLM judge via  │
                                              │   eq_principle)  │
                                              └──────────────────┘
```

---

## The Smart Contract

**File:** `contracts/StoryBattle.py`

**Language:** Python (GenLayer / py-genlayer)

**Deployed Address:** `0x856C0d737d9b52aEc5A32cA9d4E10d1161A02C91`

### State Variables

| Variable | Type | Description |
|----------|------|-------------|
| `round_id` | `u256` | Current round number |
| `prompt` | `str` | The active round's writing prompt |
| `is_open` | `bool` | Whether submissions are accepted |
| `is_judged` | `bool` | Whether the round has been judged |
| `winner` | `Address` | Primary winner address |
| `winners` | `DynArray[Address]` | All tied winners |
| `winning_story` | `str` | The winning story text |
| `judge_reasoning` | `str` | One-sentence AI summary |
| `result` | `str` | Full JSON result string |
| `verdicts_json` | `str` | Per-story verdicts as JSON |
| `authors` | `DynArray[Address]` | Submitters this round |
| `stories` | `TreeMap[Address, str]` | Address → story mapping |
| `scoreboard_keys` | `DynArray[Address]` | All-time players |
| `scores` | `TreeMap[Address, u256]` | Cumulative win count |

### Methods

#### `submit_story(story: str)` — `@gl.public.write`
- Validates length (10–600 chars).
- Validates round is open.
- Stores or overwrites the sender's story.

#### `judge_round()` → `str` — `@gl.public.write`
- Closes the round.
- Builds an LLM prompt that scores every story on creativity, prompt fit, and imagery.
- Uses `gl.eq_principle.prompt_comparative()` for validator consensus.
- Parses JSON safely, normalizes scores to 0–10.
- Computes total scores deterministically.
- Awards +1 win to every tied top scorer.
- Emits `JudgeCompleted` event with the full JSON result.

#### `start_new_round(new_prompt: str)` — `@gl.public.write`
- Validates current round is judged.
- Resets all round-specific state.
- Clears submissions.
- Opens round with the new prompt.

#### `get_state()` → `dict` — `@gl.public.view`
- Returns full contract state: round info, submissions, scoreboard, verdicts.

#### `getResult()` → `str` — `@gl.public.view`
- Returns the raw JSON result string from the latest judged round.

### LLM Judging Prompt

The contract instructs the LLM to:
- **Not choose a winner** — only score each story.
- Return strict JSON with one `verdict` object per story.
- Each verdict contains: `author`, `scores` (creativity, prompt_fit, imagery), and `critique`.

This design choice is critical: because the winner is computed by the contract (not the model), validator disagreement on exact wording or ranking does not block consensus. Only the numeric scores need to be structurally valid.

---

## The Frontend

**Framework:** TanStack Start v1 (React 19, Vite 7, file-based routing)

**Main Route:** `src/routes/index.tsx` (~811 lines)

### Sections

| Section | Description |
|---------|-------------|
| **Header** | Logo, wallet connect / address pill, explorer link |
| **Hero** | Tagline, description, chain info |
| **Network Card** | Chain ID, RPC, explorer — one-click add-to-wallet |
| **Contract Card** | Live contract address with copy button + explorer link |
| **Compose Card** | Round status banner, story textarea, submit/judge/refresh buttons, new-round panel |
| **Tx Feed** | Scrollable list of recent on-chain actions with explorer links |
| **AI Verdict** | Animated reveal of winners, scorecards, and critiques |
| **Footer** | "Built on GenLayer" tag |

### State Management

- `address` — connected wallet
- `story` / `newPrompt` — form inputs
- `txs` — transaction history (persisted to `localStorage`)
- `roundState` — live contract state (`get_state`)
- `judgeResult` — parsed AI verdict
- `judgeError` — human-readable error if judging fails
- `busy` — loading state for each action

---

## GenLayer Integration

**File:** `src/lib/genlayer.ts`

### Types

```typescript
export type StoryScores = {
  creativity: number;
  prompt_fit: number;
  imagery: number;
};

export type StoryVerdict = {
  author: string;
  story: string;
  scores: StoryScores;
  total: number;
  critique: string;
};

export type JudgeResult = {
  winner: string;
  winners: string[];
  scores: StoryScores;
  reason: string;
  verdicts: StoryVerdict[];
};

export type JudgeTxStatus = {
  hash: string;
  status?: string;
  execution?: string;
  finalized: boolean;
  succeeded: boolean;
  undetermined: boolean;
};
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `connectWallet()` | MetaMask connect + chain switch |
| `ensureChain()` | Add/switch to GenLayer Studio testnet |
| `sendGenLayerTx()` | Send write transactions via `genlayer-js` |
| `readGenLayerView()` | Call read-only `@gl.public.view` methods |
| `fetchJudgeResult()` | Try `getResult()`, fall back to `get_state()` |
| `pollJudgeResult()` | Poll `fetchJudgeResult` until verdict appears |
| `waitForJudgeTx()` | Wait for `FINALIZED` status, detect `UNDETERMINED` |
| `waitForReceipt()` | Standard Ethereum receipt polling |
| `shortAddr()` | `0x1234…5678` formatting |

---

## Game Flow

### 1. Connect Wallet
User clicks **Connect** → MetaMask opens → GenLayer testnet is added/switched automatically.

### 2. Submit Story
- User types a story (10–600 chars).
- UI checks if round is open. If closed, shows error: "This round is closed. Start a new round."
- `submit_story` transaction is sent.
- Transaction appears in the on-chain log.
- UI refreshes `roundState` to show the new submission.

### 3. Trigger AI Judge
- Button is disabled until ≥2 submissions exist.
- `judge_round` transaction is sent.
- UI shows "The chain is deliberating..." with a spinner.
- `waitForJudgeTx` polls for up to 5 minutes:
  - If `UNDETERMINED`: shows error advising to retry.
  - If failed: shows error advising to retry.
  - If succeeded: calls `pollJudgeResult` for up to 4 minutes to read the verdict.
- Verdict appears with all scorecards.

### 4. Start New Round
- After judging, a panel appears below the compose card.
- Anyone can enter a new prompt (5+ chars) and click **Start new round**.
- `start_new_round` resets the contract state.
- UI clears the old verdict and refreshes to the new round.

---

## New Features & Improvements

This README documents the **current, fully-evolved version** of Inkwell. The following improvements were made over successive iterations:

### 1. Multi-Winner (Tie) Support
- The contract now stores **all** top-scoring addresses in `winners: DynArray[Address]`.
- The UI displays multiple winner badges when scores tie.
- Each tied winner receives +1 on the global scoreboard.

### 2. Per-Story Scorecards
- Every submission is shown with its full text, three category scores, total, and critique.
- Score bars animate from 0 to final value using Framer Motion.
- Cards are sorted by total score (highest first).
- Winner cards have an amber accent border; non-winners have a neutral border.

### 3. Deterministic Winner Computation
- The LLM no longer names a winner. It only returns scores.
- The contract adds `creativity + prompt_fit + imagery` for each story.
- All addresses with `max_total` win. This removes ambiguity from consensus.

### 4. Round State Management
- `round_id`, `is_open`, `is_judged`, and `prompt` are tracked on-chain.
- The UI shows a live status banner: "Round N · open for submissions" or "closed (judged)".
- Submissions to closed rounds are blocked client-side with a clear error message.

### 5. Start New Round Flow
- A dedicated panel appears only when `is_judged === true`.
- Any connected wallet can initiate the next round.
- The old verdict is cleared, and the UI transitions smoothly to the new round.

### 6. Robust Verdict Polling
- `pollJudgeResult` timeout increased from 90s → **240s**.
- `waitForJudgeTx` added with **300s** timeout to catch `UNDETERMINED` before reading.
- Verdict auto-loads on mount if already present on-chain.
- "Refresh verdict" button allows manual re-reading at any time.

### 7. Dual Read Strategy
`fetchJudgeResult` tries two paths:
1. `getResult()` — direct result string.
2. `get_state()` — assembled from individual fields with fallbacks for `winners`, `scores`, and `verdicts`.

### 8. JSON Safety
- `safeParseJudgeResult` handles both `string` and `object` inputs.
- Strips markdown code fences (` ```json ... ``` `).
- Normalizes snake_case and camelCase score keys.
- Falls back to winner's verdict scores if top-level `scores` is missing.

### 9. Explorer Integration
- Every wallet address and transaction hash is a clickable link to the GenLayer explorer.
- Network card shows RPC and explorer URLs for manual verification.

---

## Getting Started (Local Dev)

### Prerequisites
- [Bun](https://bun.sh/) (or Node.js 20+)
- MetaMask browser extension

### Install

```bash
bun install
```

### Run Dev Server

```bash
bun run dev
```

The app will be available at `http://localhost:8080`.

### Build

```bash
bun run build
```

---

## Deploying Your Own Contract

1. Open [GenLayer Studio](https://studio.genlayer.com).
2. Create a new intelligent contract.
3. Paste the contents of `contracts/StoryBattle.py`.
4. Deploy with an initial prompt (e.g. `"The lighthouse keeper opened the door beneath the waves..."`).
5. Copy the deployed contract address.
6. In `src/routes/index.tsx`, update `DEFAULT_CONTRACT` to your new address.
7. Redeploy the frontend (or run locally).

---

## Project Structure

```
inkwell/
├── contracts/
│   └── StoryBattle.py          # GenLayer intelligent contract (Python)
├── src/
│   ├── components/ui/          # shadcn/ui components (50+)
│   ├── hooks/
│   │   └── use-mobile.tsx
│   ├── lib/
│   │   ├── genlayer.ts         # GenLayer SDK wrapper + types
│   │   └── utils.ts            # cn() helper
│   ├── routes/
│   │   ├── __root.tsx          # Root layout (SEO, fonts, shell)
│   │   └── index.tsx           # Main Inkwell UI
│   ├── router.tsx              # TanStack Router setup
│   ├── routeTree.gen.ts        # Auto-generated route tree
│   └── styles.css              # Tailwind v4 design system (dark theme)
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md                   # This file
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | TanStack Start v1 (React 19, Vite 7) |
| **Styling** | Tailwind CSS v4, oklch color tokens |
| **UI Kit** | shadcn/ui (Radix + Tailwind) |
| **Animations** | Framer Motion |
| **Blockchain** | GenLayer Studio (chain ID 61999) |
| **SDK** | `genlayer-js` v1.1.7 |
| **Wallet** | MetaMask via `ethers` v6 BrowserProvider |
| **Icons** | Lucide React |
| **Toast** | Sonner |
| **Fonts** | Fraunces (display), JetBrains Mono (mono) |

---

## Troubleshooting

### "Round is closed" when submitting
The current round has already been judged. Use the **Start new round** panel to open a new round with a fresh prompt.

### "UNDETERMINED" after judging
The LLM consensus could not agree on a valid output. This is rare with the deterministic scoring design. Click **Trigger AI judge** again to retry.

### Verdict not appearing after judge transaction
The transaction may have succeeded but the verdict isn't parsed yet. Click **Refresh verdict** after ~30 seconds.

### MetaMask not connecting
Ensure MetaMask is unlocked and you are on the GenLayer Studio testnet (chain ID 61999). Use the **Add / switch to GenLayer** button.

### Contract address not found
The default contract is deployed on GenLayer Studio. If you deploy your own, update `DEFAULT_CONTRACT` in `src/routes/index.tsx`.

---

## License

MIT — feel free to fork, remix, and deploy your own storytelling battles.

---

*Built with ❤️ on GenLayer — intelligent contracts with LLM consensus.*
