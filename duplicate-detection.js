document.addEventListener('DOMContentLoaded', () => {
    // Connect to websocket backend
    const socket = io('http://localhost:5000');
    
    const repoInput = document.getElementById('repo-input');
    const scanBtn = document.getElementById('scan-btn');
    const scanStatus = document.getElementById('scan-status');
    const clustersContainer = document.getElementById('clusters-container');

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

    scanBtn.addEventListener('click', async () => {
        const repoStr = repoInput.value.trim();
        if (!repoStr.includes('/')) {
            alert('Invalid repository format. Please use owner/repo');
            return;
        }

        const [owner, repo] = repoStr.split('/');
        
        scanBtn.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">refresh</span> Scanning...`;
        scanBtn.disabled = true;
        scanStatus.innerText = "Extracting embeddings for the latest 50 issues via Gemini (text-embedding-004)...";
        clustersContainer.innerHTML = '';

        try {
            const res = await fetch(`http://localhost:5000/api/issues/duplicate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ owner, repo })
            });
            const data = await res.json();
            
            if (!res.ok) throw new Error(data.error || 'Server error');

            scanStatus.innerText = `Scan complete. Processed ${data.processedCount} new embeddings. Found ${data.clusters.length} active clusters.`;
            renderClusters(data.clusters);
        } catch (e) {
            console.error(e);
            scanStatus.innerText = `Error: ${e.message}`;
            alert('Detection failed: ' + e.message);
        } finally {
            scanBtn.innerHTML = `<span class="material-symbols-outlined text-sm">search</span> Detect Duplicates`;
            scanBtn.disabled = false;
        }
    });

    const renderClusters = (clusters) => {
        if (clusters.length === 0) {
            clustersContainer.innerHTML = `
            <div class="ui-card p-16 text-center opacity-50">
                <span class="material-symbols-outlined text-5xl text-slate-600 mb-4 animate-pulse">check_circle</span>
                <h3 class="text-xl font-extrabold text-white mb-2">No Redundancy Detected</h3>
                <p class="text-sm text-slate-500 font-medium tracking-wide lowercase">The system architecture is currently optimized.</p>
            </div>`;
            return;
        }

        clustersContainer.innerHTML = clusters.map((cluster, index) => {

            // Canonical HTML
            const canonical = cluster.canonicalObj;
            let canonicalHtml = `
            <div class="col-span-1 md:col-span-2 lg:col-span-1 ui-row p-6 border-t-[4px] border-indigo-500 relative bg-indigo-500/5">
                <div class="absolute -top-3 left-6 px-3 py-1 rounded bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-widest">Canonical</div>
                <div class="flex justify-between items-start mb-4 mt-2">
                    <span class="text-[11px] font-bold text-slate-500">#${canonical.number}</span>
                    <span class="text-[10px] text-slate-500 font-bold uppercase tracking-widest flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> ${timeAgo(canonical.createdAt)}</span>
                </div>
                <h4 class="text-base font-bold text-white mb-3 hover:text-indigo-400 transition-colors cursor-pointer truncate" title="${canonical.title}">${canonical.title}</h4>
                <p class="text-xs text-slate-400 line-clamp-3 leading-relaxed">${canonical.body}</p>
                <div class="mt-5 flex flex-wrap gap-2">
                    ${canonical.labels.map(l => `<span class="px-2 py-0.5 rounded bg-white/5 text-slate-400 text-[10px] font-bold border border-white/5">${l}</span>`).join('')}
                </div>
            </div>`;

            // Duplicates HTML
            let duplicatesHtml = cluster.duplicatesObjs.map((dup, d_idx) => {
                const confData = cluster.duplicates.find(d => d.issueId === dup.id);
                // Don't render if it was marked as ignored
                if(confData.status === 'ignored') return '';

                let matchPercent = Math.round(confData.similarityScore * 100);
                
                return `
                <div class="ui-row p-6 border border-white/5 relative bg-slate-900/20 hover:bg-slate-900/40 transition-all ${confData.status === 'merged' ? 'grayscale opacity-40' : ''}" id="dup-card-${dup.id.replace(/[^a-zA-Z0-9]/g, '-')}">
                    ${confData.status === 'active' ? `
                    <button onclick="handleIgnore('${cluster.clusterId}', '${dup.id}')" class="absolute top-5 right-5 text-slate-500 hover:text-rose-500 transition-colors" title="Not a duplicate">
                        <span class="material-symbols-outlined text-sm">close</span>
                    </button>` : `<span class="absolute top-5 right-5 text-[10px] font-bold text-emerald-400 tracking-widest uppercase bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">MERGED</span>`}
                    
                    <div class="flex justify-between items-start mb-4">
                        <span class="text-[11px] font-bold text-slate-500">#${dup.number}</span>
                        <span class="text-[10px] text-slate-500 font-bold uppercase tracking-widest mr-8">${timeAgo(dup.createdAt)}</span>
                    </div>
                    <h4 class="text-base font-bold text-white mb-3 hover:text-indigo-400 transition-colors cursor-pointer truncate" title="${dup.title}">${dup.title}</h4>
                    <p class="text-xs text-slate-400 line-clamp-3 leading-relaxed">${dup.body}</p>
                    <div class="mt-5 pt-4 border-t border-white/5 text-center">
                        <span class="text-indigo-400 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                            <span class="material-symbols-outlined text-[14px]">bolt</span> ${matchPercent}% AI Correlation
                        </span>
                    </div>
                </div>`;
            }).join('');

            return `
            <div class="ui-card p-6 md:p-10 mb-10" id="cluster-container-${cluster.clusterId}">
                <div class="flex flex-col lg:flex-row lg:items-center justify-between mb-10 pb-8 border-b border-white/5 gap-6">
                    <div class="flex items-start gap-5">
                        <div class="w-14 h-14 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 shadow-xl">
                            <span class="material-symbols-outlined text-indigo-400 text-3xl">difference</span>
                        </div>
                        <div>
                            <h3 class="text-2xl font-extrabold text-white tracking-tight mb-1">Cluster ${index+1}: ${cluster.name}</h3>
                            <p class="text-sm text-slate-500 font-medium">${cluster.duplicatesObjs.length + 1} issues identified • <span class="text-emerald-400">${cluster.confidence}% confidence</span></p>
                        </div>
                    </div>
                    
                    <div class="flex gap-3">
                        <button onclick="handleMergeAll('${cluster.clusterId}')" class="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all flex items-center gap-3 shadow-lg">
                            <span class="material-symbols-outlined text-sm">call_merge</span> Solidify Node
                        </button>
                    </div>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    ${canonicalHtml}
                    ${duplicatesHtml}
                </div>
            </div>`;
        }).join('');
    };

    // Global Handlers
    window.handleMergeAll = async (clusterId) => {
        try {
            document.getElementById(`cluster-container-${clusterId}`).style.opacity = '0.5';
            await fetch('http://localhost:5000/api/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clusterId })
            });
            // Update visually over sockets
        } catch(e) {
            console.error(e);
            alert("Merge failed");
            document.getElementById(`cluster-container-${clusterId}`).style.opacity = '1';
        }
    };

    window.handleIgnore = async (clusterId, issueId) => {
        try {
            document.getElementById(`dup-card-${issueId.replace(/[^a-zA-Z0-9]/g, '-')}`).style.opacity = '0.5';
            await fetch('http://localhost:5000/api/ignore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clusterId, issueId })
            });
            document.getElementById(`dup-card-${issueId.replace(/[^a-zA-Z0-9]/g, '-')}`).remove();
        } catch (e) {
            console.error(e);
            alert("Remove failed");
        }
    };


    // --- SINGLE ISSUE CHECK LOGIC (Added per user request) ---
    const checkBtn = document.getElementById('check-btn');
    const checkStatus = document.getElementById('check-status');
    const checkResultContainer = document.getElementById('check-result-container');

    checkBtn.addEventListener('click', async () => {
        const title = document.getElementById('title').value.trim();
        const description = document.getElementById('description').value.trim();

        if (!title || !description) {
            alert('Title and description are required for specific checking.');
            return;
        }

        checkBtn.disabled = true;
        checkStatus.innerText = "Analyzing with Gemini...";
        checkResultContainer.classList.add('hidden');

        try {
            const res = await fetch('http://localhost:5000/api/issues/duplicate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, description })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || data.error || 'Server error');

            checkStatus.innerText = "Analysis Complete";
            checkResultContainer.classList.remove('hidden');
            
            if (data.isDuplicate && data.matchedIssue) {
                const issue = data.matchedIssue.githubData || data.matchedIssue;
                checkResultContainer.innerHTML = `
                    <div class="flex items-start gap-4 p-5 rounded-2xl bg-indigo-500/5 border border-indigo-500/20">
                        <div class="w-12 h-12 rounded-full bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                            <span class="material-symbols-outlined text-indigo-400">warning</span>
                        </div>
                        <div class="flex-1">
                            <div class="flex justify-between items-center mb-2">
                                <h4 class="text-indigo-400 font-bold text-sm uppercase tracking-widest flex items-center gap-2">
                                    <span class="w-2 h-2 rounded-full bg-indigo-500 animate-ping"></span>
                                    Potential Duplicate Found (${data.similarityScore}%)
                                </h4>
                                <span class="text-[10px] text-slate-500 font-bold">#${issue.number || 'DB'}</span>
                            </div>
                            <h5 class="text-white font-bold mb-2">${issue.title}</h5>
                            <p class="text-xs text-slate-500 line-clamp-2">${issue.body || 'No description available'}</p>
                            <a href="https://github.com/${data.matchedIssue.repo}/issues/${issue.number}" target="_blank" class="inline-flex items-center gap-2 mt-4 text-[10px] font-bold text-primary uppercase tracking-widest hover:text-white transition-colors">
                                View Original Issue <span class="material-symbols-outlined text-[14px]">open_in_new</span>
                            </a>
                        </div>
                    </div>
                `;
            } else {
                checkResultContainer.innerHTML = `
                    <div class="flex items-center gap-4 p-5 rounded-2xl bg-emerald-500/5 border border-emerald-500/20">
                        <div class="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                            <span class="material-symbols-outlined text-emerald-400">check_circle</span>
                        </div>
                        <div>
                            <h4 class="text-emerald-400 font-bold text-sm uppercase tracking-widest">No Duplicate Detected</h4>
                            <p class="text-[10px] text-slate-500 mt-1 uppercase tracking-widest">This issue appears to be unique in our database.</p>
                        </div>
                    </div>
                `;
            }

        } catch (e) {
            console.error(e);
            checkStatus.innerText = "Error: " + e.message;
            alert('Check failed: ' + e.message);
        } finally {
            checkBtn.disabled = false;
        }
    });

    socket.on('cluster_resolved', (data) => {
        const clusterBox = document.getElementById(`cluster-container-${data.clusterId}`);
        if(clusterBox) {
            clusterBox.classList.add('grayscale');
            clusterBox.style.opacity = '0.5';
            const btn = clusterBox.querySelector('button');
            if(btn) {
                btn.innerHTML = `<span class="material-symbols-outlined text-sm">check</span> Merged`;
                btn.disabled = true;
                btn.classList.add('bg-tertiary');
            }
        }
    });
});
