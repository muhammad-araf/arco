import { ARCO_ERP_TOOLS } from './tools'
import { executeArcoTool, ToolExecutionResult } from './executor'

export interface ChatMessage {
  role: 'user' | 'model' | 'assistant'
  content: string
}

export interface AgentRunResponse {
  reply: string
  actionsExecuted: ToolExecutionResult[]
}

const SYSTEM_INSTRUCTION = `You are the executive AI Command Assistant for ARCO Industrial Agro & Seed Processing ERP.
You assist the Business Owner and Executive Management. You have direct authorization to query and manipulate the live database through your tools.

Core Business Domain & Capabilities:
1. Financial Accounting & Daybook:
   - Daybook summaries, cashbook, bank/online transactions, and cash flow (query_daybook_summary).
   - Party accounts: Customer receivables (who owes us money) and Vendor payables (who we owe money to) (query_party_balances).
   - Invoices & Billing: Customer billing status for seed sales, machinery jobs, and packaging (query_customer_invoices).
   - Recording vouchers: Log operational expenses (record_expense), record customer payments/receipts (record_customer_receipt), and supplier payments (record_vendor_payment).
2. Physical Inventory & Warehouses (Godowns):
   - Check stock levels across categories (raw seed, intermediate, finished seed, packaging, by-product) and low-stock alerts (query_stock_inventory).
   - Warehouse godowns listing and capacities (query_godowns).
   - Manual inventory adjustments (record_stock_adjustment).
3. Inward Goods & Purchases:
   - Inward raw seed consignments, bilty numbers, vehicle numbers, gross/tare/net weight (query_inward_goods).
   - Purchases from vendors (query_purchases).
4. Production & Machinery Service Jobs:
   - Production batch yield, output kg, byproduct kg, waste kg (query_production_summary).
   - Machinery service jobs: cleaning, grading, chemical treatment, drying, charges per bag or per maund (query_machinery_jobs).
   - Bagging & packaging records (query_packing_records).
5. Gate Passes:
   - Outgoing dispatches, vehicle numbers, drivers, destinations (query_gate_passes).
6. Employees, Attendance & Payroll:
   - Staff list, designations, today's attendance logs (query_employees_and_attendance).
   - Record attendance for an employee (record_daily_attendance).
   - Bulk mark attendance for all staff at once (mark_bulk_attendance).
   - Unpaid salaries, current month estimates, employee advance loans (query_payroll_summary).
7. Master Records Creation:
   - Register customer/supplier parties (create_party).
   - Add new products / seed varieties (create_product).

Multilingual & Roman Urdu / Hindi Understanding:
You understand English, Roman Urdu, and Hindi naturally:
- "hisab kitab" / "aaj ka hisab" / "cash kitna aya" means "show today's daybook/cashbook summary".
- "kis se kitna lena he" means "show customer receivables (who owes us)".
- "kis ko kitna dena he" means "show vendor payables (whom we owe)".
- "godown me kitna maal he" / "stock dikhao" means "check inventory stock levels".
- "Araf aur Fasih present hain, baki sab absent" means "call mark_bulk_attendance with present=['Araf', 'Fasih'] and default='absent'".
- "kharcha daal do" / "expense record karo" means "call record_expense".
- Always interpret the user's intent accurately, call the appropriate database tool, and respond in clean English with structured markdown.

Formatting & Response Structure:
Always format your response cleanly:
1. Executive Status Header with an emoji (e.g., "### 💰 Daybook & Cash Flow Summary", "### 📦 Inventory Stock Report", "### ✅ Expense Voucher Recorded").
2. Key Metrics Summary (Total Amount, Net Balance, Count of records).
3. Structured Markdown Tables: For lists of transactions, party balances, stock levels, batches, or attendance, always use a clean Markdown Table.
4. Actionable Next Steps (💡 Recommended Next Actions).
NEVER output raw chain-of-thought or internal tokens. Return only the polished executive response.`

function cleanJsonSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) return schema.map(cleanJsonSchema)
  
  const cleaned: any = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type' && typeof v === 'string') {
      cleaned[k] = v.toLowerCase()
    } else if (typeof v === 'object' && v !== null) {
      cleaned[k] = cleanJsonSchema(v)
    } else {
      cleaned[k] = v
    }
  }
  return cleaned
}

function getOpenRouterTools() {
  return ARCO_ERP_TOOLS.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: cleanJsonSchema({
        type: 'object',
        properties: t.parameters.properties || {},
        required: t.parameters.required || []
      })
    }
  }))
}

function cleanModelReply(raw: string): string {
  if (!raw) return 'Operation processed.'
  return raw
    .replace(/<unk>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim() || 'Operation processed.'
}

async function runOpenRouterAgent(
  messages: ChatMessage[],
  actor: { userId: string; email: string | null; role: string; displayName?: string | null },
  apiKey: string
): Promise<AgentRunResponse> {
  const primaryModel = process.env.OPENROUTER_MODEL || 'openrouter/free'
  const fallbackModels = [
    primaryModel,
    'openrouter/free',
    'meta-llama/llama-3.3-70b-instruct:free'
  ]
    .filter((m, idx, arr) => arr.indexOf(m) === idx)
    .slice(0, 3)

  const endpoint = 'https://openrouter.ai/api/v1/chat/completions'
  const tools = getOpenRouterTools()

  const openAiMessages: any[] = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    ...messages.map(m => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
      content: m.content
    }))
  ]

  const actionsExecuted: ToolExecutionResult[] = []
  let loopCount = 0
  const MAX_LOOPS = 5

  while (loopCount < MAX_LOOPS) {
    loopCount++

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'ARCO ERP'
      },
      body: JSON.stringify({
        model: primaryModel,
        ...(fallbackModels.length > 1 ? { models: fallbackModels } : {}),
        messages: openAiMessages,
        tools,
        temperature: 0.2
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenRouter (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    if (data.error) {
      throw new Error(`OpenRouter Error: ${data.error.message || JSON.stringify(data.error)}`)
    }

    const choice = data.choices?.[0]?.message
    if (!choice) {
      if (actionsExecuted.length > 0) {
        return {
          reply: `### ✅ Operations Executed\n\nSuccessfully committed ${actionsExecuted.length} database operation(s).`,
          actionsExecuted
        }
      }
      throw new Error(`OpenRouter returned no message choices.`)
    }

    const toolCalls = choice.tool_calls || []
    if (!toolCalls.length) {
      const rawText = choice.content || choice.reasoning || (choice as any).text || ''
      const cleaned = cleanModelReply(rawText)
      return {
        reply: cleaned || 'Operation processed successfully.',
        actionsExecuted
      }
    }

    openAiMessages.push(choice)

    for (const tc of toolCalls) {
      let args: any = {}
      try {
        args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function.arguments || {})
      } catch (e) {
        args = {}
      }

      const executionResult = await executeArcoTool(tc.function.name, args || {}, actor)
      actionsExecuted.push(executionResult)

      openAiMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify({
          success: executionResult.success,
          action: executionResult.action,
          details: executionResult.details,
          data: executionResult.data
        })
      })
    }
  }

  return {
    reply: 'Completed requested operations.',
    actionsExecuted
  }
}

async function runGeminiAgent(
  messages: ChatMessage[],
  actor: { userId: string; email: string | null; role: string; displayName?: string | null },
  apiKey: string
): Promise<AgentRunResponse> {
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`

  const contents: any[] = messages.map(m => ({
    role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }))

  const actionsExecuted: ToolExecutionResult[] = []
  let loopCount = 0
  const MAX_LOOPS = 5

  while (loopCount < MAX_LOOPS) {
    loopCount++

    const requestBody = {
      system_instruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }]
      },
      contents,
      tools: [
        {
          function_declarations: ARCO_ERP_TOOLS
        }
      ],
      generation_config: {
        temperature: 0.2
      }
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    const candidate = data.candidates?.[0]
    if (!candidate || !candidate.content) {
      return {
        reply: 'The AI model returned an empty response.',
        actionsExecuted
      }
    }

    const parts = candidate.content.parts || []
    const functionCallPart = parts.find((p: any) => p.functionCall)

    if (!functionCallPart) {
      const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text).join('\n')
      return {
        reply: textParts || 'Operation processed.',
        actionsExecuted
      }
    }

    const { name: toolName, args: toolArgs } = functionCallPart.functionCall
    const executionResult = await executeArcoTool(toolName, toolArgs || {}, actor)
    actionsExecuted.push(executionResult)

    contents.push(candidate.content)

    contents.push({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: toolName,
            response: {
              success: executionResult.success,
              action: executionResult.action,
              details: executionResult.details,
              data: executionResult.data
            }
          }
        }
      ]
    })
  }

  return {
    reply: 'Completed requested operations.',
    actionsExecuted
  }
}

export async function runArcoAgent(
  messages: ChatMessage[],
  actor: { userId: string; email: string | null; role: string; displayName?: string | null }
): Promise<AgentRunResponse> {
  const openRouterKey = process.env.OPENROUTER_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY

  if (openRouterKey) {
    try {
      return await runOpenRouterAgent(messages, actor, openRouterKey)
    } catch (err: any) {
      console.error('OpenRouter execution error:', err?.message || err)
      if (geminiKey) {
        try {
          return await runGeminiAgent(messages, actor, geminiKey)
        } catch (geminiErr: any) {
          console.error('Gemini fallback failed:', geminiErr?.message || geminiErr)
        }
      }
      return {
        reply: `⚠️ **AI Service Error**: Could not complete request via OpenRouter. ${err?.message || ''}`,
        actionsExecuted: []
      }
    }
  }

  if (geminiKey) {
    try {
      return await runGeminiAgent(messages, actor, geminiKey)
    } catch (err: any) {
      return {
        reply: `⚠️ **AI Service Error**: ${err?.message || 'Error connecting to Gemini AI.'}`,
        actionsExecuted: []
      }
    }
  }

  return {
    reply: '⚠️ **API Key Missing**: Please set `GEMINI_API_KEY` or `OPENROUTER_API_KEY` in `.env.local` to enable the AI Agent.',
    actionsExecuted: []
  }
}

export type StreamEvent =
  | { type: 'status'; message: string }
  | { type: 'thinking'; text: string }
  | { type: 'action'; action: ToolExecutionResult }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; error: string }

async function runOpenRouterAgentWithStreaming(
  messages: ChatMessage[],
  actor: { userId: string; email: string | null; role: string; displayName?: string | null },
  apiKey: string,
  sendEvent: (event: StreamEvent) => void
): Promise<void> {
  const primaryModel = process.env.OPENROUTER_MODEL || 'openrouter/free'
  const fallbackModels = [
    primaryModel,
    'openrouter/free',
    'meta-llama/llama-3.3-70b-instruct:free'
  ]
    .filter((m, idx, arr) => arr.indexOf(m) === idx)
    .slice(0, 3)

  const endpoint = 'https://openrouter.ai/api/v1/chat/completions'
  const tools = getOpenRouterTools()

  const openAiMessages: any[] = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    ...messages.map(m => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
      content: m.content
    }))
  ]

  sendEvent({ type: 'status', message: 'Analyzing business request...' })

  let loopCount = 0
  const MAX_LOOPS = 5

  while (loopCount < MAX_LOOPS) {
    loopCount++

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'ARCO ERP'
      },
      body: JSON.stringify({
        model: primaryModel,
        ...(fallbackModels.length > 1 ? { models: fallbackModels } : {}),
        messages: openAiMessages,
        tools,
        include_reasoning: true,
        temperature: 0.2
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenRouter (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    if (data.error) {
      throw new Error(`OpenRouter Error: ${data.error.message || JSON.stringify(data.error)}`)
    }

    const choice = data.choices?.[0]?.message
    if (!choice) {
      throw new Error(`OpenRouter returned no message choices.`)
    }

    const reasoningText = choice.reasoning || (choice as any).reasoning_content || ''
    if (reasoningText) {
      sendEvent({ type: 'thinking', text: reasoningText })
    }

    const thinkMatch = (choice.content || '').match(/<think>([\s\S]*?)<\/think>/i)
    if (thinkMatch) {
      sendEvent({ type: 'thinking', text: thinkMatch[1].trim() })
    }

    const toolCalls = choice.tool_calls || []

    if (!toolCalls.length) {
      sendEvent({ type: 'status', message: '' })
      const rawText = choice.content || choice.reasoning || (choice as any).text || ''
      const cleaned = cleanModelReply(rawText)
      const textToStream = cleaned || 'Operation processed successfully.'
      
      const chunkSize = 16
      for (let i = 0; i < textToStream.length; i += chunkSize) {
        sendEvent({ type: 'delta', text: textToStream.slice(i, i + chunkSize) })
        await new Promise(r => setTimeout(r, 12))
      }
      return
    }

    const toolNames = toolCalls.map((t: any) => t.function.name).join(', ')
    sendEvent({ type: 'status', message: `Querying database (${toolNames})...` })
    sendEvent({ type: 'thinking', text: `Triggered database operation: ${toolNames}` })

    openAiMessages.push(choice)

    for (const tc of toolCalls) {
      let args: any = {}
      try {
        args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function.arguments || {})
      } catch (e) {
        args = {}
      }

      const executionResult = await executeArcoTool(tc.function.name, args || {}, actor)
      sendEvent({ type: 'action', action: executionResult })
      sendEvent({ type: 'status', message: `Processed ${executionResult.action}. Formulating response...` })

      openAiMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify({
          success: executionResult.success,
          action: executionResult.action,
          details: executionResult.details,
          data: executionResult.data
        })
      })
    }
  }

  sendEvent({ type: 'status', message: '' })
  sendEvent({ type: 'delta', text: 'All operations executed and committed to database.' })
}

export function createAgentStream(
  messages: ChatMessage[],
  actor: { userId: string; email: string | null; role: string; displayName?: string | null }
): ReadableStream {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      const sendEvent = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch (e) {
          // Client closed connection
        }
      }

      try {
        const openRouterKey = process.env.OPENROUTER_API_KEY
        const geminiKey = process.env.GEMINI_API_KEY

        if (openRouterKey) {
          try {
            await runOpenRouterAgentWithStreaming(messages, actor, openRouterKey, sendEvent)
            sendEvent({ type: 'done' })
            return
          } catch (err: any) {
            console.error('OpenRouter streaming error, falling back:', err?.message || err)
            if (!geminiKey) {
              sendEvent({ type: 'error', error: err?.message || 'OpenRouter streaming failed' })
              return
            }
          }
        }

        const response = await runArcoAgent(messages, actor)
        for (const act of response.actionsExecuted) {
          sendEvent({ type: 'action', action: act })
        }
        const text = response.reply || 'Completed.'
        const chunkSize = 16
        for (let i = 0; i < text.length; i += chunkSize) {
          sendEvent({ type: 'delta', text: text.slice(i, i + chunkSize) })
          await new Promise(r => setTimeout(r, 12))
        }
        sendEvent({ type: 'done' })
      } catch (err: any) {
        console.error('Streaming agent fatal error:', err)
        sendEvent({ type: 'error', error: err?.message || 'Internal Agent Streaming Error' })
      } finally {
        try {
          controller.close()
        } catch (e) {}
      }
    }
  })
}
