import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function Dashboard() {
    const [leads, setLeads] = useState([]);
    const [filter, setFilter] = useState('ALL');

    const fetchLeads = async () => {
        try {
            const res = await axios.get('http://localhost:5000/api/leads');
            setLeads(res.data);
        } catch (err) { console.error('Failed to fetch leads:', err); }
    };

    useEffect(() => {
        fetchLeads();
        const interval = setInterval(fetchLeads, 5000); 
        return () => clearInterval(interval);
    }, []);

    const deleteLead = async (id) => {
        try {
            await axios.delete(`http://localhost:5000/api/leads/${id}`);
            setLeads(leads.filter(lead => lead._id !== id));
        } catch (err) {}
    };

    const clearAll = async () => {
        if(window.confirm("Are you sure you want to wipe all jobs?")) {
            await axios.delete('http://localhost:5000/api/leads/clear/all');
            fetchLeads();
        }
    };

    const displayedLeads = filter === 'ALL' ? leads : leads.filter(l => l.status === filter);

    const getStatusStyle = (status) => {
        switch(status) {
            case 'APPLIED': return 'bg-green-900/50 text-green-400 border border-green-800';
            case 'MANUAL_REVIEW_NEEDED': return 'bg-yellow-900/50 text-yellow-400 border border-yellow-800 font-bold';
            case 'FAILED_NEEDS_HEALING': return 'bg-red-900/50 text-red-400 border border-red-800';
            case 'DISCOVERED': return 'bg-gray-800 text-gray-300 border border-gray-700';
            default: return 'bg-blue-900/50 text-blue-400 border border-blue-800';
        }
    };

    return (
        <div className="w-full">
            <div className="flex justify-between items-center mb-6 border-t border-gray-800 pt-10">
                <h2 className="text-2xl font-bold">Agent Command Center</h2>
                <div className="space-x-4">
                    <button onClick={fetchLeads} className="px-4 py-2 bg-gray-800 border border-gray-700 text-white rounded hover:bg-gray-700">🔄 Refresh Data</button>
                    <button onClick={clearAll} className="px-4 py-2 bg-red-900/80 border border-red-800 text-red-200 rounded hover:bg-red-700">⚠️ Nuke Memory</button>
                </div>
            </div>

            <div className="mb-6 space-x-2">
                {['ALL', 'DISCOVERED', 'APPLIED', 'MANUAL_REVIEW_NEEDED'].map(f => (
                    <button key={f} onClick={() => setFilter(f)} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${filter === f ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)]' : 'bg-gray-900 text-gray-400 border border-gray-800 hover:bg-gray-800'}`}>
                        {f.replace(/_/g, ' ')}
                    </button>
                ))}
            </div>

            <div className="bg-gray-900 rounded-2xl shadow-xl overflow-hidden border border-gray-800">
                <table className="min-w-full divide-y divide-gray-800">
                    <thead className="bg-gray-950">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Company & Role</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Direct Link</th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Manage</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {displayedLeads.map((lead) => (
                            <tr key={lead._id} className="hover:bg-gray-800/50 transition-colors">
                                <td className="px-6 py-4">
                                    <div className="font-bold text-white text-lg">{lead.company}</div>
                                    <div className="text-sm text-gray-400 mt-1">{lead.jobTitle}</div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusStyle(lead.status)}`}>{lead.status.replace(/_/g, ' ')}</span>
                                </td>
                                <td className="px-6 py-4 text-sm">
                                    <a href={lead.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-400 hover:underline font-medium">Open Portal ↗</a>
                                </td>
                                <td className="px-6 py-4 text-right text-sm font-medium">
                                    <button onClick={() => deleteLead(lead._id)} className="text-red-500 hover:text-red-400 bg-red-950/30 px-3 py-1 rounded border border-red-900/50">Delete</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}