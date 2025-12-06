import axios from 'axios';

const API_URL = process.env.API_URL || 'http://localhost:8000';

async function search({ term, num = 10 }) {
    try {
        console.log(`[APKPure Search] Searching via API: ${term}`);
        
        const response = await axios.get(`${API_URL}/search`, {
            params: { q: term, limit: num },
            timeout: 30000
        });
        
        if (response.data && response.data.results) {
            console.log(`[APKPure Search] Found ${response.data.results.length} results for "${term}"`);
            return response.data.results;
        }
        
        return [];
        
    } catch (error) {
        console.error(`[APKPure Search] Error searching for "${term}":`, error.message);
        throw error;
    }
}

async function app({ appId }) {
    try {
        console.log(`[APKPure App] Getting details for: ${appId}`);
        
        const response = await axios.get(`${API_URL}/app/${encodeURIComponent(appId)}`, {
            timeout: 30000
        });
        
        if (response.data) {
            console.log(`[APKPure App] Found: ${response.data.title} (${appId})`);
            return {
                title: response.data.title || appId,
                appId: response.data.appId || appId,
                developer: response.data.developer || 'Unknown',
                icon: response.data.icon || null,
                installs: 'N/A',
                score: response.data.score || 0
            };
        }
        
        return {
            title: appId,
            appId,
            developer: 'Unknown',
            icon: null,
            installs: 'N/A',
            score: 0
        };
        
    } catch (error) {
        console.error(`[APKPure App] Error getting details for "${appId}":`, error.message);
        return {
            title: appId,
            appId,
            developer: 'Unknown',
            icon: null,
            installs: 'N/A',
            score: 0
        };
    }
}

export default {
    search,
    app
};
