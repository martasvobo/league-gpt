import dotenv from "dotenv";
import fs from "fs";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import path from "path";
import readline from "readline";
import { parseChampSelectSession } from "./championData.js";
import ChatGPTClient from "./chatgptClient.js";
import LeagueClient from "./leagueClient.js";

marked.use(markedTerminal());

dotenv.config();

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

class LeagueGPTApp {
  constructor() {
    this.leagueClient = new LeagueClient();
    this.chatgptClient = null;
    this.currentSummonerId = null;
    this.pollInterval = null;
    this.readyCheckPollInterval = null;
    this.lastRecommendation = null;
    this.isProcessing = false;
    this.manualQueryRequested = false;
    this.lastSession = null;
    this.currentSessionDir = null;
    this.queryCounter = 0;
    this.readyCheckTimer = null;
    this.readyCheckStartTime = null;
  }

  async initialize() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === "your_openai_api_key_here") {
      console.error("❌ Error: OpenAI API key not configured!");

      process.exit(1);
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.chatgptClient = new ChatGPTClient(apiKey, model);

    const connected = await this.leagueClient.connect();
    if (!connected) {
      console.error("❌ Failed to connect to League Client.");
      console.error("Make sure League of Legends is running and logged in.");
      process.exit(1);
    }

    try {
      const summoner = await this.leagueClient.getCurrentSummoner();
      this.currentSummonerId = summoner.summonerId;
    } catch (error) {
      console.error("❌ Failed to get summoner info:", error.message);
      process.exit(1);
    }

    console.log("✓ Ready! Waiting for champion select...");
    console.log("💡 Press 'R' anytime to manually request AI recommendation");
    console.log(
      "🎯 Auto-accept enabled: Queues will be accepted after 5 seconds"
    );
    console.log("");
  }

  async start() {
    await this.initialize();

    process.stdin.on("keypress", (str, key) => {
      if (key && (key.name === "r" || key.name === "R")) {
        console.log("\n🔄 Manual query requested...");
        this.manualQueryRequested = true;
        if (this.lastSession) {
          this.onChampSelectUpdate(this.lastSession, true);
        } else {
          console.log("❌ No active champion select session");
        }
      }
      if (key && key.ctrl && key.name === "c") {
        console.log("\n\nShutting down...");
        if (this.pollInterval) {
          clearInterval(this.pollInterval);
        }
        if (this.readyCheckPollInterval) {
          clearInterval(this.readyCheckPollInterval);
        }
        if (this.readyCheckTimer) {
          clearTimeout(this.readyCheckTimer);
        }
        process.exit(0);
      }
    });

    this.pollInterval = await this.leagueClient.pollChampSelect(
      async (session) => await this.onChampSelectUpdate(session, false),
      2000
    );

    this.readyCheckPollInterval = await this.leagueClient.pollReadyCheck(
      async (readyCheck) => await this.onReadyCheckUpdate(readyCheck),
      1000
    );

    process.on("SIGINT", () => {
      console.log("\n\nShutting down...");
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
      }
      if (this.readyCheckPollInterval) {
        clearInterval(this.readyCheckPollInterval);
      }
      if (this.readyCheckTimer) {
        clearTimeout(this.readyCheckTimer);
      }
      process.exit(0);
    });
  }

  async onReadyCheckUpdate(readyCheck) {
    if (!readyCheck) {
      if (this.readyCheckTimer) {
        clearTimeout(this.readyCheckTimer);
        this.readyCheckTimer = null;
        this.readyCheckStartTime = null;
      }
      return;
    }

    if (
      readyCheck.state === "InProgress" &&
      readyCheck.playerResponse === "None"
    ) {
      if (!this.readyCheckStartTime) {
        this.readyCheckStartTime = Date.now();
        console.log("   (Ready check detected)");

        this.readyCheckTimer = setTimeout(async () => {
          const accepted = await this.leagueClient.acceptReadyCheck();
          if (accepted) {
            console.log("✅ Match accepted successfully!");
          } else {
            console.log("❌ Failed to accept match");
          }
          this.readyCheckStartTime = null;
          this.readyCheckTimer = null;
        }, 5000);
      }
    } else if (readyCheck.playerResponse === "Accepted") {
      if (this.readyCheckTimer) {
        clearTimeout(this.readyCheckTimer);
        this.readyCheckTimer = null;
      }
      if (this.readyCheckStartTime) {
        console.log("✅ Match already accepted");
        this.readyCheckStartTime = null;
      }
    } else if (readyCheck.state !== "InProgress") {
      if (this.readyCheckTimer) {
        clearTimeout(this.readyCheckTimer);
        this.readyCheckTimer = null;
        this.readyCheckStartTime = null;
      }
    }
  }

  async onChampSelectUpdate(session, isManualQuery = false) {
    if (!session) {
      if (this.lastRecommendation) {
        console.log("\n" + "─".repeat(60));
        console.log("Champion select ended.");
        if (this.currentSessionDir) {
          console.log(`📁 Session saved to: ${this.currentSessionDir}`);
        }
        console.log("─".repeat(60));
        this.lastRecommendation = null;
        this.lastSession = null;
        this.currentSessionDir = null;
        this.queryCounter = 0;
      }
      return;
    }

    this.lastSession = session;

    if (!this.currentSessionDir) {
      const now = new Date();
      const timestamp =
        now.getFullYear() +
        "-" +
        String(now.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(now.getDate()).padStart(2, "0") +
        "T" +
        String(now.getHours()).padStart(2, "0") +
        "-" +
        String(now.getMinutes()).padStart(2, "0") +
        "-" +
        String(now.getSeconds()).padStart(2, "0");
      this.currentSessionDir = path.join("sessions", timestamp);
      fs.mkdirSync(this.currentSessionDir, { recursive: true });
    }

    if (this.isProcessing && !isManualQuery) return;

    try {
      this.isProcessing = true;

      const parsedData = parseChampSelectSession(
        session,
        this.currentSummonerId
      );

      if (!parsedData) return;

      const hasTeamData =
        parsedData.myTeam.length > 0 || parsedData.enemyTeam.length > 0;

      if (!hasTeamData && !isManualQuery) return;

      const isMyTurn = this.isMyTurn(session, parsedData.localPlayerCellId);

      const stateHash = JSON.stringify({
        myTeam: parsedData.myTeam.map((c) => c.championId),
        enemyTeam: parsedData.enemyTeam.map((c) => c.championId),
        bans: parsedData.bannedChampions.map((c) => c.championId),
        phase: parsedData.phase,
        isMyTurn: isMyTurn,
      });

      if (this.lastRecommendation === stateHash && !isManualQuery) return;

      if (!isMyTurn && !isManualQuery) {
        if (this.lastRecommendation !== stateHash) {
          this.lastRecommendation = stateHash;
        }
        return;
      }

      const queryReason = isManualQuery ? "Manual Query" : "Your Turn";
      console.log("\n" + "=".repeat(60));
      console.log(
        `CHAMPION SELECT UPDATE - ${queryReason} - Phase: ${parsedData.phase}`
      );
      console.log("=".repeat(60));

      if (isMyTurn && !isManualQuery) {
        console.log("\n⏰ IT'S YOUR TURN TO PICK!");
      }

      if (parsedData.myRole) {
        console.log(`\n🎮 Your Role: ${parsedData.myRole}`);
      }

      if (parsedData.myTeam.length > 0) {
        console.log("\n👥 Allied Team:");
        parsedData.myTeam.forEach((champ) => {
          // Don't show user's own hovered champion in console
          if (champ.isMe && champ.isHovered) {
            return;
          }
          const marker = champ.isMe ? " (YOU)" : "";
          const status = champ.isHovered ? " [HOVERING]" : "";
          console.log(
            `   • ${champ.name} - ${champ.position}${marker}${status}`
          );
        });
      }

      if (parsedData.enemyTeam.length > 0) {
        console.log("\n⚔️  Enemy Team:");
        parsedData.enemyTeam.forEach((champ) => {
          const status = champ.isHovered ? " [HOVERING]" : "";
          console.log(`   • ${champ.name} - ${champ.position}${status}`);
        });
      }

      if (parsedData.bannedChampions.length > 0) {
        console.log("\n🚫 Banned Champions:");
        const banNames = parsedData.bannedChampions
          .map((c) => c.name)
          .join(", ");
        console.log(`   ${banNames}`);
      }

      console.log("\n🤖 Getting AI recommendation...\n");
      console.log("─".repeat(60));

      // Filter out own hovered champion from AI input to avoid confusion
      const aiData = {
        ...parsedData,
        myTeam: parsedData.myTeam.filter(
          (champ) => !(champ.isMe && champ.isHovered)
        ),
      };

      const recommendation = await this.chatgptClient.getChampionRecommendation(
        aiData
      );
      console.log(marked(recommendation));
      console.log("─".repeat(60));

      this.queryCounter++;
      await this.saveRecommendation(parsedData, recommendation, queryReason);

      if (!isManualQuery) {
        this.lastRecommendation = stateHash;
      }
      this.manualQueryRequested = false;
    } catch (error) {
      console.error("\n❌ Error processing champion select:", error.message);
      this.manualQueryRequested = false;
    } finally {
      this.isProcessing = false;
    }
  }

  isMyTurn(session, myCell) {
    if (!session.actions || !Array.isArray(session.actions)) return false;

    for (const actionGroup of session.actions) {
      if (Array.isArray(actionGroup)) {
        for (const action of actionGroup) {
          if (
            action.actorCellId === myCell &&
            !action.completed &&
            action.isInProgress &&
            action.type === "pick" &&
            action.championId === 0
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  async saveRecommendation(parsedData, recommendation, queryReason) {
    if (!this.currentSessionDir) return;

    const filename = `query-${String(this.queryCounter).padStart(
      2,
      "0"
    )}-${queryReason.toLowerCase().replace(" ", "-")}.md`;
    const filepath = path.join(this.currentSessionDir, filename);

    let content = "";
    content += `# Champion Select Recommendation\n\n`;
    content += `**Timestamp:** ${new Date().toLocaleString()}  \n`;
    content += `**Query Type:** ${queryReason}  \n`;
    content += `**Phase:** ${parsedData.phase}\n\n`;

    if (parsedData.myRole) {
      content += `**Your Role:** ${parsedData.myRole}\n\n`;
    }

    content += `---\n\n`;

    if (parsedData.myTeam.length > 0) {
      content += `## 👥 Allied Team\n\n`;
      parsedData.myTeam.forEach((champ) => {
        const marker = champ.isMe ? " **(YOU)**" : "";
        const status = champ.isHovered ? " *(hovering, not locked)*" : "";
        content += `- **${champ.name}** - ${champ.position}${marker}${status}\n`;
      });
      content += `\n`;
    }

    if (parsedData.enemyTeam.length > 0) {
      content += `## ⚔️ Enemy Team\n\n`;
      parsedData.enemyTeam.forEach((champ) => {
        const status = champ.isHovered ? " *(hovering, not locked)*" : "";
        content += `- **${champ.name}** - ${champ.position}${status}\n`;
      });
      content += `\n`;
    }

    if (parsedData.bannedChampions.length > 0) {
      content += `## 🚫 Banned Champions\n\n`;
      const banNames = parsedData.bannedChampions
        .map((c) => `**${c.name}**`)
        .join(", ");
      content += `${banNames}\n\n`;
    }

    content += `---\n\n`;
    content += `## 🤖 AI Recommendation\n\n`;
    content += recommendation;
    content += `\n`;

    fs.writeFileSync(filepath, content, "utf8");
  }
}

const app = new LeagueGPTApp();
app.start().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
