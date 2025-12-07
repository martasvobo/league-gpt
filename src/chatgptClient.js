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
    const { myTeam, enemyTeam, myRole, mySide, myChampion } = data;

    let prompt = "# League of Legends Champion Select Analysis\n\n";

    prompt += "## Pick Phase\n";
    prompt += `My role: ${myRole || "Not specified"}\n`;
    prompt += `My side: ${mySide || "Unknown"} side\n`;

    if (myChampion) {
      prompt += `My champion: ${myChampion.name}\n`;
    }
    prompt += "\n";

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

    // Different prompts based on whether champion is picked
    if (!myChampion) {
      // Not picked yet - only show champion recommendations
      prompt +=
        "Based on the team compositions above, recommend 5 champions I should pick for my role. Consider:\n";
      prompt += "1. Synergy with my team composition\n";
      prompt += "2. Countering enemy champions\n";
      prompt += "3. Win conditions and team fight dynamics\n\n";
      prompt +=
        "Format your response as a numbered list with brief explanations:\n";
      prompt += "1. [Champion Name]: [Brief reason]\n";
      prompt += "2. [Champion Name]: [Brief reason]\n";
      prompt += "etc.\n\n";
      prompt +=
        "Keep it concise and focused only on champion recommendations.\n";
    } else {
      // Champion already picked - only show gameplan
      prompt +=
        "I have already picked my champion. Provide a detailed gameplan:\n\n";
      if (myRole?.toLowerCase().includes("jungle")) {
        prompt +=
          "2. **Early game strategy**: Should I full clear, gank early, invade, or dive? Specify levels and timings.\n";
        prompt +=
          "3. **Priority targets**: Which lanes should I focus on and why?\n";
        prompt +=
          "5. **Win condition**: What should I focus on to carry the game?\n\n";
      } else {
        prompt +=
          "1. **Laning phase**: How should I play the lane? Aggressive, passive, farm-focused?\n";
        prompt +=
          "4. **Team fighting**: My role in team fights and how to position.\n";
        prompt +=
          "5. **Win condition**: What should I focus on to carry the game?\n\n";
      }
      prompt +=
        "Keep it concise and actionable. NO champion recommendations since I already picked.\n";
    }

    return prompt;
  }
}

export default ChatGPTClient;
