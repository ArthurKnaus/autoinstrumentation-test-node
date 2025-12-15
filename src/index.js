const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const anthropic = new Anthropic();
const PORT = process.env.PORT || 3000;

// In-memory message history store (keyed by session_id)
const messageHistory = new Map();

// Tool definitions
const tools = [
  {
    name: 'get_current_time',
    description: 'Get the current date and time. Returns the current timestamp in ISO format along with a human-readable format.',
    input_schema: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'Optional timezone (e.g., "America/New_York", "Europe/London"). Defaults to UTC if not specified.'
        }
      },
      required: []
    }
  }
];

// Tool execution function
function executeTool(toolName, toolInput) {
  switch (toolName) {
    case 'get_current_time': {
      const now = new Date();
      const timezone = toolInput.timezone || 'UTC';
      try {
        const formatted = now.toLocaleString('en-US', { timeZone: timezone });
        return {
          iso: now.toISOString(),
          formatted: formatted,
          timezone: timezone,
          unix_timestamp: Math.floor(now.getTime() / 1000)
        };
      } catch (e) {
        return {
          iso: now.toISOString(),
          formatted: now.toUTCString(),
          timezone: 'UTC',
          unix_timestamp: Math.floor(now.getTime() / 1000),
          note: `Invalid timezone "${timezone}", defaulted to UTC`
        };
      }
    }
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the Express API' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// AI Agent endpoint with tool use and message history
app.post('/chat', async (req, res) => {
  try {
    const { message, session_id = 'default' } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get or initialize message history for this session
    if (!messageHistory.has(session_id)) {
      messageHistory.set(session_id, []);
    }
    const messages = messageHistory.get(session_id);

    // Add user message to history
    messages.push({ role: 'user', content: message });

    // Agent loop - continue until we get a final response (no tool use)
    let totalUsage = { input_tokens: 0, output_tokens: 0 };
    let iterations = 0;
    const maxIterations = 10; // Safety limit

    while (iterations < maxIterations) {
      iterations++;

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: 'You are a helpful assistant. You have access to tools that you can use to help answer questions. Use tools when appropriate to provide accurate information.',
        tools: tools,
        messages: messages
      });

      // Track token usage
      totalUsage.input_tokens += response.usage.input_tokens;
      totalUsage.output_tokens += response.usage.output_tokens;

      // Check if we need to process tool calls
      const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');

      if (response.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
        // Add assistant's response (with tool calls) to history
        messages.push({ role: 'assistant', content: response.content });

        // Process each tool call and collect results
        const toolResults = toolUseBlocks.map(toolUse => {
          console.log(`Executing tool: ${toolUse.name}`, toolUse.input);
          const result = executeTool(toolUse.name, toolUse.input);
          return {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result)
          };
        });

        // Add tool results to history
        messages.push({ role: 'user', content: toolResults });

        // Continue the loop to let the model process the tool results
      } else {
        // No tool use - we have a final response
        messages.push({ role: 'assistant', content: response.content });

        // Extract text response
        const textContent = response.content.find(block => block.type === 'text');
        const responseText = textContent ? textContent.text : '';

        return res.json({
          response: responseText,
          session_id: session_id,
          usage: totalUsage,
          iterations: iterations
        });
      }
    }

    // If we hit max iterations, return what we have
    res.status(500).json({ error: 'Agent loop exceeded maximum iterations' });
  } catch (error) {
    console.error('Anthropic API error:', error);
    res.status(500).json({ error: 'Failed to get response from LLM' });
  }
});

// Clear session history endpoint
app.delete('/chat/:session_id', (req, res) => {
  const { session_id } = req.params;
  if (messageHistory.has(session_id)) {
    messageHistory.delete(session_id);
    res.json({ message: `Session ${session_id} cleared` });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// Get session history endpoint
app.get('/chat/:session_id', (req, res) => {
  const { session_id } = req.params;
  if (messageHistory.has(session_id)) {
    res.json({ 
      session_id,
      messages: messageHistory.get(session_id)
    });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

