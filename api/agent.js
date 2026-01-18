const Anthropic = require('@anthropic-ai/sdk');

// Initialize Anthropic client with explicit API key
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// Agent system prompts
const agentPrompts = {
    researcher: `You are a Research Agent. Your job is to search for and gather information about topics.
When given a topic, provide 3-4 key findings with specific details based on your knowledge.
Focus on recent developments and important facts.`,

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

    if (previousContext) {
        messages.push({ role: 'user', content: previousContext });
        messages.push({ role: 'assistant', content: 'I understand the context. Please provide your request.' });
    }

    messages.push({ role: 'user', content: userMessage });

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
