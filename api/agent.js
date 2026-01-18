const Anthropic = require('@anthropic-ai/sdk');

// Initialize Anthropic client with explicit API key
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// Brave Search function
async function braveSearch(query) {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
        return null;
    }

    try {
        const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
            headers: {
                'Accept': 'application/json',
                'X-Subscription-Token': apiKey
            }
        });

        if (!response.ok) {
            console.error('Brave Search error:', response.status);
            return null;
        }

        const data = await response.json();

        // Format search results
        if (data.web && data.web.results) {
            return data.web.results.map(r => ({
                title: r.title,
                description: r.description,
                url: r.url
            }));
        }
        return null;
    } catch (error) {
        console.error('Brave Search error:', error);
        return null;
    }
}

// Agent system prompts
const agentPrompts = {
    researcher: `You are a Research Agent with access to real-time web search results. Your job is to analyze the search results provided and gather key information about topics.
When given search results, synthesize them into 3-4 key findings with specific details.
Always cite your sources by mentioning where the information came from.
Focus on the most recent and relevant information from the search results.`,

    analyzer: `You are an Analysis Agent. Your job is to analyze research findings and extract key insights.
When given research findings, identify the 3 most important insights.
For each insight, explain why it matters and what implications it has.
Format your response with bold insight headers and clear explanations.`,

    writer: `You are a Writer Agent. Your job is to synthesize analysis into professional reports.
When given an analysis, write a concise 3-4 paragraph report that:
- Opens with a strong summary statement
- Presents the key findings in a logical flow
- Discusses implications and challenges
- Concludes with forward-looking perspective
Write in a professional, clear style suitable for business readers.`
};

async function callClaudeAgent(agentType, userMessage, previousContext = null) {
    const systemPrompt = agentPrompts[agentType];
    const messages = [];

    // For researcher agent, do a web search first
    let enrichedMessage = userMessage;
    if (agentType === 'researcher') {
        const searchResults = await braveSearch(userMessage);
        if (searchResults && searchResults.length > 0) {
            const searchContext = searchResults.map((r, i) =>
                `[${i + 1}] ${r.title}\n${r.description}\nSource: ${r.url}`
            ).join('\n\n');

            enrichedMessage = `Search query: "${userMessage}"\n\nWeb search results:\n${searchContext}\n\nPlease analyze these search results and provide key findings about: ${userMessage}`;
        }
    }

    if (previousContext) {
        messages.push({ role: 'user', content: previousContext });
        messages.push({ role: 'assistant', content: 'I understand the context. Please provide your request.' });
    }

    messages.push({ role: 'user', content: enrichedMessage });

    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages
    });

    return response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
}

module.exports = async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { agent, message, context } = req.body;

        if (!agent || !message) {
            return res.status(400).json({ error: 'Missing agent or message' });
        }

        if (!agentPrompts[agent]) {
            return res.status(400).json({ error: 'Invalid agent type' });
        }

        const result = await callClaudeAgent(agent, message, context);
        return res.status(200).json({ result });

    } catch (error) {
        console.error('Error calling Claude:', error);
        return res.status(500).json({ error: error.message });
    }
};
