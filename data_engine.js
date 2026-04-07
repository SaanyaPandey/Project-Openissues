document.addEventListener('DOMContentLoaded', () => {
    const timeAgo = (dateStr) => {
        const seconds = Math.floor((new Date() - new Date(dateStr)) / 1000);
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + "y ago";
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + "mo ago";
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + "d ago";
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + "h ago";
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + "m ago";
        return "just now";
    };

    const repoInput = document.getElementById('global-repo-input');
    const analyzeBtn = document.getElementById('global-analyze-btn');
    const statusText = document.getElementById('global-status-text');
    const repoSuggestions = document.getElementById('repo-suggestions');
    const repoListItems = document.getElementById('repo-list-items');
    
    // Nav Profile Elements
    const navUsername = document.getElementById('nav-username');
    const navStatus = document.getElementById('nav-status');
    const navAvatar = document.getElementById('nav-avatar');

    const liveStream = document.getElementById('live-stream-container');
    const statTotal = document.getElementById('metric-total-issues');
    const statHighPrio = document.getElementById('metric-high-priority');
    const statDuplicates = document.getElementById('metric-duplicates');

    let userRepos = [];
    let isConnected = false;

    const fetchAndRenderRawIssues = async (repoSlug) => {
        liveStream.innerHTML = `
            <div class="ui-card p-6 flex flex-col items-center justify-center text-center opacity-50">
                <span class="material-symbols-outlined animate-spin text-indigo-500 mb-3">refresh</span>
                <span class="text-xs text-slate-400 font-bold uppercase tracking-widest">Bridging GitHub API...</span>
            </div>`;
            
        try {
            const res = await fetch(`http://localhost:5000/api/github/issues/${repoSlug}`);
            const data = await res.json();
            
            // The backend returns an array directly now, or an error object
            if (Array.isArray(data) && data.length > 0) {
                // Instantly mapped visual rendering of raw tickets!
                liveStream.innerHTML = data.map(issue => `
                    <div class="ui-card p-5 hover:bg-slate-900/50 transition-colors relative group w-full mb-3">
                        <div class="flex items-center gap-3 mb-3">
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">RAW Sync</span>
                            <span class="text-[11px] font-bold text-slate-500">#${issue.number}</span>
                            <span class="text-[10px] text-slate-500 ml-auto font-bold uppercase tracking-wider">${timeAgo(issue.created_at || issue.createdAt || new Date())}</span>
                        </div>
                        <h5 class="text-sm font-bold text-white mb-2 truncate group-hover:text-indigo-400 transition-colors">${issue.title}</h5>
                        <p class="text-xs text-slate-400 line-clamp-2 leading-relaxed">${issue.body || 'No description available.'}</p>
                    </div>
                `).join('');
                statTotal.innerText = data.length;
                return true;
            } else {
                liveStream.innerHTML = `<p class="text-sm text-on-surface-variant text-center my-10">No active issues found in ${repoSlug}</p>`;
                return false;
            }
        } catch(e) {
            console.error(e);
            liveStream.innerHTML = `<p class="text-sm text-error text-center my-10">Raw Github Fetch Failed: ${e.message}</p>`;
            return false;
        }
    };

    analyzeBtn.addEventListener('click', async () => {
        const repoStr = repoInput.value.trim();
        if(!repoStr.includes('/')) return alert('Please enter owner/repo manually');
        
        const [owner, repo] = repoStr.split('/');
        
        analyzeBtn.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">refresh</span> Processing Architecture...`;
        analyzeBtn.disabled = true;
        
        // 1. Initial UI Overrides
        statusText.innerText = `[1/3] Injecting raw active issues directly from Github REST...`;
        statTotal.innerHTML = `<span class="material-symbols-outlined animate-spin text-lg">refresh</span>`;
        statHighPrio.innerHTML = `<span class="material-symbols-outlined animate-spin text-lg">refresh</span>`;
        statDuplicates.innerHTML = `<span class="material-symbols-outlined animate-spin text-lg">refresh</span>`;
        
        // --- ASYNC PIPELINE ---
        
        const validSync = await fetchAndRenderRawIssues(repoStr);
        if(!validSync) {
            analyzeBtn.innerHTML = `<span class="material-symbols-outlined text-[18px]">bolt</span> Analyze Repository`;
            analyzeBtn.disabled = false;
            statusText.innerText = "Aborted due to Github API error or empty repository.";
            return;
        }

        try {
            // Priority 1: Duplicate Scan (Blocks the others to safely record accurate duplication math metrics)
            statusText.innerText = `[2/3] Analyzing vector similarities across the system...`;
            
            const dupRes = await fetch(`http://localhost:5000/api/issues/duplicate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ owner, repo })
            });

            // Final Step: Consolidated Refresh
            statusText.innerText = `[4/4] Synchronizing AI results with UI...`;
            
            const summaryRes = await fetch(`http://localhost:5000/api/dashboard/summary/${owner}/${repo}`);
            const summaryData = await summaryRes.json();

            if (summaryData.success) {
                // Update metrics
                statTotal.innerText = summaryData.totalIssues;
                statDuplicates.innerText = summaryData.duplicatesCount || '0';
                statHighPrio.innerText = (summaryData.distribution && summaryData.distribution['Sev-1']) ? summaryData.distribution['Sev-1'] : '0';
                
                // Render List (Live Stream)
                if (summaryData.issues && summaryData.issues.length > 0) {
                    liveStream.innerHTML = summaryData.issues.map(issue => `
                        <div class="ui-card p-5 hover:bg-slate-900/50 transition-colors relative group w-full mb-3">
                            <div class="flex items-center gap-3 mb-3">
                                <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">SYNCED</span>
                                <span class="text-[11px] font-bold text-slate-500">#${issue.number}</span>
                                <span class="text-[10px] text-slate-500 ml-auto font-bold uppercase tracking-wider">${timeAgo(issue.created_at || issue.createdAt || new Date())}</span>
                            </div>
                            <h5 class="text-sm font-bold text-white mb-2 truncate group-hover:text-indigo-400 transition-colors">${issue.title}</h5>
                            <p class="text-xs text-slate-400 line-clamp-2 leading-relaxed">${issue.body || 'No description available.'}</p>
                        </div>
                    `).join('');
                }
            }

            statusText.innerHTML = `<span class="text-indigo-400 tracking-widest text-xs uppercase font-bold">Inference Cycle Full Sync Complete.</span>`;

        } catch(e) {
            console.error('Fatal Pipeline Execution Error:', e);
            statusText.innerHTML = `<span class="text-error tracking-widest text-xs uppercase font-bold">Pipeline degraded: ${e.message}</span>`;
        } finally {
            analyzeBtn.innerHTML = `<span class="material-symbols-outlined text-[18px]">check_circle</span> Analysis Complete`;
            setTimeout(() => {
                analyzeBtn.innerHTML = `<span class="material-symbols-outlined text-[18px]">bolt</span> Analyze Repository`;
                analyzeBtn.disabled = false;
            }, 3000);
        }
    });
    // --- AUTH & REPO LOGIC ---
    const checkAuthStatus = async () => {
        try {
            const res = await fetch('http://localhost:5000/auth/status');
            const data = await res.json();
            if (data.connected) {
                isConnected = true;
                navUsername.innerText = data.username;
                navStatus.innerText = "Linked ✅";
                navAvatar.src = data.avatar;
                fetchUserRepos();
            }
        } catch(e) { console.warn("Auth check failed", e); }
    };

    const fetchUserRepos = async () => {
        try {
            const res = await fetch('http://localhost:5000/api/github/repos');
            userRepos = await res.json();
            renderRepoSuggestions();
        } catch(e) { console.warn("Repo fetch failed", e); }
    };

    const renderRepoSuggestions = (filter = "") => {
        const filtered = userRepos.filter(r => r.full_name.toLowerCase().includes(filter.toLowerCase()));
        if (filtered.length === 0 || filter === "") {
            // If empty filter, show first 5
            repoListItems.innerHTML = userRepos.slice(0, 5).map(r => `
                <div class="repo-item px-4 py-3 hover:bg-white/5 cursor-pointer flex flex-col gap-0.5 border-b border-white/5 last:border-0" data-full-name="${r.full_name}">
                    <span class="text-sm font-bold text-white">${r.full_name}</span>
                    <span class="text-[10px] text-on-surface-variant truncate">${r.description || 'No description'}</span>
                </div>
            `).join('');
        } else {
            repoListItems.innerHTML = filtered.map(r => `
                <div class="repo-item px-4 py-3 hover:bg-white/5 cursor-pointer flex flex-col gap-0.5 border-b border-white/5 last:border-0" data-full-name="${r.full_name}">
                    <span class="text-sm font-bold text-white">${r.full_name}</span>
                    <span class="text-[10px] text-on-surface-variant truncate">${r.description || 'No description'}</span>
                </div>
            `).join('');
        }

        document.querySelectorAll('.repo-item').forEach(item => {
            item.addEventListener('click', () => {
                repoInput.value = item.getAttribute('data-full-name');
                repoSuggestions.classList.add('hidden');
            });
        });
    };

    repoInput.addEventListener('focus', () => {
        if (isConnected && userRepos.length > 0) {
            repoSuggestions.classList.remove('hidden');
        }
    });

    repoInput.addEventListener('input', (e) => {
        if (isConnected) {
            renderRepoSuggestions(e.target.value);
            repoSuggestions.classList.remove('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (!repoInput.contains(e.target) && !repoSuggestions.contains(e.target)) {
            repoSuggestions.classList.add('hidden');
        }
    });

    checkAuthStatus();
});
