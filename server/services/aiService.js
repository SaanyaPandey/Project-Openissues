const { GoogleGenerativeAI } = require('@google/generative-ai');
const Settings = require('../models/Settings');

class AiService {
  constructor() {
    this.validateKey();
    try {
      // Explicitly using v1 API version for stability
      this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      
      // Standardizing on gemini-1.5-flash
      this.model = this.genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash"
      }, { apiVersion: 'v1' });

      // Task-specific embedding model
      this.embedModel = this.genAI.getGenerativeModel({ 
        model: "text-embedding-004" 
      }, { apiVersion: 'v1' });

      console.log("[GEMINI] Core Engine Initialized: gemini-1.5-flash (API v1)");
    } catch (e) {
      console.error("[GEMINI] Initialization ERROR:", e.message);
    }
  }

  validateKey() {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key === 'your_key_here' || key.trim() === '') {
      console.error("[GEMINI] VALIDATION FAILED: GEMINI_API_KEY is not defined in environment.");
      throw new Error('GEMINI_API_KEY is missing or invalid in .env. AI processing requires a valid Google API key.');
    }
  }

  /**
   * Helper to parse Gemini JSON responses safely
   */
  parseJson(text) {
    try {
      // Direct parse if clean
      return JSON.parse(text);
    } catch (e) {
      // Fallback: Extract from markdown blocks if Gemini wraps it
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (inner) {
          throw new Error("Failed to parse AI JSON response: " + inner.message);
        }
      }
      throw new Error("No valid JSON found in AI response.");
    }
  }

  async analyzeIssue(issueData) {
    this.validateKey();

    const prompt = `You are an elite expert software engineer.
Analyze the following GitHub issue and return a STRICT JSON object.

ISSUE DATA:
Title: ${issueData.title}
Body: ${issueData.body}
Labels: ${issueData.labels.join(', ')}

JSON FORMAT:
{
  "severity": "Low" | "Medium" | "High" | "Critical",
  "category": "Frontend" | "Backend" | "Security" | "Memory Leak" | "Database" | "Architecture" | "Other",
  "confidence": number,
  "analysis": "summary",
  "root_cause": "hypothesis",
  "fix_suggestion": "steps",
  "code_patch": "example_code"
}`;

    try {
      const result = await this.model.generateContent(prompt);
      return this.parseJson(result.response.text());
    } catch (error) {
      console.error('❌ Gemini Analysis failed:', error);
      throw new Error(`Gemini Engine: ${error.message}`);
    }
  }

  async generateClusterMetadata(issuesList) {
    this.validateKey();
    const list = issuesList.map(i => `- #${i.number}: ${i.title}`).join('\n');
    const prompt = `Review these duplicate issues and return metadata in JSON:
{
  "name": "short summary",
  "reason": "explanation"
}

ISSUES:
${list}`;

    try {
      const result = await this.model.generateContent(prompt);
      return this.parseJson(result.response.text());
    } catch (e) {
      console.error('❌ Gemini Cluster Metadata failed:', e);
      return { name: "Duplicate Cluster", reason: "Found semantically similar language across issues." };
    }
  }

  async generatePriorityScore(issue) {
    this.validateKey();
    let cfg;
    try { cfg = await Settings.findOne(); } catch(e) {};
    if(!cfg) cfg = { triageThreshold: 85 };

    const prompt = `Analyze this issue for severity (Sev-1, Sev-2, Sev-3) based on a threshold of ${cfg.triageThreshold}.
Return JSON:
{
  "score": number,
  "severity": "Sev-1" | "Sev-2" | "Sev-3",
  "reason": "logic"
}

ISSUE:
Title: ${issue.title}
Body: ${issue.body}`;

    try {
      const result = await this.model.generateContent(prompt);
      return this.parseJson(result.response.text());
    } catch (error) {
      console.error('❌ Gemini Priority Score failed:', error);
      return { score: 30, severity: "Sev-3", reason: "Fallback due to AI error: " + error.message };
    }
  }

  /**
   * DUPLICATE DETECTION (Gemini Implementation)
   */
  async detectDuplicateSemantic(newIssue, candidates) {
    this.validateKey();

    const candidatesText = candidates.map(c => `ID: ${c._id} | Title: ${c.githubData.title}`).join('\n');
    
    // REQUIREMENT 5: Direct prompt as requested
    const prompt = `Compare this issue with existing issues and detect if it is a duplicate. 
Consider semantic meaning, not just keywords.
Return JSON ONLY with isDuplicate (boolean), similarityScore (number 0-100), and matchedIssueId (string or null).

NEW ISSUE:
Title: ${newIssue.title}
Description: ${newIssue.description}

EXISTING ISSUES:
${candidatesText}`;

    try {
      console.log("[GEMINI] Starting Duplicate Detection via gemini-1.5-flash...");
      const result = await this.model.generateContent(prompt);
      const responseText = result.response.text();
      return this.parseJson(responseText);
    } catch (error) {
      console.error('❌ Gemini Duplicate Detection failed:', error);
      // Requirement 8: Log actual error and propogate
      throw new Error(`Gemini Engine Detection Error: ${error.message}`);
    }
  }

  async getSimpleChat(prompt) {
    this.validateKey();
    const result = await this.model.generateContent(prompt);
    return result.response.text();
  }

  async listAvailableModels() {
    this.validateKey();
    try {
      const result = await this.genAI.listModels();
      return result.models.map(m => m.name);
    } catch (e) {
      console.error("[GEMINI] ListModels FAILED:", e.message);
      return ["Error: " + e.message];
    }
  }

  /**
   * SEMANTIC EMBEDDINGS (Gemini text-embedding-004)
   */
  async generateEmbedding(text) {
    this.validateKey();
    try {
      const result = await this.embedModel.embedContent(text);
      return result.embedding.values; // Returns 768-dim float array
    } catch (error) {
      console.error('❌ Gemini Embedding failed:', error);
      return null;
    }
  }

  /**
   * Aggregated Insights (Gemini Implementation)
   */
  async generateGlobalInsights({ labels, reasons }) {
    this.validateKey();
    
    // De-dupe and summarize for prompt context limits
    const labelContext = [...new Set(labels)].slice(0, 30).join(', ');
    const reasonContext = reasons.slice(0, 20).join('\n - ');

    const prompt = `Analyze these aggregated platform metrics and return JSON:
{
  "macroSentiment": "Positive" | "Neutral" | "Critical",
  "keywordHotspots": ["list", "of", "3-5", "topics"]
}

LABELS: ${labelContext}
REASONS:
${reasonContext}`;

    try {
      const result = await this.model.generateContent(prompt);
      return this.parseJson(result.response.text());
    } catch (error) {
      console.error('❌ Gemini Insights failed:', error);
      return { macroSentiment: "Neutral", keywordHotspots: ["Maintenance", "Bug Fixes"] };
    }
  }

  /**
   * Local Math for Similarity
   */
  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] ** 2;
      normB += vecB[i] ** 2;
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * AUTOMATED LABELING (Gemini Implementation)
   */
  async generateLabels(title, body) {
    this.validateKey();
    const prompt = `You are a triage assistant for a software project. 
Generate 3 to 5 highly concise labels/tags for this issue. 
Use lowercase and replace spaces with hyphens. 
Return ONLY a JSON array of strings.

ISSUE:
Title: ${title}
Body: ${body || 'No description provided'}`;

    try {
      const result = await this.model.generateContent(prompt);
      const labels = this.parseJson(result.response.text());
      return Array.isArray(labels) ? labels : ["general"];
    } catch (error) {
      console.error('❌ Gemini Labeling failed:', error);
      return ["general"];
    }
  }
}

module.exports = new AiService();
