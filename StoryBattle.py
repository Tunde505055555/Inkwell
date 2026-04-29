# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *

import json
import typing


class JudgeCompleted(gl.Event):
    def __init__(self, result: str, /): ...


class StoryBattle(gl.Contract):
    """
    AI Storytelling Battle
    ----------------------
    Players submit short stories for a shared prompt.
    When the round is judged, an LLM (via gl.nondet.exec_prompt) reads
    every submission and picks the most creative story as the winner.

    Each player accumulates points across rounds — fully on-chain,
    judged by the equivalence-principle consensus of GenLayer validators.
    """

    # ---- state ----
    round_id: u256
    prompt: str
    is_open: bool
    is_judged: bool
    winner: Address
    winning_story: str
    judge_reasoning: str
    result: str

    # submissions for the current round: address -> story
    authors: DynArray[Address]
    stories: TreeMap[Address, str]

    # global scoreboard across all rounds
    scoreboard_keys: DynArray[Address]
    scores: TreeMap[Address, u256]

    def __init__(self, prompt: str):
        """
        Initializes the battle with the first story prompt.
        """
        self.round_id = u256(1)
        self.prompt = prompt
        self.is_open = True
        self.is_judged = False
        self.winner = Address(b"\x00" * 20)
        self.winning_story = ""
        self.judge_reasoning = ""
        self.result = ""

    # -------------------------------------------------------------
    # Player actions
    # -------------------------------------------------------------
    @gl.public.write
    def submit_story(self, story: str) -> None:
        """
        Submit (or overwrite) your story for the current round.
        """
        if not self.is_open:
            raise Exception("Round is closed")
        if len(story) < 10:
            raise Exception("Story too short (min 10 chars)")
        if len(story) > 600:
            raise Exception("Story too long (max 600 chars)")

        sender = gl.message.sender_address
        if sender not in self.stories:
            self.authors.append(sender)
        self.stories[sender] = story

    # -------------------------------------------------------------
    # AI judging (intelligent contract)
    # -------------------------------------------------------------
    @gl.public.write
    def judge_round(self) -> str:
        """
        Closes the current round and asks the LLM to pick the winner.
        Anyone can call this once at least 2 stories have been submitted.
        """
        if self.is_judged:
            raise Exception("Round already judged")
        if len(self.authors) < 2:
            raise Exception("Need at least 2 submissions")

        self.is_open = False

        def fallback_result(reason: str) -> typing.Any:
            return {
                "winner": self.authors[0].as_hex,
                "scores": {"creativity": 0, "prompt_fit": 0, "imagery": 0},
                "reason": reason,
            }

        def normalize_result(value: typing.Any) -> typing.Any:
            if not isinstance(value, dict):
                return fallback_result("AI returned an invalid result shape")

            winner = str(value.get("winner", ""))
            valid_winners = []
            for addr in self.authors:
                valid_winners.append(addr.as_hex)
            matched_winner = ""
            for valid_winner in valid_winners:
                if winner.lower() == valid_winner.lower():
                    matched_winner = valid_winner
            if len(matched_winner) == 0:
                winner = self.authors[0].as_hex
            else:
                winner = matched_winner

            raw_scores = value.get("scores", {})
            if not isinstance(raw_scores, dict):
                raw_scores = {}

            scores = {}
            for key in ["creativity", "prompt_fit", "imagery"]:
                try:
                    score = int(raw_scores.get(key, 0))
                except Exception:
                    score = 0
                if score < 0:
                    score = 0
                scores[key] = score

            reason = str(value.get("reason", ""))
            if len(reason) == 0:
                reason = "AI selected the most compelling story."

            return {"winner": winner, "scores": scores, "reason": reason}

        # Build the judging prompt
        entries = []
        for i, addr in enumerate(self.authors):
            entries.append(f"Story #{i + 1} by {addr.as_hex}:\n{self.stories[addr]}")
        joined = "\n\n".join(entries)

        task = f"""You are judging an AI Storytelling Battle.

The prompt for this round is:
"{self.prompt}"

Below are the submitted stories. Pick exactly ONE winner based on:
- Creativity and originality
- How well it answers the prompt
- Use of vivid imagery and emotion

Submissions:
{joined}

Respond ONLY with strict JSON in this exact shape, no markdown, no prose:
{{
  "winner": "<the exact winning author address/id>",
  "scores": {{"creativity": <integer>, "prompt_fit": <integer>, "imagery": <integer>}},
  "reason": "<one short sentence explaining your pick>"
}}
"""

        def judge() -> str:
            return gl.nondet.exec_prompt(task, response_format="json")

        # Use a comparative equivalence principle: validators don't need
        # byte-identical LLM output, only a semantically equivalent verdict
        # (same winner + similar reasoning). strict_eq almost always fails
        # on creative LLM JSON and produces an UNDETERMINED transaction.
        raw = gl.eq_principle.prompt_comparative(
            judge,
            "Both outputs must be valid JSON picking the same winner address. "
            "The 'scores' values may differ slightly and the 'reason' wording "
            "may differ as long as it justifies the same winning story.",
        )

        # Parse the model's JSON response safely, falling back instead of reverting.
        parsed = fallback_result("AI result could not be parsed")
        try:
            if isinstance(raw, dict):
                parsed = raw
            else:
                cleaned = str(raw).strip()
                if cleaned.startswith("```"):
                    cleaned = cleaned.strip("`").strip()
                    if cleaned.lower().startswith("json"):
                        cleaned = cleaned[4:].strip()
                start = cleaned.find("{")
                end = cleaned.rfind("}")
                if start != -1 and end != -1:
                    parsed = json.loads(cleaned[start : end + 1])
        except Exception:
            parsed = fallback_result("AI result could not be parsed")

        final_result = normalize_result(parsed)
        winner_addr = self.authors[0]
        for addr in self.authors:
            if addr.as_hex.lower() == final_result["winner"].lower():
                winner_addr = addr
        self.winner = winner_addr
        self.winning_story = self.stories[winner_addr]
        self.judge_reasoning = final_result["reason"]
        self.result = json.dumps(final_result, separators=(",", ":"))
        self.is_judged = True

        # Scoreboard
        if winner_addr not in self.scores:
            self.scoreboard_keys.append(winner_addr)
            self.scores[winner_addr] = u256(0)
        self.scores[winner_addr] = u256(int(self.scores[winner_addr]) + 1)

        JudgeCompleted(self.result).emit()
        return self.result

    @gl.public.write
    def start_new_round(self, new_prompt: str) -> None:
        """
        After a round has been judged, start a fresh round with a new prompt.
        """
        if not self.is_judged:
            raise Exception("Current round not judged yet")
        if len(new_prompt) < 5:
            raise Exception("Prompt too short")

        # reset round state
        self.round_id = u256(int(self.round_id) + 1)
        self.prompt = new_prompt
        self.is_open = True
        self.is_judged = False
        self.winner = Address(b"\x00" * 20)
        self.winning_story = ""
        self.judge_reasoning = ""

        # clear submissions
        for addr in list(self.authors):
            del self.stories[addr]
        # DynArray reset
        while len(self.authors) > 0:
            self.authors.pop()

    # -------------------------------------------------------------
    # Read-only views
    # -------------------------------------------------------------
    @gl.public.view
    def get_state(self) -> typing.Any:
        subs = []
        for addr in self.authors:
            subs.append({"author": addr.as_hex, "story": self.stories[addr]})

        board = []
        for addr in self.scoreboard_keys:
            board.append({"player": addr.as_hex, "wins": int(self.scores[addr])})

        return {
            "round_id": int(self.round_id),
            "prompt": self.prompt,
            "is_open": self.is_open,
            "is_judged": self.is_judged,
            "winner": self.winner.as_hex,
            "winning_story": self.winning_story,
            "judge_reasoning": self.judge_reasoning,
            "result": self.result,
            "submissions": subs,
            "scoreboard": board,
        }

    @gl.public.view
    def getResult(self) -> str:
        return self.result
