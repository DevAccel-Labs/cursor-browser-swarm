## **Towards Autonomous QA: Giving Coding Agents Eyes and Hands**

By: Tejas Haveri | CTO DevAccel-Labs

I've been trying out ways to make Cursor agents check their own work.

The idea started from a simple frustration, I'd ask an agent to build a feature, it would write the code, tests would pass, and it would confidently tell me it was done. Then I'd open the browser and find the feature didn't actually work. A card would appear in the UI but vanish after a page refresh. An optimistic update that never made it to the server.

The agent had no way to know. It couldn't see the app.

This felt like a gap that needed filling. Agents can read code, write code, run commands, but they can't open a browser and click through a flow like a user would. They basically can't see the actual runtime behavior of what they build.

I wanted to see if I could give them eyes and hands.

## **What is the value?**

It's mainly about closing the feedback loop. Right now, agents write code and hope it works. They can run tests, but tests don't catch everything, especially UI behavior, integration issues, or flows that depend on real browser state.

When agents can actually see the app they're building, a few things change:

Faster iteration. Agents can catch their own mistakes before a human even looks at the work. Instead of a developer finding the bug, filing it back to the agent, waiting for a fix, the agent just spots it and fixes it in the same session.

More confidence in handoffs. When an agent says "done," you can actually trust it. The evidence is there, screenshots showing the flow works, logs showing no errors, a manifest proving the agent actually tested what it claims.

Less context switching for humans. Developers don't have to manually check every feature an agent builds. They can review the evidence instead of re-testing from scratch.

## **Use cases**

This approach opens up a few practical uses:

Bug reproduction and fix verification. An agent can take a bug report, reproduce the issue in the browser, apply a fix, and show the fix works with before/after evidence. No more "works on my machine" or "I think I fixed it."

Feature checking before human review. When an agent implements a feature, it can check the happy path and edge cases before a developer even opens the PR. The human reviewer sees working screenshots alongside the code diff.

Regression detection. Run agents against existing flows after code changes. If something breaks that unit tests didn't catch, the agent finds it and gives you reproduction steps.

QA assistance. Agents can handle the repetitive parts of QA, clicking through forms, checking error states, checking redirects. Human QA focuses on exploratory testing and edge cases that need judgment.

Staging checks. After deploying to staging, agents can run through important flows and flag issues before production. Catches deployment-specific bugs like missing env vars or broken API connections.

CI integration. Add browser checks to your CI pipeline. PRs don't merge unless an agent can finish the affected flows and produce verified evidence.

## **Background**

My initial approach was pretty simple, give Cursor agents access to browser automation tools and point them at a running app. I used chrome-devtools-axi, which lets you open URLs, click elements, fill forms, and capture screenshots via CLI commands.

The first attempt was just prompting an agent with "open localhost:3000, click around, tell me if anything is broken."

This didn't work. The agent would click a few things, declare success, and move on. It had no structure for what to check, no way to show it actually did anything, and no real accountability for thoroughness.



The agent would write reports like:

I opened the dashboard and clicked through the main flows. 

Everything appears to be working correctly. No issues found.

But when I checked, it had only opened one page and taken zero screenshots. It was basically making up its success.

## **The evidence problem**

I realized the main issue wasn't the browser tooling, it was mainly trust. Agents will claim success whether or not they actually did the work. Not because they're trying to deceive you, but because they're trained to be helpful and confident.

I needed a way to check that agents actually did what they claimed.

My first fix was requiring screenshots. If an agent says it tested a flow, it should have a screenshot proving it saw that state. This helped, but agents would sometimes reference screenshots that didn't exist, or write "screenshot attached" without actually taking one.

So I built a verification step. After an agent finishes, the system checks:

- Did the agent's stdout show browser commands being executed?  
- Do the screenshot files it references actually exist?  
- Did it save console logs? Network logs?  
- Does its report only reference real artifacts?

If any check fails, the run is flagged as unverified.

This made a big difference. Agents couldn't just claim success anymore, they had to actually show it.

## **Evidence**

The verification worked, but parsing free form reports for artifact references was kind of fragile. I added a structured evidence manifest that agents have to produce:

```
{

  "version": "1",

  "agentId": "agent-1",

  "status": "passed",

  "routes": 


{

  "path": "/auth/signin",

  "opened": true,

  "interactions": \["Filled email", "Clicked sign in"\],

  "screenshots": \["./screenshots/dashboard.png"\],

  "consoleChecked": true,

  "networkChecked": true

}


  ,

  "selfCheck": {


"browserOpened": true,

"browserInteracted": true,

"screenshotsExist": true,

"consoleInspected": true,

"networkInspected": true


  }

}

```

The selfCheck section is the main thing. The agent has to say whether it opened the browser, interacted with it, took screenshots that exist, and inspected the console/network. The verifier checks these claims against the actual files on disk.

Agents actually follow this format pretty reliably. Give them a clear schema and they fill it out correctly.

## **Running multiple agents**

A single agent checking one route was useful, but I wanted to test whole apps. I built an orchestrator that:

1. Loads a route config (paths  goals for each route)
2. Splits routes across N agents
3. Spawns parallel Cursor CLI processes
4. Collects evidence from each
5. Verifies everything and produces a final report

The parallelization was pretty simple, each agent gets its own artifact directory and has no knowledge of other agents. No coordination, no shared state, no locks.

I tried two assignment strategies:

Split: divide routes across agents. Agent 1 gets /auth, agent 2 gets /dashboard, etc.

Replicate: every agent tests every route.

I expected split to be better for coverage, but replicate turned out to be more useful. Different agents would exercise the same route slightly differently, one fills form fields individually, another uses a batch fill command, and they'd surface different edge cases.

## **What I observed**

Here's output from a recent run against a real application currently in production::
```
10:08:21 PM  Run initialized (2 agents, 2 routes, cursor-cli mode)  
10:08:21 PM  Base URL healthy  
10:08:28 PM  AXI preflight passed  
10:08:31 PM  Starting agent-1 and agent-2

10:09:06 PM  agent-1 wrote 1 screenshot  
10:09:51 PM  agent-1 wrote 2 screenshots  
10:10:01 PM  agent-1 wrote console, network, realtimeTrace  
10:10:51 PM  agent-1 wrote 3 screenshots  
10:11:21 PM  agent-1 wrote report  
10:11:31 PM  agent-1 wrote manifest  
10:11:36 PM  Evidence verified for agent-1

10:09:10 PM  agent-2 wrote 1 screenshot  
10:09:55 PM  agent-2 wrote 4 screenshots  
10:10:05 PM  agent-2 wrote console, network, realtimeTrace  
10:11:35 PM  agent-2 wrote 7 screenshots  
10:12:00 PM  agent-2 wrote report  
10:12:15 PM  agent-2 wrote manifest  
10:12:23 PM  Evidence verified for agent-2

10:12:23 PM  Final report: 5 issues, 4 likely real bugs  
             Evidence verified 2/2, quality strong 2/2
```
Both agents completed in about 4 minutes. Each produced:

 3-7 screenshots at different interaction points  
 Console log with captured errors  
 Network log with request/response data  
 Realtime trace of websocket activity  
 Evidence manifest with selfCheck passing  
 Detailed report with reproduction steps and root-cause analysis

The agents found actual bugs I didn't know about:

1 (Expected, this was the issue that I staged) Card vanishes after setting start date (high severity): After choosing a date, the card disappeared from the board entirely. URL still had a temp card id, suggesting the optimistic update never reconciled with the server response.

2 archiveCard mutation returns FORBIDDEN (medium): Console showed a tRPC FORBIDDEN error when archiving, but the UI still adjusted counts. Server rejected while client proceeded.

3 Date picker sequence collapses modal (high): Opening start date then due date in sequence caused the Task Details modal to close and board counts to zero out.

4 Due date save also causes card loss (high): Same pattern as the start date bug, card briefly showed "Due in 4d" chip then vanished.

The reports included things like:

- URL contained cardId=temp17773457538257grz4sm7o before date save. No WebSocket frame log available in this run.
- Console emitted TRPC FORBIDDEN with stack at KanbanBoard.tsx / KanbanColumn.tsx / CardActionsDropdownV5.tsx after clicking Archive.
- Likely failure to reconcile optimistic temp card id with server id after date mutation, or bad cache invalidation dropping the card.

These aren't vague or false claims at all. Each finding has screenshots showing before/after states, console logs with the actual error, and network traces I can cross-reference and surprisingly actually caught real bugs/issues.

## **A controlled failure**

To really test this, we injected a client to server contract bug on the Kanban create card path. The UI still ran the optimistic Redux update so the new card appeared locally for the user, but the WebSocket operation used an operation type the realtime Cloudflare worker doesn't handle. On the server side, that falls through to an "unknown client operation" and the convert returns null, so nothing ever persists and there's no proper ack path for that create. The next authoritative snapshot or page reload replaced client state with server's truth, thus the card just vanished.

The downstream symptoms the swarm reported, temp IDs stuck in the URL, archive oddities, "nothing persisted," all line up with optimistic temp IDs that never get mapped to real IDs.

How the agent found it

The swarm agent wasn't given the diff or repo. It just executed a scripted mission against a running app, given the devserver url, test scenario to validate, and what model to use with Cursor CLI.

Browser automation opened the board URL, used an accessibility snapshot to get stable element targets, clicked "Add a card," typed a title, submitted, then opened sheets and menus to archive. It also captured network traffic during each action, dumping both HTTP requests and WebSocket frames to network.json, and ran console inspection to catch any client side errors or warnings that fired during the flow.

It noticed a behavioral contradiction: card appears, then disappears after a realtime refresh. That pattern pretty much screams "optimistic-only" or "server rejected" rather than "button broken."

The artifacts backed this up. Screenshots anchored the story, showing the board with the card, then empty, then follow up UI glitches. Console logs captured any thrown errors at capture time. Network logs showed whether HTTP calls looked fine, though the real Kanban create is mainly WebSocket traffic, so a naive "no failed fetch" pass can miss the issue.

The agent phrased the finding as "no createCard mutation, persist doesn't happen." That's not exactly true if the app only creates via socket ops rather than tRPC because it never knew or had access to the codebase, but was a good enough hypothesis that agents with the codebase could understand and debug.

Why multiple issues showed up

One root cause, no server card. Can fan out into, silent errors, stale add card field state, temp id in URL. The replicate setup clusters these symptoms unless you dedupe by root cause in the debrief.

## **Learnings**

Evidence  claims. Don't trust agent reports at face value. Require artifacts that show the work happened. This isn't about agents being dishonest, it's mainly about building systems that work even when components fail.

Structured output is checkable. The JSON evidence manifest is way more useful than free-form reports.

Short wait loops. Agents need clear guidance for async UI. "Use short wait/snapshot loops, don't rely on one long sleep" improved reliability a lot.

Constraints  instructions. "No hallucinated success" works better than "remember to verify your work."

Parallelization is easy when agents are isolated. No shared state means no coordination problems.

## **What's next**

The current system checks routes I specify. The next step is probably autonomous exploration, have agents discover flows themselves, build a map of the app, find issues without me having to list out route configs.

I'm also trying out fix mode. Instead of just reporting issues, agents make small code changes and re-check. This works for obvious bugs (missing null checks, typos) but needs guardrails for bigger changes, but with cursor’s cli and agents it's extremely easy to get production ready and quality outputs.

*If you're working on similar problems, agents that can check their own work, I'd be interested to hear what you're finding.*  