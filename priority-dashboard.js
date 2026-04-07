document.addEventListener('DOMContentLoaded', () => {
    // Basic TimeFormatter
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

    const socket = io('http://localhost:5000');
    
    const repoInput = document.getElementById('repo-input');
    const scanBtn = document.getElementById('scan-btn');
    const scanStatus = document.getElementById('scan-status');
    const issuesList = document.getElementById('issues-list');

    // Metrics bindings
    const strainIndex = document.getElementById('strain-index');
    const sev1Count = document.getElementById('sev1-count');
    const sev2Count = document.getElementById('sev2-count');
    const sev3Count = document.getElementById('sev3-count');
    const sev1Bar = document.getElementById('sev1-bar');
    const sev2Bar = document.getElementById('sev2-bar');
    const sev3Bar = document.getElementById('sev3-bar');

    const updateDisplay = async () => {
        const repoStr = repoInput.value.trim();
        if (!repoStr.includes('/')) return;
        
        try {
            // 1. Fetch Metrics
            const metricsRes = await fetch(`http://localhost:5000/api/priority/metrics/${repoStr}`);
            console.log('Metrics Fetch Status:', metricsRes.status);
            if (metricsRes.status === 404) {
                console.error('Priority Metrics Endpoint Not Found (404)');
            }
            const metrics = await metricsRes.json();
            
            if (metrics.success) {
                strainIndex.innerText = metrics.strainIndex;
                sev1Count.innerText = metrics.distribution['Sev-1'] || 0;
                sev2Count.innerText = metrics.distribution['Sev-2'] || 0;
                sev3Count.innerText = metrics.distribution['Sev-3'] || 0;
                
                const tot = metrics.total || 1;
                sev1Bar.style.width = `${((metrics.distribution['Sev-1']||0)/tot)*100}%`;
                sev2Bar.style.width = `${((metrics.distribution['Sev-2']||0)/tot)*100}%`;
                sev3Bar.style.width = `${((metrics.distribution['Sev-3']||0)/tot)*100}%`;
            }

            // 2. Fetch List
            const listRes = await fetch(`http://localhost:5000/api/priority/list/${repoStr}`);
            console.log('List Fetch Status:', listRes.status);
            if (listRes.status === 404) {
                console.error('Priority List Endpoint Not Found (404)');
            }
            const listData = await listRes.json();

            if (listData.success && listData.issues && listData.issues.length > 0) {
                issuesList.innerHTML = listData.issues.map(issue => {
                    let borderCol, bgCol, textCol, badgeCol, shadowCol;

                    if (issue.severity === 'Sev-1') {
                        borderCol = 'border-rose-500/50'; bgCol = 'bg-rose-500/5'; textCol = 'text-rose-400'; badgeCol = 'bg-rose-500 text-white'; shadowCol = '';
                    } else if (issue.severity === 'Sev-2') {
                        borderCol = 'border-amber-500/50'; bgCol = 'bg-amber-500/5'; textCol = 'text-amber-400'; badgeCol = 'bg-amber-500 text-black'; shadowCol = '';
                    } else {
                        borderCol = 'border-indigo-500/50'; bgCol = 'bg-indigo-500/5'; textCol = 'text-indigo-400'; badgeCol = 'bg-indigo-500 text-white'; shadowCol = '';
                    }

                    return `
                    <div class="ui-row p-6 border-l-[4px] ${borderCol} relative overflow-hidden group hover:bg-slate-900/40 transition-all mb-4">
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
                            <div class="flex items-center gap-3">
                                <span class="${badgeCol} px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest">${issue.severity}</span>
                                <span class="text-[11px] font-bold text-slate-500">#${issue.number}</span>
                                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest border border-white/5 px-2 py-0.5 rounded bg-white/5">Score: ${issue.score}</span>
                            </div>
                            <span class="text-[10px] text-slate-500 font-bold uppercase tracking-widest">${timeAgo(issue.createdAt)}</span>
                        </div>
                        
                        <h4 class="text-base font-bold text-white mb-2 truncate group-hover:text-indigo-400 transition-colors">${issue.title}</h4>
                        <p class="text-sm text-slate-400 mb-6 leading-relaxed line-clamp-2">${issue.body || 'No description provided.'}</p>
                        
                        <div class="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-white/5">
                            <div class="flex gap-3">
                                <div class="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                    <span class="material-symbols-outlined text-[14px]">${issue.sentimentTag.toLowerCase().includes('anger') ? 'sentiment_very_dissatisfied' : 'psychology'}</span>
                                    <span>${issue.sentimentTag}</span>
                                </div>
                                <div class="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                    <span class="material-symbols-outlined text-[14px]">${issue.trend === 'Escalating' ? 'trending_up' : 'trending_flat'}</span>
                                    <span>${issue.trend}</span>
                                </div>
                            </div>
                            <button onclick="alert('Analysis sub-routine active...')" class="bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all">
                                View Details
                            </button>
                        </div>
                    </div>`;
                }).join('');
            }
        } catch(e) {
            console.error(e);
        }
    };

    scanBtn.addEventListener('click', async () => {
        const repoStr = repoInput.value.trim();
        if (!repoStr.includes('/')) { alert("Use format owner/repo"); return; }
        
        const [owner, repo] = repoStr.split('/');
        
        scanBtn.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">refresh</span> Processing...`;
        scanBtn.disabled = true;
        scanStatus.innerText = "Querying live github issues & applying heuristic AI scaling...";

        try {
            const res = await fetch(`http://localhost:5000/api/priority/scan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ owner, repo })
            });
            const data = await res.json();
            
            if (res.ok) {
                scanStatus.innerText = `Scan processed ${data.processedCount} new issues immediately. UI rendering...`;
                updateDisplay();
            } else {
                throw new Error(data.error);
            }
        } catch(e) {
            scanStatus.innerText = `Error: ${e.message}`;
        } finally {
            scanBtn.innerHTML = `<span class="material-symbols-outlined text-sm">priority_high</span> Analyze Priority`;
            scanBtn.disabled = false;
        }
    });

    socket.on('priority_update', (data) => {
        if(repoInput.value.trim() === data.repo) {
            updateDisplay();
        }
    });

    // Initial silent load if any data exists
    updateDisplay();
});
