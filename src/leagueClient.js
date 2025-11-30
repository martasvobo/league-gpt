import axios from "axios";
import fs from "fs";
import https from "https";
import path from "path";

class LeagueClient {
  constructor() {
    this.credentials = null;
    this.httpsAgent = null;
    this.baseUrl = null;
  }

  async connect() {
    try {
      const lockfilePaths = [
        "C:\\Riot Games\\League of Legends\\lockfile",
        path.join(
          process.env.ProgramData || "C:\\ProgramData",
          "Riot Games",
          "League of Legends",
          "lockfile"
        ),
        path.join(
          process.env.LOCALAPPDATA || "",
          "Riot Games",
          "League of Legends",
          "lockfile"
        ),
      ];

      let lockfileContent = null;
      for (const lockfilePath of lockfilePaths) {
        try {
          if (fs.existsSync(lockfilePath)) {
            lockfileContent = fs.readFileSync(lockfilePath, "utf8");
            break;
          }
        } catch (err) {}
      }

      if (!lockfileContent) {
        throw new Error(
          "League Client lockfile not found. Make sure League of Legends client is running."
        );
      }

      const parts = lockfileContent.split(":");
      const port = parts[2];
      const password = parts[3];

      this.credentials = {
        username: "riot",
        password: password,
        port: port,
      };

      this.baseUrl = `https://127.0.0.1:${port}`;

      this.httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });

      console.log(`✓ Connected to League Client`);
      return true;
    } catch (error) {
      console.error("Failed to connect to League Client:", error.message);
      return false;
    }
  }

  async request(endpoint, method = "GET", data = null) {
    if (!this.credentials) {
      throw new Error("Not connected to League Client. Call connect() first.");
    }

    try {
      const auth = Buffer.from(
        `${this.credentials.username}:${this.credentials.password}`
      ).toString("base64");

      const config = {
        method: method,
        url: `${this.baseUrl}${endpoint}`,
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        httpsAgent: this.httpsAgent,
        data: data,
      };

      const response = await axios(config);
      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(
          `League Client API error: ${error.response.status} - ${JSON.stringify(
            error.response.data
          )}`
        );
      }
      throw error;
    }
  }

  async getChampSelectSession() {
    try {
      const session = await this.request("/lol-champ-select/v1/session");
      return session;
    } catch (error) {
      if (error.message.includes("404")) {
        return null;
      }
      throw error;
    }
  }

  async getCurrentSummoner() {
    return await this.request("/lol-summoner/v1/current-summoner");
  }

  async getChampionById(championId) {
    return await this.request(
      `/lol-champions/v1/inventories/${await this.getCurrentSummoner().then(
        (s) => s.summonerId
      )}/champions/${championId}`
    );
  }

  async pollChampSelect(callback, interval = 2000) {
    let previousState = null;

    const poll = async () => {
      try {
        const session = await this.getChampSelectSession();
        const currentState = JSON.stringify(session);

        if (currentState !== previousState) {
          previousState = currentState;
          await callback(session);
        }
      } catch (error) {
        console.error("Error polling champ select:", error.message);
      }
    };

    await poll();
    return setInterval(poll, interval);
  }
}

export default LeagueClient;
