import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import Dashboard from './components/Dashboard';

const socket = io('http://localhost:5000');

function App() {
    const [logs, setLogs] = useState([]);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    
    // --- APEX DETAILS ---
    const [userDetails, setUserDetails] = useState({
        email: '', phone: '', location: '', minSalary: '', maxSalary: '',
        linkedin: '', github: '', portfolio: '',
        workAuth: 'Yes', requiresVisa: 'No',
        gender: 'Male', race: 'Asian', veteran: 'No', disability: 'No'
    });

    const [showAdvanced, setShowAdvanced] = useState(false);

    useEffect(() => {
        socket.on('log', (data) => setLogs(prev => [...prev, data.message].slice(-15)));
        
        const saved = localStorage.getItem('apex_details');
        if (saved) setUserDetails(JSON.parse(saved));
        
        return () => socket.off('log');
    }, []);

    const handleUpload = async (e) => {
        setLoading(true);
        try {
            const formData = new FormData();
            formData.append('resume', e.target.files[0]);
            
            const res = await fetch('http://localhost:5000/api/upload-resume', { method: 'POST', body: formData });
            const data = await res.json();
            
            if (!data || !data.profile) {
                alert("API High Demand: The parser failed to extract data. Please wait 30 seconds and upload again.");
                setLoading(false);
                return;
            }

            setProfile(data.profile);
            setUserDetails(prev => ({
                ...prev,
                email: prev.email || data.profile.email || '',
                phone: prev.phone || data.profile.phone || '',
                location: prev.location || data.profile.location || ''
            }));
        } catch (err) {
            alert("Network Error during upload.");
        }
        setLoading(false);
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        const updated = { ...userDetails, [name]: value };
        setUserDetails(updated);
        localStorage.setItem('apex_details', JSON.stringify(updated));
    };

    const startSpecificAgent = async (platform) => {
        if (!userDetails.email || !userDetails.phone) return alert("Email and Phone are strictly required.");

        const payloadProfile = { ...profile, ...userDetails };

        await fetch('http://localhost:5000/api/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ explicitEmail: userDetails.email, profile: payloadProfile, platform })
        });
        setIsRunning(true);
    };

    const stopAgent = async () => {
        await fetch('http://localhost:5000/api/stop', { method: 'POST' });
        setIsRunning(false);
    };

    return (
        <div className="p-6 font-sans min-h-screen bg-black text-white relative">
            {showAdvanced && (
                <div className="fixed inset-0 bg-black/90 z-50 flex justify-center items-center p-6">
                    <div className="bg-gray-900 border border-gray-800 p-8 rounded-2xl max-w-2xl w-full shadow-2xl">
                        <div className="flex justify-between items-center border-b border-gray-800 pb-4 mb-6">
                            <h2 className="text-xl font-bold text-blue-500">APEX Details Configuration</h2>
                            <button onClick={() => setShowAdvanced(false)} className="text-gray-500 hover:text-white font-bold">X</button>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-6 mb-6">
                            <div>
                                <label className="block text-gray-400 text-xs font-bold mb-1">GITHUB URL</label>
                                <input type="text" name="github" value={userDetails.github} onChange={handleInputChange} className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs font-bold mb-1">PORTFOLIO URL</label>
                                <input type="text" name="portfolio" value={userDetails.portfolio} onChange={handleInputChange} className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs font-bold mb-1">AUTHORIZED TO WORK?</label>
                                <select name="workAuth" value={userDetails.workAuth} onChange={handleInputChange} className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                                    <option>Yes</option><option>No</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs font-bold mb-1">REQUIRES VISA SPONSORSHIP?</label>
                                <select name="requiresVisa" value={userDetails.requiresVisa} onChange={handleInputChange} className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                                    <option>No</option><option>Yes</option>
                                </select>
                            </div>
                        </div>

                        <h3 className="text-sm font-bold text-gray-500 mb-4 border-b border-gray-800 pb-2">Equal Employment Opportunity (EEO)</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-gray-400 text-xs font-bold mb-1 uppercase">Gender</label>
                                <select name="gender" value={userDetails.gender} onChange={handleInputChange} className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                                    <option value="Male">Male</option>
                                    <option value="Female">Female</option>
                                    <option value="Decline to Self-Identify">Decline to Self-Identify</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs font-bold mb-1 uppercase">Race / Ethnicity</label>
                                <select name="race" value={userDetails.race} onChange={handleInputChange} className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                                    <option value="Asian">Asian (Indian Subcontinent)</option>
                                    <option value="White">White</option>
                                    <option value="Black or African American">Black or African American</option>
                                    <option value="Decline to Self-Identify">Decline to Self-Identify</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs font-bold mb-1 uppercase">Veteran Status</label>
                                <select name="veteran" value={userDetails.veteran} onChange={handleInputChange} className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                                    <option value="No">No</option>
                                    <option value="Yes">Yes</option>
                                    <option value="Decline to Self-Identify">Decline to Self-Identify</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs font-bold mb-1 uppercase">Disability Status</label>
                                <select name="disability" value={userDetails.disability} onChange={handleInputChange} className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                                    <option value="No">No</option>
                                    <option value="Yes">Yes</option>
                                    <option value="Decline to Self-Identify">Decline to Self-Identify</option>
                                </select>
                            </div>
                        </div>
                        
                        <button onClick={() => setShowAdvanced(false)} className="w-full mt-8 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg transition-all">Save & Close</button>
                    </div>
                </div>
            )}

            <h1 className="text-3xl font-black mb-8 flex justify-between items-center border-b border-gray-800 pb-4">
                <span className="tracking-widest">APEX APPLY <span className="text-blue-600">//</span> ATS BYPASS</span>
                {profile && isRunning && (
                    <button onClick={stopAgent} className="px-8 py-3 rounded-xl font-black text-lg transition-all bg-red-600 hover:bg-red-500 shadow-[0_0_20px_rgba(220,38,38,0.6)]">
                        🛑 STOP AGENT
                    </button>
                )}
            </h1>
            
            <div className="flex flex-col lg:flex-row gap-8">
                <div className="w-full lg:w-1/3 flex flex-col gap-6">
                    <div className="p-6 border border-gray-800 rounded-2xl flex flex-col items-center bg-gray-900/40 shadow-xl relative">
                        <button onClick={() => setShowAdvanced(true)} className="absolute top-4 right-4 text-gray-500 hover:text-blue-400 transition-colors" title="Apex Details Configuration">
                            ⚙️
                        </button>

                        <input type="file" id="pdf" className="hidden" onChange={handleUpload} />
                        <label htmlFor="pdf" className="cursor-pointer w-full text-center bg-white text-black px-6 py-4 rounded-xl font-bold hover:bg-blue-600 hover:text-white transition-all mb-6">
                            {loading ? "AI PARSING RESUME..." : (profile ? "RESUME LOADED ✅" : "UPLOAD RESUME (PDF)")}
                        </label>

                        {profile && (
                            <div className="w-full space-y-4">
                                <div>
                                    <label className="block text-gray-400 text-xs font-bold mb-1 uppercase">Email *</label>
                                    <input type="email" name="email" value={userDetails.email} onChange={handleInputChange} className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-gray-400 text-xs font-bold mb-1 uppercase">Phone *</label>
                                        <input type="text" name="phone" value={userDetails.phone} onChange={handleInputChange} className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                                    </div>
                                    <div>
                                        <label className="block text-gray-400 text-xs font-bold mb-1 uppercase">Location</label>
                                        <input type="text" name="location" placeholder="e.g. Indore, India" value={userDetails.location} onChange={handleInputChange} className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-gray-400 text-xs font-bold mb-1 uppercase">Min Salary</label>
                                        <input type="text" name="minSalary" placeholder="$80,000" value={userDetails.minSalary} onChange={handleInputChange} className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                                    </div>
                                    <div>
                                        <label className="block text-gray-400 text-xs font-bold mb-1 uppercase">Max Salary</label>
                                        <input type="text" name="maxSalary" placeholder="$120,000" value={userDetails.maxSalary} onChange={handleInputChange} className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {profile && profile.titles && (
                        <div className="bg-gray-900/40 p-6 rounded-2xl border border-gray-800 shadow-xl">
                            <label className="block text-gray-400 text-xs font-bold mb-3 uppercase tracking-widest text-center">AI Identified Target Roles</label>
                            <p className="mt-2 text-blue-400 text-sm font-mono text-center leading-relaxed">
                                &gt; {profile.titles.join(' • ')} &lt;
                            </p>
                        </div>
                    )}

                    {profile && !isRunning && (
                        <div className="grid grid-cols-1 gap-4 mt-2">
                            {['LinkedIn', 'Naukri', 'Google'].map(p => (
                                <button key={p} onClick={() => startSpecificAgent(p)} className="bg-black border border-gray-800 p-4 rounded-xl hover:border-blue-500 transition-all text-left group flex justify-between items-center">
                                    <div>
                                        <h3 className="font-bold text-md group-hover:text-blue-500">Deploy {p}</h3>
                                        <p className="text-gray-600 text-xs">Execute search protocol</p>
                                    </div>
                                    <span className="text-gray-700 group-hover:text-blue-500">→</span>
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="bg-black rounded-xl border border-gray-800 p-4 font-mono text-xs h-48 overflow-y-auto space-y-1">
                        {logs.map((log, i) => <div key={i} className="text-gray-400"><span className="text-blue-500">&gt;</span> {log}</div>)}
                    </div>
                </div>

                <div className="w-full lg:w-2/3"><Dashboard /></div>
            </div>
        </div>
    );
}
export default App;