const express = require('express');
const router = express.Router();
const githubService = require('../services/githubService');
const aiService = require('../services/aiService');
const IssueAnalysis = require('../models/IssueAnalysis');
const User = require('../models/User');
const axios = require('axios');

// Helper to get user token from session
const getUserToken = async (req) => {
    const githubId = req.session.githubId;
    if (!githubId) return null;
    const user = await User.findOne({ githubId });
    return user ? user.accessToken : null;
};

// GET /api/github/repos → Fetch user's repositories
router.get('/github/repos', async (req, res) => {
    try {
        const token = await getUserToken(req);
        if (!token) return res.status(401).json({ error: 'GitHub not connected' });

        const resp = await axios.get('https://api.github.com/user/repos?sort=updated&per_page=50', {
            headers: { Authorization: `Bearer ${token}` }
        });
        res.json(resp.data.map(r => ({
            full_name: r.full_name,
            description: r.description,
            stargazers_count: r.stargazers_count,
            updated_at: r.updated_at
        })));
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/github/issues/:owner/:repo → Fetch latest issues for a repo
router.get('/github/issues/:owner/:repo', async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const token = await getUserToken(req);
        
        // Pass token to githubService (it falls back to GITHUB_TOKEN if null)
        const issues = await githubService.fetchIssuesBatch(owner, repo, 25, token);
        res.json(issues);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/issue/:owner/:repo/:issueNumber
router.get('/issue/:owner/:repo/:issueNumber', async (req, res) => {
    const { owner, repo, issueNumber } = req.params;
    const issueId = `${owner}/${repo}#${issueNumber}`;

    try {
        const token = await getUserToken(req);
        // 1. Check if we already have it cached
        let issueDoc = await IssueAnalysis.findOne({ issueId });

        // 2. Fetch fresh from Github
        const liveData = await githubService.fetchIssue(owner, repo, issueNumber, token);

    if (!issueDoc) {
      issueDoc = new IssueAnalysis({
        issueId,
        repo: `${owner}/${repo}`,
        number: issueNumber,
        githubData: liveData
      });
      await issueDoc.save();
    } else {
      issueDoc.githubData = liveData;
      issueDoc.updatedAt = Date.now();
      await issueDoc.save();
    }

    res.json(issueDoc);
  } catch (error) {
    console.error('Route error fetching issue:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/analyze
router.post('/analyze', async (req, res) => {
  const { issueId } = req.body;

  try {
    const issueDoc = await IssueAnalysis.findOne({ issueId });
    if (!issueDoc) {
      return res.status(404).json({ error: 'Issue not found in database. Fetch it first.' });
    }

    // Call Gemini
    const analysisResult = await aiService.analyzeIssue(issueDoc.githubData);

    // Update Cache
    issueDoc.aiAnalysis = analysisResult;
    issueDoc.status = 'analyzed';
    issueDoc.updatedAt = Date.now();
    await issueDoc.save();

    // Broadcast via socket could be handled in server.js but we just return and let frontend emit 'request_analysis_complete' if needed.
    // We export the io handler logic to server.js instead
    
    // Using req.app.get('io') to emit via socket if needed
    const io = req.app.get('io');
    if (io) {
      io.emit('analysis_complete', { issueId, analysis: analysisResult });
    }

    res.json(issueDoc);
  } catch (error) {
    console.error('❌ Route error analyzing issue:', error);
    res.status(500).json({ error: error.message });
  }
});

// NEW ENDPOINT: POST /api/issues/analyze (Direct Title & Description)
router.post('/issues/analyze', async (req, res) => {
  const { title, description } = req.body;

  // Validation
  if (!title || !description) {
    return res.status(400).json({ error: "Missing required fields: 'title' and 'description' are mandatory." });
  }

  try {
    console.log(`[AI SERVICE] Starting analysis for: ${title}`);
    
    // Pass to AI Service
    const analysisResult = await aiService.analyzeIssue({
      title,
      body: description,
      labels: [], // No labels for direct input
      commentsData: [] // No comments for direct input
    });

    res.json({
      success: true,
      analysis: analysisResult
    });
  } catch (error) {
    console.error('❌ AI Pipeline Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      debug_info: "Ensure GEMINI_API_KEY is correctly set in .env"
    });
  }
});

// Scaffolded route for generate-pr
router.post('/generate-pr', async (req, res) => {
  const { issueId } = req.body;
  try {
    const issueDoc = await IssueAnalysis.findOne({ issueId });
    if (!issueDoc) return res.status(404).json({ error: 'Not found' });
    
    // Normally you would use Github APIs to create a branch, commit code_patch, and open a PR.
    issueDoc.status = 'pr_generated';
    await issueDoc.save();
    
    res.json({ success: true, message: 'PR Draft created successfully (simulated from backend).', url: `https://github.com/${issueDoc.repo}/compare` });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Scaffolded route for routing to team
router.post('/route', async (req, res) => {
  const { issueId, team } = req.body;
  res.json({ success: true, message: `Issue assigned to ${team || 'Triage'} team successfully.` });
});

// --- DUPLICATE DETECTION ROUTES ---

const IssueEmbedding = require('../models/IssueEmbedding');
const DuplicateCluster = require('../models/DuplicateCluster');

// Primary Duplicate Detection Route (Requirement 2)
router.post('/issues/duplicate', async (req, res) => {
    console.log("[BACKEND] Duplicate check request received:", req.body);
    const { title, description } = req.body;

    // 1. Validation (Requirement 7)
    if (!title || !description) {
        return res.status(400).json({ message: "Title and description required" });
    }

    try {
        console.log(`[DUPLICATE CHECK] Analyzing: ${title}`);

        // 2. Fetch Existing Issues from MongoDB (Requirement 3)
        // We limit to 50 most recent to ensure we stay within context limits
        const existingIssues = await IssueAnalysis.find().sort({ updatedAt: -1 }).limit(50);

        // 3. Fallback Logic: Simple String Similarity (Requirement 5)
        // Check for exact or highly similar title match (case-insensitive)
        const localMatch = existingIssues.find(issue => 
            issue.githubData.title.toLowerCase() === title.toLowerCase() ||
            title.toLowerCase().includes(issue.githubData.title.toLowerCase()) ||
            issue.githubData.title.toLowerCase().includes(title.toLowerCase())
        );

        if (localMatch) {
            console.log(`[DUPLICATE CHECK] Local match found: ${localMatch.githubData.title}`);
            return res.json({
                isDuplicate: true,
                similarityScore: 95, // High confidence for direct string match
                matchedIssue: localMatch
            });
        }

        // 4. Use Gemini for Semantic Similarity Check (Requirement 4)
        try {
            const aiResult = await aiService.detectDuplicateSemantic({ title, description }, existingIssues);
            
            let matchedIssue = null;
            if (aiResult.isDuplicate && aiResult.matchedIssueId) {
                matchedIssue = existingIssues.find(i => i._id.toString() === aiResult.matchedIssueId);
            }

            return res.json({
                isDuplicate: aiResult.isDuplicate,
                similarityScore: aiResult.similarityScore,
                matchedIssue: matchedIssue
            });

        } catch (aiError) {
            // Requirement 5 & 6: Log actual error and don't crash
            console.error('❌ Gemini Similarity Check Failed:', aiError);
            
            // Re-confirm no local match was missed (already checked above, but as a secondary fallback)
            return res.json({
                isDuplicate: false,
                similarityScore: 0,
                matchedIssue: null,
                message: "AI processing failed, no direct title match found."
            });
        }

    } catch (error) {
        console.error('❌ Duplicate Detection Route Error:', error);
        res.status(500).json({ error: error.message });
    }
});

const detectDuplicatesHandler = async (req, res) => {
  const { owner, repo } = req.body;
  const repoSlug = `${owner}/${repo}`;
  
  try {
    // 1. Fetch latest raw issues from Github
    const rawIssues = await githubService.fetchIssuesBatch(owner, repo, 50);
    
    // 2. Fetch existing embeddings for this repo mapped by issueId
    const existingEmbeds = await IssueEmbedding.find({ repo: repoSlug });
    const existingMap = new Map();
    existingEmbeds.forEach(e => existingMap.set(e.issueId, e));

    let processedCount = 0;

    // 3. Process new vectors (loop sequentially to respect API rate limits loosely)
    for (const raw of rawIssues) {
      if (!existingMap.has(raw.id)) {
        const textToEmbed = `Title: ${raw.title}\nBody: ${raw.body}`;
        const vector = await aiService.generateEmbedding(textToEmbed);
        
        if (!vector) {
          console.warn(`⚠️ Skipping embedding for issue #${raw.number} due to AI failure.`);
          continue; 
        }

        const newEmbed = new IssueEmbedding({
          issueId: raw.id,
          repo: repoSlug,
          number: raw.number,
          title: raw.title,
          body: raw.body,
          labels: raw.labels,
          createdAt: raw.createdAt,
          vector
        });
        await newEmbed.save();
        existingMap.set(raw.id, newEmbed);
        processedCount++;
      }
    }

    // 4. Clustering (O(N^2) comparison on N=50 is very fast and cheap)
    const activeEmbeds = Array.from(existingMap.values());
    const matchedSet = new Set();
    const newClusters = [];

    for (let i = 0; i < activeEmbeds.length; i++) {
        if (matchedSet.has(activeEmbeds[i].issueId)) continue;
        
        const cluster = {
          canonical: activeEmbeds[i],
          duplicates: []
        };
        matchedSet.add(activeEmbeds[i].issueId);

        for (let j = i + 1; j < activeEmbeds.length; j++) {
            if (matchedSet.has(activeEmbeds[j].issueId)) continue;
            
            const similarity = aiService.cosineSimilarity(activeEmbeds[i].vector, activeEmbeds[j].vector);
            if (similarity > 0.85) { // Threshold
                cluster.duplicates.push({ issue: activeEmbeds[j], similarityScore: similarity });
                matchedSet.add(activeEmbeds[j].issueId);
            }
        }

        if (cluster.duplicates.length > 0) {
            newClusters.push(cluster);
        }
    }

    const responseClusters = [];
    
    for (const c of newClusters) {
        const items = [c.canonical, ...c.duplicates.map(d=>d.issue)];
        const meta = await aiService.generateClusterMetadata(items);
        
        const clusterId = `${repoSlug}-cluster-${c.canonical.number}`;
        
        let dbCluster = await DuplicateCluster.findOne({ clusterId });
        if (!dbCluster) {
            dbCluster = new DuplicateCluster({
                clusterId,
                repo: repoSlug,
                name: meta.name,
                reason: meta.reason,
                canonicalIssue: c.canonical.issueId,
                duplicates: c.duplicates.map(d => ({
                    issueId: d.issue.issueId,
                    similarityScore: d.similarityScore
                })),
                confidence: Math.round(c.duplicates[0].similarityScore * 100)
            });
            await dbCluster.save();
        }
        responseClusters.push({
            ...dbCluster.toObject(),
            canonicalObj: c.canonical,
            duplicatesObjs: c.duplicates.map(d => d.issue)
        });
    }

    res.json({ success: true, processedCount, clusters: responseClusters });
  } catch (error) {
    console.error('❌ Duplicate detection failed:', error);
    res.status(500).json({ error: error.message });
  }
};

router.post('/detect-duplicates', (req, res) => {
    console.log(`[BACKEND] Legacy Request received (detect-duplicates) for: ${req.body.owner}/${req.body.repo}`);
    return detectDuplicatesHandler(req, res);
});

// GET clusters for a repo - used by data_engine.js
router.get('/duplicate/clusters/:owner/:repo', async (req, res) => {
    const repoSlug = `${req.params.owner}/${req.params.repo}`;
    try {
        const clusters = await DuplicateCluster.find({ repo: repoSlug });
        res.json({ success: true, clusters });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});


router.post('/merge', async (req, res) => {
  const { clusterId } = req.body;
  try {
    const cluster = await DuplicateCluster.findOne({ clusterId });
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });
    
    cluster.duplicates.forEach(d => {
        if(d.status === 'active') d.status = 'merged'
    });
    await cluster.save();
    
    const io = req.app.get('io');
    if (io) io.emit('cluster_resolved', { clusterId });

    res.json({ success: true, message: 'Duplicates merged and closed successfully.' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/ignore', async (req, res) => {
  const { clusterId, issueId } = req.body;
  try {
    const cluster = await DuplicateCluster.findOne({ clusterId });
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });
    
    const dup = cluster.duplicates.find(d => d.issueId === issueId);
    if(dup) dup.status = 'ignored';
    await cluster.save();
    
    res.json({ success: true, message: 'Issue marked as non-duplicate.' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// --- PRIORITY ENGINE ROUTES ---

const PriorityTask = require('../models/PriorityTask');

router.post('/priority/scan', async (req, res) => {
  const { owner, repo } = req.body;
  const repoSlug = `${owner}/${repo}`;
  
  try {
    // Limit to 25 to respect rapid AI generation and quick UI mapping
    const rawIssues = await githubService.fetchIssuesBatch(owner, repo, 25);
    
    let processedCount = 0;
    
    for (const raw of rawIssues) {
        // Find existing to avoid massive duplicate token burns
        let pTask = await PriorityTask.findOne({ issueId: raw.id });
        
        if (!pTask) {
            // First time seeing this issue, generate severe metric
            const aiData = await aiService.generatePriorityScore(raw);
            
            pTask = new PriorityTask({
                issueId: raw.id,
                repo: repoSlug,
                number: raw.number,
                title: raw.title,
                body: raw.body,
                labels: raw.labels,
                createdAt: raw.createdAt,
                
                score: aiData.score,
                severity: aiData.severity,
                sentimentTag: aiData.sentimentTag,
                trend: aiData.trend,
                reason: aiData.reason
            });
            await pTask.save();
            processedCount++;
        }
    }
    
    // Broadcast updates to clients
    const io = req.app.get('io');
    if (io) io.emit('priority_update', { repo: repoSlug });

    res.json({ success: true, processedCount, message: 'Priority scan complete.' });
  } catch (error) {
    console.error('Error scanning priority:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/priority/metrics/:owner/:repo', async (req, res) => {
    const repoSlug = `${req.params.owner}/${req.params.repo}`;
    try {
        const stats = await PriorityTask.aggregate([
            { $match: { repo: repoSlug, status: 'active' } },
            { $group: { _id: "$severity", count: { $sum: 1 } } }
        ]);
        
        const distribution = { "Sev-1": 0, "Sev-2": 0, "Sev-3": 0 };
        let total = 0;
        
        stats.forEach(s => {
            distribution[s._id] = s.count;
            total += s.count;
        });

        // Strain Index = (Sev1*10 + Sev2*5 + Sev3*1) / (Max Expected or scaled)
        // Let's cap max expected at something like 50 for a nice visual scaling
        let roughScore = ((distribution["Sev-1"] * 10) + (distribution["Sev-2"] * 5) + (distribution["Sev-3"] * 1));
        // Scale to 0-10 natively
        let normalizedIndex = total > 0 ? (roughScore / Math.max(total * 5, 10)) * 10 : 0;
        if (normalizedIndex > 10) normalizedIndex = 10;
        if (normalizedIndex < 0) normalizedIndex = 0;

        res.json({ success: true, strainIndex: normalizedIndex.toFixed(1), distribution, total });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/priority/list/:owner/:repo', async (req, res) => {
    const repoSlug = `${req.params.owner}/${req.params.repo}`;
    try {
        const limit = parseInt(req.query.limit) || 25;
        const issues = await PriorityTask.find({ repo: repoSlug, status: 'active' })
             .sort({ score: -1, createdAt: -1 })
             .limit(limit);
             
        res.json({ success: true, issues });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// --- DASHBOARD CONSOLIDATED SUMMARY ---
router.get('/dashboard/summary/:owner/:repo', async (req, res) => {
    const { owner, repo } = req.params;
    const repoSlug = `${owner}/${repo}`;
    
    try {
        const token = await getUserToken(req);
        
        // 1. Fetch Latest Raw Issues (Live from GitHub)
        const rawIssues = await githubService.fetchIssuesBatch(owner, repo, 30, token);
        
        // 2. Fetch Priority Issues from DB
        const priorityIssues = await PriorityTask.find({ repo: repoSlug, status: 'active' })
            .sort({ score: -1, createdAt: -1 })
            .limit(10);
            
        // 3. Fetch Insights from Cache
        const insights = await ReportCache.findOne({ repo: repoSlug });
        
        // 4. Calculate distributions for metrics
        const stats = await PriorityTask.aggregate([
            { $match: { repo: repoSlug, status: 'active' } },
            { $group: { _id: "$severity", count: { $sum: 1 } } }
        ]);
        
        const distribution = { "Sev-1": 0, "Sev-2": 0, "Sev-3": 0 };
        stats.forEach(s => { distribution[s._id] = s.count; });

        // 5. Duplicate Clusters
        const clusters = await DuplicateCluster.find({ repo: repoSlug });

        res.json({
            success: true,
            totalIssues: rawIssues.length,
            issues: rawIssues,
            priorityIssues,
            insights: insights || {},
            distribution,
            duplicatesCount: clusters.length
        });
    } catch (error) {
        console.error('Dashboard summary error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Alias for legacy or mismatched frontend calls
router.get('/issues/prioritize/:owner/:repo', async (req, res) => {
    const { owner, repo } = req.params;
    res.redirect(`/api/priority/list/${owner}/${repo}`);
});

// --- INSIGHTS ENGINE ROUTES ---

const ReportCache = require('../models/ReportCache');

router.get('/insights/:owner/:repo', async (req, res) => {
    const repoSlug = `${req.params.owner}/${req.params.repo}`;
    try {
        const cache = await ReportCache.findOne({ repo: repoSlug });
        if (!cache) {
            return res.json({ success: false, message: 'No insights generated yet. Please trigger a manual report.' });
        }
        res.json({ success: true, insights: cache });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// GLOBAL INSIGHTS: GET /api/issues/insights
router.get('/issues/insights', async (req, res) => {
    try {
        const totalIssues = await IssueAnalysis.countDocuments();
        
        // Priority Breakdown
        const highPriorityCount = await PriorityTask.countDocuments({ severity: 'Sev-1', status: 'active' });
        const mediumPriorityCount = await PriorityTask.countDocuments({ severity: 'Sev-2', status: 'active' });
        const lowPriorityCount = await PriorityTask.countDocuments({ severity: 'Sev-3', status: 'active' });
        
        // Duplicates
        const duplicateCount = await DuplicateCluster.countDocuments();
        
        // Recent Issues (Latest 5)
        const recentIssues = await IssueAnalysis.find()
            .sort({ "githubData.createdAt": -1 })
            .limit(5);

        // Most Common Issue Type (Labels)
        const commonTypes = await IssueAnalysis.aggregate([
            { $unwind: "$githubData.labels" },
            { $group: { _id: "$githubData.labels", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 1 }
        ]);
        
        const mostCommonIssueType = commonTypes.length > 0 ? commonTypes[0]._id : "Unknown";

        res.json({
            success: true,
            totalIssues,
            highPriorityCount,
            mediumPriorityCount,
            lowPriorityCount,
            mostCommonIssueType,
            recentIssues,
            duplicateCount
        });
    } catch (e) {
        console.error('Insights API Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// --- AUTOMATED LABELING PIPELINE ---

router.post('/issues/auto-label-all', async (req, res) => {
    try {
        console.log("[AUTO-LABEL] Starting batch labeling process...");
        
        // 1. Fetch all issues from MongoDB
        const allIssues = await IssueAnalysis.find();
        if (allIssues.length === 0) {
            return res.json({ success: true, message: "No issues found to label.", issues: [] });
        }

        const BATCH_SIZE = 5;
        const results = [];

        // 2. Process in chunks to avoid Gemini rate limiting
        for (let i = 0; i < allIssues.length; i += BATCH_SIZE) {
            const batch = allIssues.slice(i, i + BATCH_SIZE);
            
            const batchPromises = batch.map(async (issue) => {
                const aiLabels = await aiService.generateLabels(issue.githubData.title, issue.githubData.body);
                
                // Update the issue in MongoDB
                issue.githubData.labels = aiLabels;
                issue.status = 'labeled';
                issue.updatedAt = new Date();
                await issue.save();
                
                return {
                    id: issue._id,
                    issueId: issue.issueId,
                    number: issue.number,
                    title: issue.githubData.title,
                    labels: aiLabels
                };
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            console.log(`[AUTO-LABEL] Processed chunk ${Math.floor(i/BATCH_SIZE) + 1} of ${Math.ceil(allIssues.length/BATCH_SIZE)}`);
        }

        res.json({ 
            success: true, 
            message: `Successfully labeled ${results.length} issues using Gemini AI.`,
            issues: results 
        });

    } catch (error) {
        console.error('❌ Auto-Label API Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- AI DIAGNOSTICS ---
router.get('/test-ai', async (req, res) => {
    try {
        console.log("[DIAG] Starting AI Self-Test...");
        const models = await aiService.listAvailableModels();
        console.log("[DIAG] Available Models:", models);

        let chatResponse = "Skipped chat test due to earlier failures";
        try {
            chatResponse = await aiService.getSimpleChat("Hello Gemini! Are you online?");
        } catch (chatError) {
            console.error("[DIAG] Simple Chat FAILED:", chatError.message);
            chatResponse = "Error: " + chatError.message;
        }

        res.json({
            success: true,
            status: "Connected",
            availableModels: models,
            geminiResponse: chatResponse,
            currentModel: "gemini-1.5-flash"
        });
    } catch (e) {
        console.error("[DIAG] AI Self-Test FAILED:", e.message);
        res.status(500).json({
            success: false,
            error: e.message,
            stack: e.stack
        });
    }
});

router.post('/insights/generate', async (req, res) => {
    const { owner, repo } = req.body;
    const repoSlug = `${owner}/${repo}`;
    
    try {
        // 1. Math Aggregations
        const DuplicateCluster = require('../models/DuplicateCluster');
        
        const mergedDuplicates = await DuplicateCluster.countDocuments({ repo: repoSlug, status: 'merged' });
        const ignoredDuplicates = await DuplicateCluster.countDocuments({ repo: repoSlug, status: 'ignored' });
        
        let accuracy = 0;
        if ((mergedDuplicates + ignoredDuplicates) > 0) {
            accuracy = (mergedDuplicates / (mergedDuplicates + ignoredDuplicates)) * 100;
        } else {
            accuracy = 95.0; // Baseline mock if fresh DB
        }
        
        const productivityHrs = mergedDuplicates * 1.5; // Saving roughly 1.5 hrs tracking bugs
        
        // Fetch arrays from PriorityTasks to send to NLP
        const pTasks = await PriorityTask.find({ repo: repoSlug }).limit(50);
        let aggLabels = [];
        let aggReasons = [];
        pTasks.forEach(pt => {
            if(pt.labels) aggLabels = aggLabels.concat(pt.labels);
            if(pt.reason) aggReasons.push(pt.reason);
        });
        
        // 2. Gemini Native Hook
        const aiData = await aiService.generateGlobalInsights({ labels: aggLabels, reasons: aggReasons });
        
        // 3. Mocked Activity Logs mapping recent tracking events
        const mockEvents = [
            { eventType: "Priority Escalation", target: "System Component", confidence: 91, outcome: "High Prio", timestamp: new Date(Date.now() - 1000 * 60 * 5) },
            { eventType: "Anomaly Detected", target: "Rate Limits", confidence: 88, outcome: "Flagged", timestamp: new Date(Date.now() - 1000 * 60 * 15) }
        ];

        // 4. Update MongoDB Cache
        let report = await ReportCache.findOne({ repo: repoSlug });
        if (!report) report = new ReportCache({ repo: repoSlug });
        
        report.productivityLiftHrs = productivityHrs;
        report.deduplicationAccuracy = accuracy;
        report.macroSentiment = aiData.macroSentiment || "Neutral";
        report.keywordHotspots = aiData.keywordHotspots;
        report.activityLogs = mockEvents;
        report.generatedAt = new Date();
        
        await report.save();

        res.json({ success: true, insights: report });
    } catch(error) {
        console.error('Insights generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- GITHUB RAW PROXY ---
router.get('/github/issues/:owner/:repo', async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const issues = await githubService.fetchIssuesBatch(owner, repo, 30);
        res.json({ success: true, issues });
    } catch(e) {
        console.error('GitHub API Proxy Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// --- SETTINGS ENGINE API ---

const Settings = require('../models/Settings');

// Fallback singleton factory pattern
const getSingletonConfig = async () => {
    let cfg = await Settings.findOne();
    if(!cfg) {
        cfg = new Settings({});
        await cfg.save();
    }
    return cfg;
};

router.get('/settings', async (req, res) => {
    try {
        const config = await getSingletonConfig();
        res.json({ success: true, settings: config });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/settings/update', async (req, res) => {
    try {
        let config = await getSingletonConfig();
        
        // Dynamically apply payload merges
        const updatableKeys = ['triageThreshold', 'autoCategorization', 'sentimentAnalysis', 'connectedRepos', 'githubConnected'];
        
        for(let key of updatableKeys) {
            if(req.body[key] !== undefined) {
                config[key] = req.body[key];
            }
        }
        config.lastUpdated = new Date();
        await config.save();
        
        res.json({ success: true, settings: config });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// --- GLOBAL TRIAGE PIPELINE ---

router.post('/triage/run', async (req, res) => {
    const { owner, repo } = req.body;
    if (!owner || !repo) {
        return res.status(400).json({ error: 'owner and repo are required.' });
    }
    const repoSlug = `${owner}/${repo}`;
    const io = req.app.get('io');

    const emit = (step, msg, data = {}) => {
        if (io) io.emit('triage_progress', { step, msg, ...data });
    };

    try {
        // STEP 1: Fetch Issues
        emit('fetch', 'Scanning issues from GitHub...');
        const rawIssues = await githubService.fetchIssuesBatch(owner, repo, 30);

        emit('fetch', `Fetched ${rawIssues.length} issues.`, { issuesCount: rawIssues.length });

        // STEP 2: Duplicate Detection
        emit('duplicates', 'Detecting semantic duplicates...');

        const existingEmbeds = await IssueEmbedding.find({ repo: repoSlug });
        const existingMap = new Map();
        existingEmbeds.forEach(e => existingMap.set(e.issueId, e));

        for (const raw of rawIssues) {
            if (!existingMap.has(raw.id)) {
                const textToEmbed = `Title: ${raw.title}\nBody: ${raw.body}`;
                const vector = await aiService.generateEmbedding(textToEmbed);
                
                if (!vector) {
                  console.warn(`⚠️ Skipping embedding for issue #${raw.number} in triage run.`);
                  continue;
                }

                const newEmbed = new IssueEmbedding({
                    issueId: raw.id, repo: repoSlug, number: raw.number,
                    title: raw.title, body: raw.body, labels: raw.labels,
                    createdAt: raw.createdAt, vector
                });
                await newEmbed.save();
                existingMap.set(raw.id, newEmbed);
            }
        }

        const activeEmbeds = Array.from(existingMap.values());
        const matchedSet = new Set();
        let dupCount = 0;

        for (let i = 0; i < activeEmbeds.length; i++) {
            if (matchedSet.has(activeEmbeds[i].issueId)) continue;
            const cluster = { canonical: activeEmbeds[i], duplicates: [] };
            matchedSet.add(activeEmbeds[i].issueId);
            for (let j = i + 1; j < activeEmbeds.length; j++) {
                if (matchedSet.has(activeEmbeds[j].issueId)) continue;
                const similarity = aiService.cosineSimilarity(activeEmbeds[i].vector, activeEmbeds[j].vector);
                if (similarity > 0.85) {
                    cluster.duplicates.push({ issue: activeEmbeds[j], similarityScore: similarity });
                    matchedSet.add(activeEmbeds[j].issueId);
                }
            }
            if (cluster.duplicates.length > 0) {
                dupCount++;
                const items = [cluster.canonical, ...cluster.duplicates.map(d => d.issue)];
                const meta = await aiService.generateClusterMetadata(items);
                const clusterId = `${repoSlug}-cluster-${cluster.canonical.number}`;
                const existing = await DuplicateCluster.findOne({ clusterId });
                if (!existing) {
                    const dbCluster = new DuplicateCluster({
                        clusterId, repo: repoSlug, name: meta.name, reason: meta.reason,
                        canonicalIssue: cluster.canonical.issueId,
                        duplicates: cluster.duplicates.map(d => ({ issueId: d.issue.issueId, similarityScore: d.similarityScore })),
                        confidence: Math.round(cluster.duplicates[0].similarityScore * 100)
                    });
                    await dbCluster.save();
                }
            }
        }

        emit('duplicates', `Duplicate detection complete. ${dupCount} cluster(s) found.`, { dupCount });

        // STEP 3: Priority Scoring
        emit('priority', 'Scoring issue priority levels...');
        let criticalCount = 0;

        for (const raw of rawIssues) {
            let pTask = await PriorityTask.findOne({ issueId: raw.id });
            if (!pTask) {
                const aiData = await aiService.generatePriorityScore(raw);
                pTask = new PriorityTask({
                    issueId: raw.id, repo: repoSlug, number: raw.number,
                    title: raw.title, body: raw.body, labels: raw.labels,
                    createdAt: raw.createdAt, score: aiData.score,
                    severity: aiData.severity, sentimentTag: aiData.sentimentTag,
                    trend: aiData.trend, reason: aiData.reason
                });
                await pTask.save();
                if (aiData.severity === 'Sev-1') criticalCount++;
            }
        }

        emit('priority', `Priority scoring complete. ${criticalCount} critical issue(s) detected.`, { criticalCount });

        // STEP 4: Insights Generation
        emit('insights', 'Generating AI macro-insights...');

        const mergedDups = await DuplicateCluster.countDocuments({ repo: repoSlug, status: 'merged' });
        const ignoredDups = await DuplicateCluster.countDocuments({ repo: repoSlug, status: 'ignored' });
        const accuracy = (mergedDups + ignoredDups) > 0 ? (mergedDups / (mergedDups + ignoredDups)) * 100 : 95.0;
        const productivityHrs = mergedDups * 1.5;

        const pTasks = await PriorityTask.find({ repo: repoSlug }).limit(50);
        let aggLabels = [];
        let aggReasons = [];
        pTasks.forEach(pt => {
            if (pt.labels) aggLabels = aggLabels.concat(pt.labels);
            if (pt.reason) aggReasons.push(pt.reason);
        });

        const aiData = await aiService.generateGlobalInsights({ labels: aggLabels, reasons: aggReasons });

        let report = await ReportCache.findOne({ repo: repoSlug });
        if (!report) report = new ReportCache({ repo: repoSlug });
        report.productivityLiftHrs = productivityHrs;
        report.deduplicationAccuracy = accuracy;
        report.macroSentiment = aiData.macroSentiment || 'Neutral';
        report.keywordHotspots = aiData.keywordHotspots;
        report.activityLogs = [
            { eventType: 'Priority Escalation', target: 'Triage Run', confidence: 94, outcome: 'High Prio', timestamp: new Date() },
            { eventType: 'Anomaly Detected', target: 'Issue Spike', confidence: 87, outcome: 'Flagged', timestamp: new Date(Date.now() - 60000) }
        ];
        report.generatedAt = new Date();
        await report.save();

        emit('complete', 'AI Triage complete!', {
            issuesCount: rawIssues.length,
            dupCount,
            criticalCount,
            repo: repoSlug
        });

        res.json({
            success: true,
            results: { issuesCount: rawIssues.length, dupCount, criticalCount, repo: repoSlug }
        });

    } catch (error) {
        console.error('Triage pipeline error:', error.message);
        emit('error', `Triage failed: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Catch-all for unknown /api/ routes
router.use((req, res) => {
    res.status(404).json({ message: "Route not found" });
});

module.exports = router;
