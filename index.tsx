import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Wallet,
  ExternalLink,
  Trophy,
  Feather,
  Loader2,
  Copy,
  Check,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";

import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  GENLAYER_CHAIN,
  type JudgeResult,
  connectWallet,
  ensureChain,
  explorerAddress,
  explorerBlocks,
  explorerTx,
  fetchJudgeResult,
  pollJudgeResult,
  readGenLayerView,
  sendGenLayerTx,
  shortAddr,
  waitForJudgeTx,
} from "@/lib/genlayer";

export const Route = createFileRoute("/")({
  component: Inkwell,
});

const DEFAULT_CONTRACT = "0x856C0d737d9b52aEc5A32cA9d4E10d1161A02C91";

type TxRecord = { hash: string; label: string; ts: number };
type StoryBattleState = {
  submissions?: unknown[];
  is_judged?: boolean;
  is_open?: boolean;
  round_id?: number;
  prompt?: string;
};

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error !== "object" || error === null) return fallback;
  const maybeError = error as { shortMessage?: unknown; message?: unknown };
  if (typeof maybeError.shortMessage === "string") return maybeError.shortMessage;
  if (typeof maybeError.message === "string") return maybeError.message;
  return fallback;
}

function Inkwell() {
  const [address, setAddress] = useState<string>("");
  const contractAddress = DEFAULT_CONTRACT;
  const [story, setStory] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [copied, setCopied] = useState(false);
  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  const [judging, setJudging] = useState(false);
  const [roundState, setRoundState] = useState<StoryBattleState | null>(null);
  const [newPrompt, setNewPrompt] = useState("");

  // Hydrate tx log from localStorage on client only
  useEffect(() => {
    try {
      setTxs(JSON.parse(localStorage.getItem("inkwell:txs") ?? "[]"));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("inkwell:txs", JSON.stringify(txs.slice(0, 20)));
  }, [txs]);

  useEffect(() => {
    if (window.ethereum?.selectedAddress) setAddress(window.ethereum.selectedAddress);
    const handler = (accs: string[]) => setAddress(accs[0] ?? "");
    window.ethereum?.on?.("accountsChanged", handler);
    return () => window.ethereum?.removeListener?.("accountsChanged", handler);
  }, []);

  const loadState = async () => {
    try {
      const s = await readGenLayerView<StoryBattleState>({
        contractAddress,
        method: "get_state",
      });
      if (s) setRoundState(s);
      return s;
    } catch {
      return null;
    }
  };

  // Auto-load any existing verdict + round state from the contract on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await fetchJudgeResult(contractAddress);
        if (!cancelled && v && (v.verdicts.length > 0 || v.reason || v.winner)) {
          setJudgeResult(v);
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) await loadState();
    })();
    return () => {
      cancelled = true;
    };
  }, [contractAddress]);

  const onConnect = async () => {
    try {
      setBusy("connect");
      const { address } = await connectWallet();
      setAddress(address);
      toast.success("Wallet connected", { description: shortAddr(address) });
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Failed to connect"));
    } finally {
      setBusy(null);
    }
  };

  const onAddNetwork = async () => {
    try {
      setBusy("network");
      await ensureChain();
      toast.success(`Switched to ${GENLAYER_CHAIN.name}`);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Failed to switch network"));
    } finally {
      setBusy(null);
    }
  };

  const send = async (method: string, args: unknown[], label: string) => {
    if (!contractAddress) {
      toast.error("Paste your deployed contract address first");
      return;
    }
    try {
      setBusy(method);
      const hash = await sendGenLayerTx({ contractAddress, method, args });
      const rec: TxRecord = { hash, label, ts: Date.now() };
      setTxs((prev) => [rec, ...prev]);
      toast.success(`${label} submitted`, {
        description: shortAddr(hash),
        action: {
          label: "Verify",
          onClick: () => window.open(explorerTx(hash), "_blank"),
        },
      });
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Transaction failed"));
    } finally {
      setBusy(null);
    }
  };

  const onSubmitStory = async () => {
    if (story.trim().length < 10) return toast.error("Story must be at least 10 chars");
    if (roundState && roundState.is_open === false) {
      return toast.error("This round is closed", {
        description: "Start a new round below before submitting a new story.",
      });
    }
    await send("submit_story", [story.trim()], "Submit story");
    loadState();
  };

  const onStartNewRound = async () => {
    if (newPrompt.trim().length < 5) return toast.error("Prompt must be at least 5 chars");
    await send("start_new_round", [newPrompt.trim()], "Start new round");
    setNewPrompt("");
    setJudgeResult(null);
    setJudgeError(null);
    // Give the chain a moment, then refresh
    setTimeout(loadState, 1500);
  };

  const onJudge = async () => {
    if (!contractAddress) return toast.error("No contract address set");
    setJudgeError(null);
    setJudgeResult(null);
    try {
      setBusy("judge_round");
      const state = await readGenLayerView<StoryBattleState>({
        contractAddress,
        method: "get_state",
      });
      const submissionCount = Array.isArray(state?.submissions) ? state.submissions.length : 0;
      if (state?.is_judged) {
        setBusy(null);
        setJudging(true);
        const verdict = await pollJudgeResult(contractAddress, 15_000);
        if (verdict) {
          setJudgeResult(verdict);
          toast.success("AI verdict loaded", { description: shortAddr(verdict.winner) });
        } else {
          setJudgeError("This round is already judged, but the verdict could not be read yet.");
        }
        return;
      }
      if (!state?.is_judged && submissionCount < 2) {
        const message = `Need at least 2 story submissions before judging. Current submissions: ${submissionCount}.`;
        setJudgeError(message);
        toast.error("Not enough stories", {
          description: "Submit from two different wallets, then trigger the AI judge.",
        });
        return;
      }
      const hash = await sendGenLayerTx({ contractAddress, method: "judge_round", args: [] });
      const rec: TxRecord = { hash, label: "Judge round", ts: Date.now() };
      setTxs((prev) => [rec, ...prev]);
      toast.success("Judge round submitted", {
        description: shortAddr(hash),
        action: { label: "Verify", onClick: () => window.open(explorerTx(hash), "_blank") },
      });
      setBusy(null);
      setJudging(true);
      const status = await waitForJudgeTx(hash, 300_000);
      await loadState();
      if (status?.undetermined) {
        setJudgeError(
          "The judge transaction ended undetermined in consensus, so no winning verdict was accepted on-chain. Trigger the AI judge again for this round.",
        );
        return;
      }
      if (status && !status.succeeded) {
        setJudgeError(
          "The judge transaction finalized, but the contract did not accept a verdict. Trigger the AI judge again for this round.",
        );
        return;
      }
      const verdict = await pollJudgeResult(contractAddress, 120_000);
      if (verdict) {
        setJudgeResult(verdict);
        toast.success("AI verdict in", { description: shortAddr(verdict.winner) });
      } else {
        setJudgeError(
          "The judge transaction finalized, but the verdict is not readable yet. Use Refresh verdict in a moment.",
        );
      }
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Transaction failed"));
    } finally {
      setBusy(null);
      setJudging(false);
    }
  };

  const refreshVerdict = async () => {
    if (!contractAddress) return;
    try {
      setBusy("refresh");
      setJudgeError(null);
      const verdict = await fetchJudgeResult(contractAddress);
      if (verdict && (verdict.verdicts.length > 0 || verdict.reason || verdict.winner)) {
        setJudgeResult(verdict);
        toast.success("Verdict refreshed", {
          description: verdict.winner ? shortAddr(verdict.winner) : undefined,
        });
      } else {
        setJudgeError(
          "The contract hasn't published a verdict yet. The LLM consensus can take a few minutes — try again shortly.",
        );
        toast.message("No verdict yet", { description: "Try refreshing again in ~30s." });
      }
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Failed to read verdict"));
    } finally {
      setBusy(null);
    }
  };

  const copyContract = () => {
    navigator.clipboard.writeText(contractAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="min-h-screen text-foreground">
      <Toaster richColors theme="dark" position="top-right" />

      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[var(--shadow-glow)]">
            <Feather className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-xl font-semibold">Inkwell</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              GenLayer · chain {GENLAYER_CHAIN.chainId}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={explorerBlocks}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 font-mono text-xs text-muted-foreground transition hover:text-foreground sm:flex"
          >
            Explorer <ExternalLink className="h-3 w-3" />
          </a>
          {address ? (
            <a
              href={explorerAddress(address)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-xs text-primary"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              {shortAddr(address)}
            </a>
          ) : (
            <Button onClick={onConnect} disabled={busy === "connect"} size="sm">
              {busy === "connect" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wallet className="h-4 w-4" />
              )}
              Connect
            </Button>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pt-6 pb-12 sm:pt-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            <Sparkles className="h-3 w-3 text-primary" /> AI judges every round on-chain
          </div>
          <h1 className="font-display text-5xl font-semibold leading-[0.95] sm:text-7xl">
            Write a story.
            <br />
            <span className="italic text-primary">Let the chain</span> decide.
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
            Inkwell is an AI Storytelling Battle built as a GenLayer intelligent contract. Submit
            your micro-story, then trigger an LLM-powered judge that runs inside the contract via
            the equivalence principle. Every move is a real, explorer-verifiable transaction on
            chain {GENLAYER_CHAIN.chainId}.
          </p>
        </motion.div>
      </section>

      {/* Setup card */}
      <section className="mx-auto grid max-w-6xl gap-5 px-5 lg:grid-cols-5">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
          className="lg:col-span-2 rounded-3xl border border-border bg-card/70 p-6 backdrop-blur-sm shadow-[var(--shadow-card)]"
        >
          <div className="mb-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Network
          </div>
          <h2 className="font-display text-2xl font-semibold">Network</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Add the GenLayer testnet to your wallet. RPC and chain id are pre-configured.
          </p>
          <dl className="mt-5 space-y-2 font-mono text-xs">
            <Row k="Chain ID" v={String(GENLAYER_CHAIN.chainId)} />
            <Row k="RPC" v={GENLAYER_CHAIN.rpcUrl} small />
            <Row k="Explorer" v={GENLAYER_CHAIN.explorer} small />
          </dl>
          <Button
            onClick={onAddNetwork}
            disabled={busy === "network"}
            variant="secondary"
            className="mt-5 w-full"
          >
            {busy === "network" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Add / switch to GenLayer
          </Button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="lg:col-span-3 rounded-3xl border border-border bg-card/70 p-6 backdrop-blur-sm shadow-[var(--shadow-card)]"
        >
          <div className="mb-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Live contract
          </div>
          <h2 className="font-display text-2xl font-semibold">StoryBattle</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The intelligent contract powering this battle is already live on GenLayer Studio. Every
            story you submit is judged on-chain by an LLM running inside the contract.
          </p>
          <div className="mt-4 rounded-2xl border border-border bg-background/40 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <code className="truncate font-mono text-sm text-primary">{contractAddress}</code>
              <Button
                variant="outline"
                size="icon"
                onClick={copyContract}
                title="Copy contract address"
              >
                {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <a
            href={explorerAddress(contractAddress)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
          >
            View on explorer <ExternalLink className="h-3 w-3" />
          </a>
        </motion.div>
      </section>

      {/* Game */}
      <section className="mx-auto mt-10 grid max-w-6xl gap-5 px-5 pb-20 lg:grid-cols-5">
        {/* Compose */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="lg:col-span-3 rounded-3xl border border-border bg-card/70 p-6 backdrop-blur-sm shadow-[var(--shadow-card)]"
        >
          <div className="mb-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Step 03 · Your turn
          </div>
          <h2 className="font-display text-3xl font-semibold">Compose your micro-story</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            10–600 characters. The contract's LLM judge will read every entry and pick a winner
            based on creativity, prompt fit, and imagery.
          </p>
          {roundState && (
            <div
              className={`mt-4 rounded-2xl border px-4 py-3 text-xs ${
                roundState.is_open
                  ? "border-primary/40 bg-primary/5 text-primary"
                  : "border-accent/40 bg-accent/5 text-accent"
              }`}
            >
              <div className="font-mono uppercase tracking-widest">
                Round {roundState.round_id ?? "?"} ·{" "}
                {roundState.is_open ? "open for submissions" : "closed (judged)"}
              </div>
              {roundState.prompt && (
                <div className="mt-1 font-display text-sm text-foreground/90">
                  Prompt: “{roundState.prompt}”
                </div>
              )}
            </div>
          )}
          <Textarea
            value={story}
            onChange={(e) => setStory(e.target.value)}
            rows={7}
            maxLength={600}
            placeholder="The lighthouse keeper opened the door beneath the waves and stepped inside…"
            className="mt-4 resize-none font-display text-lg leading-relaxed"
          />
          <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
            <span>{story.length}/600</span>
            <span>signed by {address ? shortAddr(address) : "no wallet"}</span>
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={onSubmitStory}
              disabled={busy === "submit_story" || !address || !contractAddress}
              className="flex-1"
            >
              {busy === "submit_story" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Feather className="h-4 w-4" />
              )}
              Submit story
            </Button>
            <Button
              onClick={onJudge}
              disabled={busy === "judge_round" || judging || !address || !contractAddress}
              variant="outline"
              className="flex-1 border-accent/50 text-accent hover:bg-accent/10 hover:text-accent"
            >
              {busy === "judge_round" || judging ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trophy className="h-4 w-4" />
              )}
              Trigger AI judge
            </Button>
            <Button
              onClick={refreshVerdict}
              disabled={busy === "refresh" || !contractAddress}
              variant="ghost"
              className="sm:w-auto"
              title="Re-read the AI verdict from the contract"
            >
              {busy === "refresh" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh verdict
            </Button>
          </div>

          {roundState && roundState.is_judged && (
            <div className="mt-6 rounded-2xl border border-accent/30 bg-accent/5 p-4">
              <div className="font-mono text-[11px] uppercase tracking-widest text-accent">
                Round {roundState.round_id} judged · start the next one
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Submissions are closed for this round. Anyone can post a fresh prompt to open
                round {(roundState.round_id ?? 0) + 1}.
              </p>
              <Textarea
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                rows={2}
                maxLength={200}
                placeholder="A new prompt for the next round, e.g. 'A letter from the moon'"
                className="mt-3 resize-none font-display text-base"
              />
              <Button
                onClick={onStartNewRound}
                disabled={busy === "start_new_round" || !address}
                variant="outline"
                className="mt-3 w-full border-accent/50 text-accent hover:bg-accent/10 hover:text-accent"
              >
                {busy === "start_new_round" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Start new round
              </Button>
            </div>
          )}
        </motion.div>

        {/* Tx feed */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="lg:col-span-2 rounded-3xl border border-border bg-card/70 p-6 backdrop-blur-sm shadow-[var(--shadow-card)]"
        >
          <div className="mb-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            On-chain log
          </div>
          <h2 className="font-display text-2xl font-semibold">Verified transactions</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Every action is a real tx. Tap any row to verify it on the GenLayer explorer.
          </p>

          <div className="mt-5 space-y-2">
            <AnimatePresence initial={false}>
              {txs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                  No transactions yet — submit your first story.
                </div>
              ) : (
                txs.map((t) => (
                  <motion.a
                    key={t.hash}
                    href={explorerTx(t.hash)}
                    target="_blank"
                    rel="noreferrer"
                    layout
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className="group flex items-center justify-between rounded-2xl border border-border bg-background/40 px-4 py-3 transition hover:border-primary/60 hover:bg-primary/5"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{t.label}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {shortAddr(t.hash)} · {new Date(t.ts).toLocaleTimeString()}
                      </div>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground transition group-hover:text-primary" />
                  </motion.a>
                ))
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </section>

      {/* AI verdict */}
      <AnimatePresence>
        {(judging || judgeResult || judgeError) && (
          <motion.section
            key="verdict"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="mx-auto max-w-6xl px-5 pb-20"
          >
            <div className="rounded-3xl border border-accent/40 bg-gradient-to-br from-accent/10 via-card/70 to-card/40 p-6 backdrop-blur-sm shadow-[var(--shadow-card)] sm:p-8">
              <div className="mb-1 font-mono text-[11px] uppercase tracking-widest text-accent">
                AI verdict
              </div>
              <h2 className="font-display text-3xl font-semibold sm:text-4xl">
                {judging && !judgeResult ? "The chain is deliberating…" : "Judgment delivered"}
              </h2>

              {judging && !judgeResult && (
                <div className="mt-5 flex items-center gap-3 font-mono text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-accent" />
                  Waiting for the LLM consensus to finalize on-chain. This may take a few minutes.
                </div>
              )}

              {judgeResult && (
                <div className="mt-6 space-y-5">
                  <div className="rounded-2xl border border-border bg-background/40 p-5">
                    <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                      {judgeResult.winners.length > 1
                        ? `Winners (${judgeResult.winners.length}, tied)`
                        : "Winning author"}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Trophy className="h-4 w-4 text-accent" />
                      {(judgeResult.winners.length > 0
                        ? judgeResult.winners
                        : [judgeResult.winner]
                      ).map((w) => (
                        <a
                          key={w}
                          href={explorerAddress(w)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-xs text-accent hover:bg-accent/20"
                          title={w}
                        >
                          {shortAddr(w) || "—"}
                        </a>
                      ))}
                    </div>
                    {judgeResult.reason && (
                      <p className="mt-4 font-display text-base leading-relaxed text-foreground/90">
                        “{judgeResult.reason}”
                      </p>
                    )}
                  </div>

                  {judgeResult.verdicts.length > 0 ? (
                    <div className="space-y-4">
                      <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                        All submissions · per-story scorecards
                      </div>
                      {[...judgeResult.verdicts]
                        .sort((a, b) => b.total - a.total)
                        .map((v, i) => {
                          const isWinner = (judgeResult.winners.length > 0
                            ? judgeResult.winners
                            : [judgeResult.winner]
                          )
                            .map((x) => x.toLowerCase())
                            .includes(v.author.toLowerCase());
                          return (
                            <motion.div
                              key={v.author + i}
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: i * 0.05 }}
                              className={`rounded-2xl border p-5 ${
                                isWinner
                                  ? "border-accent/60 bg-accent/5"
                                  : "border-border bg-background/40"
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                                    #{i + 1}
                                  </span>
                                  <a
                                    href={explorerAddress(v.author)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-mono text-xs text-primary hover:underline"
                                    title={v.author}
                                  >
                                    {shortAddr(v.author)}
                                  </a>
                                  {isWinner && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-accent/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-accent">
                                      <Trophy className="h-3 w-3" /> Winner
                                    </span>
                                  )}
                                </div>
                                <div className="font-mono text-xs text-muted-foreground">
                                  Total{" "}
                                  <span className="text-foreground">{v.total}</span>/30
                                </div>
                              </div>
                              {v.story && (
                                <p className="mt-3 whitespace-pre-wrap font-display text-base leading-relaxed text-foreground/90">
                                  {v.story}
                                </p>
                              )}
                              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                                <ScoreBar label="Creativity" value={v.scores.creativity} />
                                <ScoreBar label="Prompt fit" value={v.scores.prompt_fit} />
                                <ScoreBar label="Imagery" value={v.scores.imagery} />
                              </div>
                              {v.critique && (
                                <p className="mt-3 text-sm italic text-muted-foreground">
                                  AI critique: “{v.critique}”
                                </p>
                              )}
                            </motion.div>
                          );
                        })}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-border bg-background/40 p-5">
                      <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                        Top scorecard
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <ScoreBar label="Creativity" value={judgeResult.scores.creativity} />
                        <ScoreBar label="Prompt fit" value={judgeResult.scores.prompt_fit} />
                        <ScoreBar label="Imagery" value={judgeResult.scores.imagery} />
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">
                        This round was judged by an older contract revision that didn't return
                        per-story scores. Start a new round on the redeployed contract to see every
                        story scored individually.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {judgeError && !judgeResult && (
                <div className="mt-5 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                  {judgeError}
                </div>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-center px-5 text-xs text-muted-foreground">
          <div className="font-mono">
            Built on GenLayer · intelligent contracts with LLM consensus
          </div>
        </div>
      </footer>
    </div>
  );
}

function Row({ k, v, small }: { k: string; v: string; small?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={`truncate text-foreground ${small ? "max-w-[60%]" : ""}`} title={v}>
        {v}
      </dd>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(10, Number(value) || 0));
  const pct = (v / 10) * 100;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        <span>{label}</span>
        <span className="text-foreground">{v}/10</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted/40">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
        />
      </div>
    </div>
  );
}
