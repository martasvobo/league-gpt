import axios from "axios";

class ChatGPTClient {
  constructor(apiKey, model) {
    if (!apiKey) {
      throw new Error("OpenAI API key is required");
    }
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = "https://api.openai.com/v1";
  }

  async getChampionRecommendation(championSelectData) {
    const prompt = this.buildPrompt(championSelectData);

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.model,
          messages: [
            {
              role: "system",
              content:
                "You are a League of Legends expert and coach. Your job is to analyze team compositions and recommend the best champion picks. Provide concise, strategic advice focused on synergy, counters, and win conditions.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          //reasoning_effort: "none",
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;

      if (content && content.trim().length > 0) {
        return content;
      } else {
        throw new Error(
          `No content in OpenAI response. Finish reason: ${response.data?.choices?.[0]?.finish_reason}`
        );
      }
    } catch (error) {
      if (error.response) {
        throw new Error(
          `OpenAI API error: ${error.response.status} - ${
            error.response.data.error?.message ||
            JSON.stringify(error.response.data)
          }`
        );
      }
      throw error;
    }
  }

  buildPrompt(data) {
    const { myTeam, enemyTeam, myRole } = data;

    let prompt = "# League of Legends Champion Select Analysis\n\n";

    prompt += "## Pick Phase\n";
    prompt += `My role: ${myRole || "Not specified"}\n\n`;

    if (myTeam && myTeam.length > 0) {
      prompt += "## Allied Team:\n";
      myTeam.forEach((champ) => {
        prompt += `- ${champ.name || `Champion ID: ${champ.championId}`} (${
          champ.position || "Unknown role"
        })\n`;
      });
      prompt += "\n";
    }

    if (enemyTeam && enemyTeam.length > 0) {
      prompt += "## Enemy Team:\n";
      enemyTeam.forEach((champ) => {
        prompt += `- ${champ.name || `Champion ID: ${champ.championId}`} (${
          champ.position || "Unknown role"
        })\n`;
      });
      prompt += "\n";
    }

    const bannedChampions = data.bannedChampions || [];
    if (bannedChampions.length > 0) {
      prompt += "## Banned Champions:\n";
      bannedChampions.forEach((champ) => {
        prompt += `- ${champ.name || `Champion ID: ${champ.championId}`}\n`;
      });
      prompt += "\n";
    }

    prompt +=
      "Based on the team compositions above, recommend the top 3 champions I should pick. Consider:\n";
    prompt += "1. Synergy with my team composition\n";
    prompt += "2. Countering enemy champions\n";
    prompt += "3. Win conditions and team fight dynamics\n\n";
    prompt += "Provide a brief explanation for each recommendation.\n";
    prompt +=
      "At the end of your response, list only the recommended champion names in a comma-separated format prefixed by 'Recommended Picks:'.\n";
    prompt +=
      "If I have already picked a champion and my role is jungle, tell me whether I should path from top to bot or from bot to top based on the current team compositions and enemy picks.\n";
    return prompt;
  }
}

export default ChatGPTClient;
