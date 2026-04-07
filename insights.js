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
        return seconds < 10 ? "just now" : Math.floor(seconds) + "s ago";
    };

    const totalIssuesEl = document.getElementById('total-issues-count');
    const highPrioEl = document.getElementById('high-priority-count');
    const mediumPrioEl = document.getElementById('medium-priority-count');
    const lowPrioEl = document.getElementById('low-priority-count');
    const duplicateCountEl = document.getElementById('duplicate-count');
    const commonTypeEl = document.getElementById('most-common-type');
    const recentIssuesList = document.getElementById('recent-issues-list');
    const emptyState = document.getElementById('empty-state');
    const contentSections = document.querySelectorAll('.max-w-7xl > section');
    const generateBtn = document.getElementById('generate-insights-btn');

    let isInitialLoad = true;

    const updateUI = (data) => {
        if (!data.totalIssues || data.totalIssues === 0) {
            emptyState.classList.remove('hidden');
            contentSections.forEach(s => s.classList.add('hidden'));
            return;
        }

        emptyState.classList.add('hidden');
        contentSections.forEach(s => s.classList.remove('hidden'));

        // Update Counts with animation or direct
        totalIssuesEl.innerText = data.totalIssues;
        highPrioEl.innerText = data.highPriorityCount;
        mediumPrioEl.innerText = data.mediumPriorityCount;
        lowPrioEl.innerText = data.lowPriorityCount;
        duplicateCountEl.innerText = data.duplicateCount;
        commonTypeEl.innerText = data.mostCommonIssueType;

        // Render Recent Issues
        if (data.recentIssues && data.recentIssues.length > 0) {
            recentIssuesList.innerHTML = data.recentIssues.map(issue => `
                <tr class="group hover:bg-slate-900/40 transition-all border-b border-white/5 last:border-0">
                    <td class="py-5 pl-4">
                        <div class="flex flex-col gap-1">
                            <span class="text-white font-bold text-sm">#${issue.number} ${issue.githubData.title}</span>
                            <span class="text-[10px] text-slate-500 font-bold uppercase tracking-widest">${issue.repo}</span>
                        </div>
                    </td>
                    <td class="py-5 text-center">
                        <div class="flex flex-wrap justify-center gap-2">
                            ${issue.githubData.labels.slice(0, 3).map(l => `<span class="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 text-[10px] font-bold border border-indigo-500/20">${l}</span>`).join('')}
                        </div>
                    </td>
                    <td class="py-5 text-right pr-4">
                        <span class="text-[10px] text-slate-400 font-bold uppercase tracking-widest">${timeAgo(issue.githubData.createdAt)}</span>
                    </td>
                </tr>
            `).join('');
        }
    };

    const fetchGlobalInsights = async () => {
        if (isInitialLoad) {
            totalIssuesEl.innerHTML = `<span class="animate-pulse opacity-50">...</span>`;
        }

        try {
            const res = await fetch('http://localhost:5000/api/issues/insights');
            const data = await res.json();
            
            if (data.success) {
                updateUI(data);
                isInitialLoad = false;
            }
        } catch (e) {
            console.error('Insights pulse failed:', e);
        }
    };

    // --- REAL-TIME POLLING ---
    // Fetch every 10 seconds
    const pollInterval = setInterval(fetchGlobalInsights, 10000);

    // Initial Load
    fetchGlobalInsights();

    // Manual Refresh Handler
    generateBtn.addEventListener('click', () => {
        generateBtn.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">refresh</span> Syncing...`;
        fetchGlobalInsights().finally(() => {
            setTimeout(() => {
                generateBtn.innerHTML = `<span class="material-symbols-outlined text-sm">refresh</span> Refresh Analytics`;
            }, 1000);
        });
    });

    // Cleanup on window unload (good practice)
    window.addEventListener('beforeunload', () => {
        clearInterval(pollInterval);
    });
});
