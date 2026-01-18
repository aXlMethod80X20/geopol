# Multi-Agent Research System

A working multi-agent system that uses Claude AI to research topics through three specialized agents:

1. **Researcher Agent** - Gathers information about the topic
2. **Analyzer Agent** - Extracts key insights from the research
3. **Writer Agent** - Produces a professional report

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set your Anthropic API key

**Windows (Command Prompt):**
```cmd
set ANTHROPIC_API_KEY=your-api-key-here
```

**Windows (PowerShell):**
```powershell
$env:ANTHROPIC_API_KEY="your-api-key-here"
```

**Mac/Linux:**
```bash
export ANTHROPIC_API_KEY=your-api-key-here
```

### 3. Start the server

```bash
npm start
```

### 4. Open in browser

Navigate to: http://localhost:3000

## How It Works

```
User enters topic
       │
       ▼
┌──────────────────┐
│ Researcher Agent │  ──► Gathers information
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Analyzer Agent  │  ──► Extracts key insights
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   Writer Agent   │  ──► Produces final report
└────────┬─────────┘
         │
         ▼
   Final Report
```

Each agent is a separate Claude API call with a specialized system prompt. The output from each agent feeds into the next one in sequence.

## Project Structure

```
Orchestration/
├── server.js      # Node.js backend with Claude API integration
├── index.html     # Frontend UI
├── package.json   # Dependencies
└── README.md      # This file
```
