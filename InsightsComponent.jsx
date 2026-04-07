import React, { useState, useEffect } from 'react';

/**
 * OpenIssue Insights Component
 * A real-time dashboard for issue analytics.
 */
const InsightsDashboard = () => {
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Helper for relative time (simplified)
  const timeAgo = (dateStr) => {
    const seconds = Math.floor((new Date() - new Date(dateStr)) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const fetchInsights = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/issues/insights');
      const data = await response.json();
      if (data.success) {
        setInsights(data);
        setError(null);
      } else {
        setError('Failed to fetch metrics');
      }
    } catch (err) {
      setError('Connection to intelligence engine lost');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchInsights();

    // Set up polling interval (10 seconds)
    const interval = setInterval(fetchInsights, 10000);

    // Cleanup on unmount
    return () => clearInterval(interval);
  }, []);

  if (loading && !insights) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (error && !insights) {
    return (
      <div className="p-8 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400 text-center">
        <span className="material-symbols-outlined text-4xl mb-2">error</span>
        <p className="font-bold">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-12 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <p className="text-indigo-400 text-xs font-bold tracking-widest uppercase mb-1">Intelligence Hub</p>
          <h1 className="text-4xl font-black text-white tracking-tight">System Insights</h1>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 rounded-full border border-emerald-500/20">
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Real-time</span>
        </div>
      </div>

      {/* Metrics Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Main Card */}
        <div className="md:col-span-8 bg-[#131725] border border-white/5 rounded-[2rem] p-10 flex flex-col justify-between hover:border-indigo-500/30 transition-all">
          <div>
            <h3 className="text-lg font-bold text-slate-400 mb-8">Total Issues Analyzed</h3>
            <div className="text-9xl font-black text-white tracking-tighter">
              {insights.totalIssues}
            </div>
          </div>
          <p className="text-slate-500 text-lg mt-8">Unique data points indexed by the engine.</p>
        </div>

        {/* Small Cards */}
        <div className="md:col-span-4 flex flex-col gap-6">
          <div className="bg-[#131725] border-l-4 border-indigo-500 rounded-2xl p-8 flex flex-col justify-between h-full">
            <span className="text-xs font-bold text-indigo-400 uppercase">Redundancy</span>
            <div className="text-5xl font-black text-white">{insights.duplicateCount}</div>
            <p className="text-slate-500 text-xs font-bold uppercase">Clusters Detected</p>
          </div>
          <div className="bg-[#131725] border-l-4 border-emerald-500 rounded-2xl p-8 flex flex-col justify-between h-full">
            <span className="text-xs font-bold text-emerald-400 uppercase">Pattern</span>
            <div className="text-3xl font-black text-white truncate">{insights.mostCommonIssueType}</div>
            <p className="text-slate-500 text-xs font-bold uppercase">Most Common Type</p>
          </div>
        </div>
      </div>

      {/* Priority Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#131725] border-b-4 border-rose-500/50 rounded-2xl p-8">
          <p className="text-rose-400 text-[10px] font-bold uppercase tracking-widest mb-4">Urgent (Sev-1)</p>
          <div className="text-5xl font-black text-white">{insights.highPriorityCount}</div>
        </div>
        <div className="bg-[#131725] border-b-4 border-amber-500/50 rounded-2xl p-8">
          <p className="text-amber-400 text-[10px] font-bold uppercase tracking-widest mb-4">Moderate (Sev-2)</p>
          <div className="text-5xl font-black text-white">{insights.mediumPriorityCount}</div>
        </div>
        <div className="bg-[#131725] border-b-4 border-indigo-500/50 rounded-2xl p-8">
          <p className="text-indigo-400 text-[10px] font-bold uppercase tracking-widest mb-4">Standard (Sev-3)</p>
          <div className="text-5xl font-black text-white">{insights.lowPriorityCount}</div>
        </div>
      </div>

      {/* Recent Issues Table */}
      <div className="bg-[#131725] border border-white/5 rounded-[2rem] p-8">
        <h3 className="text-xl font-bold text-white mb-8">Recent Synchronizations</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-slate-500 text-[10px] font-bold uppercase tracking-widest border-b border-white/5">
                <th className="pb-4 pl-4">Issue Node</th>
                <th className="pb-4 text-center">Labels</th>
                <th className="pb-4 text-right pr-4">Updated</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {insights.recentIssues.map((issue) => (
                <tr key={issue._id} className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-all">
                  <td className="py-5 pl-4 font-bold text-white">
                    #{issue.number} {issue.githubData.title}
                  </td>
                  <td className="py-5 text-center">
                    <div className="flex justify-center gap-2">
                      {issue.githubData.labels.slice(0, 2).map((label, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded text-[10px] font-bold border border-indigo-500/20">
                          {label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-5 text-right pr-4 text-slate-500 font-bold uppercase text-[10px]">
                    {timeAgo(issue.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default InsightsDashboard;
