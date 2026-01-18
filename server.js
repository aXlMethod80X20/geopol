require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const PORT = 3000;

// Initialize Anthropic client
const anthropic = new Anthropic();

// MCP client storage
let mcpClients = {};
let mcpTools = [];

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

// Agent system prompts
const agentPrompts = {
    researcher: `You are a Research Agent with access to tools. Your job is to search for and gather information about topics.
When given a topic, USE YOUR TOOLS to search for current information.
After gathering information, provide 3-4 key findings with specific details.
Always use the available search tools - do not make up information.`,

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

// Load MCP configuration
function loadMCPConfig() {
    const configPath = path.join(__dirname, 'mcp-config.json');
    if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    return { mcpServers: {} };
}

// Initialize MCP clients
async function initializeMCP() {
    const config = loadMCPConfig();

    for (const [serverName, serverConfig] of Object.entries(config.mcpServers || {})) {
        try {
            console.log(`Connecting to MCP server: ${serverName}...`);

            const client = new Client({
                name: 'multi-agent-research',
                version: '1.0.0'
            });

            // Handle environment variables in args
            const args = (serverConfig.args || []).map(arg => {
                if (typeof arg === 'string' && arg.startsWith('$')) {
                    const envVar = arg.slice(1);
                    return process.env[envVar] || arg;
                }
                return arg;
            });

            // Merge environment variables
            const env = { ...process.env, ...(serverConfig.env || {}) };

            // Replace env var references in the env object
            for (const [key, value] of Object.entries(env)) {
                if (typeof value === 'string' && value.startsWith('$')) {
                    const envVar = value.slice(1);
                    env[key] = process.env[envVar] || value;
                }
            }

            const transport = new StdioClientTransport({
                command: serverConfig.command,
                args: args,
                env: env
            });

            await client.connect(transport);
            mcpClients[serverName] = client;

            // Get tools from this server
            const toolsResult = await client.listTools();
            for (const tool of toolsResult.tools) {
                mcpTools.push({
                    name: `${serverName}__${tool.name}`,
                    description: tool.description,
                    input_schema: tool.inputSchema,
                    _serverName: serverName,
                    _originalName: tool.name
                });
            }

            console.log(`Connected to ${serverName}, loaded ${toolsResult.tools.length} tools`);
        } catch (error) {
            console.error(`Failed to connect to MCP server ${serverName}:`, error.message);
        }
    }

    console.log(`Total MCP tools available: ${mcpTools.length}`);
}

// Call an MCP tool
async function callMCPTool(toolName, args) {
    const tool = mcpTools.find(t => t.name === toolName);
    if (!tool) {
        throw new Error(`Tool not found: ${toolName}`);
    }

    const client = mcpClients[tool._serverName];
    if (!client) {
        throw new Error(`MCP client not found: ${tool._serverName}`);
    }

    const result = await client.callTool({
        name: tool._originalName,
        arguments: args
    });

    return result;
}

// Convert MCP tools to Anthropic tool format
function getAnthropicTools() {
    return mcpTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema
    }));
}

async function callClaudeAgent(agentType, userMessage, previousContext = null) {
    const systemPrompt = agentPrompts[agentType];
    const messages = [];

    if (previousContext) {
        messages.push({ role: 'user', content: previousContext });
        messages.push({ role: 'assistant', content: 'I understand the context. Please provide your request.' });
    }

    messages.push({ role: 'user', content: userMessage });

    // Only give tools to the researcher agent
    const tools = agentType === 'researcher' ? getAnthropicTools() : [];

    let response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages,
        tools: tools.length > 0 ? tools : undefined
    });

    // Handle tool use loop
    while (response.stop_reason === 'tool_use') {
        const assistantMessage = { role: 'assistant', content: response.content };
        messages.push(assistantMessage);

        const toolResults = [];
        for (const block of response.content) {
            if (block.type === 'tool_use') {
                console.log(`Calling tool: ${block.name}`);
                try {
                    const result = await callMCPTool(block.name, block.input);

                    // Extract text content from MCP result
                    let textContent = '';
                    if (result.content) {
                        for (const item of result.content) {
                            if (item.type === 'text') {
                                textContent += item.text;
                            }
                        }
                    }

                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: textContent || JSON.stringify(result)
                    });
                } catch (error) {
                    console.error(`Tool error: ${error.message}`);
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: `Error: ${error.message}`,
                        is_error: true
                    });
                }
            }
        }

        messages.push({ role: 'user', content: toolResults });

        response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            system: systemPrompt,
            messages: messages,
            tools: tools.length > 0 ? tools : undefined
        });
    }

    return response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
}

async function handleAgentRequest(req, res) {
    let body = '';

    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', async () => {
        try {
            const { agent, message, context } = JSON.parse(body);

            if (!agent || !message) {
                res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing agent or message' }));
                return;
            }

            if (!agentPrompts[agent]) {
                res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid agent type' }));
                return;
            }

            const result = await callClaudeAgent(agent, message, context);

            res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ result }));

        } catch (error) {
            console.error('Error calling Claude:', error);
            res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    });
}

// Get available tools endpoint
async function handleToolsRequest(req, res) {
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tools: mcpTools.map(t => ({ name: t.name, description: t.description })) }));
}

function serveStaticFile(filePath, res) {
    const extname = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp'
    };

    const contentType = contentTypes[extname] || 'text/plain';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('File not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
}

const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/api/agent') {
        handleAgentRequest(req, res);
        return;
    }

    if (req.method === 'GET' && req.url === '/api/tools') {
        handleToolsRequest(req, res);
        return;
    }

    if (req.method === 'GET') {
        let filePath = req.url === '/' ? '/index.html' : req.url;
        filePath = path.join(__dirname, filePath);
        serveStaticFile(filePath, res);
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

// Start server after MCP initialization
async function start() {
    await initializeMCP();

    server.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════════════╗
║       Multi-Agent Research System Server Running           ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║   Open in browser: http://localhost:${PORT}                   ║
║                                                            ║
║   MCP Tools loaded: ${String(mcpTools.length).padEnd(36)}║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);
    });
}

start().catch(console.error);
