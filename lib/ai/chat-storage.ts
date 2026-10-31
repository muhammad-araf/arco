'use client'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  thinking?: string
  status?: string
  actions?: {
    action: string
    details: string
    success: boolean
    data?: any
  }[]
}

export interface ChatSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
}

const STORAGE_KEY = 'arco_ai_chat_sessions'

const DEFAULT_SESSIONS: ChatSession[] = [
  {
    id: 'sample-session-1',
    title: 'Daybook & Cash Flow Audit',
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    messages: [
      {
        id: 's1-m1',
        role: 'user',
        content: 'Show today cash in hand and daybook summary',
        timestamp: '11:30 AM'
      },
      {
        id: 's1-m2',
        role: 'assistant',
        content: '### 💰 Today Daybook & Cash Flow Summary\n\nHere is your financial position for today:\n\n| Flow Stream | Count | Total Amount |\n| :--- | :--- | :--- |\n| **Total Receipts (Cash In)** | 3 receipts | **Rs 245,000** |\n| **Expenses Paid** | 2 vouchers | **Rs 18,500** |\n| **Vendor Payments** | 1 payment | **Rs 85,000** |\n| **Net Cash Flow** | - | **+Rs 141,500** |\n\n#### 💡 Recommended Next Actions\n* Reconcile physical cash drawer with daybook receipts.\n* Allocate pending customer receipts to unbilled machinery jobs.',
        timestamp: '11:30 AM',
        actions: [
          {
            action: 'QUERY_DAYBOOK_SUMMARY',
            details: 'Audited 6 cashbook vouchers across cash and bank accounts.',
            success: true
          }
        ]
      }
    ]
  },
  {
    id: 'sample-session-2',
    title: 'Warehouse Stock Audit',
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    messages: [
      {
        id: 's2-m1',
        role: 'user',
        content: 'Check stock levels in all godowns and low stock alerts',
        timestamp: '09:15 AM'
      },
      {
        id: 's2-m2',
        role: 'assistant',
        content: '### 📦 Inventory Stock Report\n\nLive inventory audited across all godowns:\n\n| Product | Category | Current Stock | Unit | Min Stock | Status |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n| **Wheat Seed Super** | raw_seed | 42,500 | kg | 10,000 | ✅ Healthy |\n| **Mustard Seed Grade A** | raw_seed | 18,200 | kg | 5,000 | ✅ Healthy |\n| **50kg PP Bags (Blue)** | packaging | 450 | bag | 1,000 | ⚠️ Low Stock |\n\n#### 💡 Recommended Next Actions\n* Reorder 50kg PP Bags from packaging suppliers.',
        timestamp: '09:15 AM',
        actions: [
          {
            action: 'QUERY_STOCK_INVENTORY',
            details: 'Audited 14 product categories and live stock ledgers.',
            success: true
          }
        ]
      }
    ]
  },
  {
    id: 'sample-session-3',
    title: 'Party Receivables & Payables',
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    messages: [
      {
        id: 's3-m1',
        role: 'user',
        content: 'Top party balances - kis se kitna lena he aur kis ko kitna dena he?',
        timestamp: 'Yesterday'
      },
      {
        id: 's3-m2',
        role: 'assistant',
        content: '### 👥 Party Accounts Summary\n\n**Total Receivables (Customers):** Rs 1,450,000\n**Total Payables (Suppliers):** Rs 620,000\n\n| Party Name | Type | Balance (PKR) | Category |\n| :--- | :--- | :--- | :--- |\n| **Al-Rehman Agro Traders** | Customer | **Rs 480,000** | Receivable |\n| **Haji Bilal & Sons** | Customer | **Rs 350,000** | Receivable |\n| **Punjab Seed Corporation** | Supplier | **Rs 380,000** | Payable |\n| **National Bag Industries** | Supplier | **Rs 140,000** | Payable |',
        timestamp: 'Yesterday',
        actions: [
          {
            action: 'QUERY_PARTY_BALANCES',
            details: 'Aggregated ledger balances for 28 active business parties.',
            success: true
          }
        ]
      }
    ]
  }
]

export function getChatSessions(): ChatSession[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SESSIONS))
      return DEFAULT_SESSIONS
    }
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : DEFAULT_SESSIONS
  } catch {
    return DEFAULT_SESSIONS
  }
}

export function getChatSession(id: string): ChatSession | null {
  const sessions = getChatSessions()
  return sessions.find(s => s.id === id) || null
}

export function saveChatSession(session: ChatSession): void {
  if (typeof window === 'undefined') return
  try {
    const sessions = getChatSessions()
    const index = sessions.findIndex(s => s.id === session.id)
    if (index >= 0) {
      sessions[index] = session
    } else {
      sessions.unshift(session)
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
    window.dispatchEvent(new CustomEvent('arco-chats-changed'))
  } catch (err) {
    console.error('Failed to save chat session:', err)
  }
}

export function deleteChatSession(id: string): void {
  if (typeof window === 'undefined') return
  try {
    const sessions = getChatSessions().filter(s => s.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
    window.dispatchEvent(new CustomEvent('arco-chats-changed'))
  } catch (err) {
    console.error('Failed to delete chat session:', err)
  }
}

export function createNewSession(firstUserPrompt: string): ChatSession {
  const cleanTitle = firstUserPrompt.trim()
  const title = cleanTitle.length > 28 
    ? cleanTitle.slice(0, 28) + '...' 
    : cleanTitle

  const now = new Date().toISOString()
  return {
    id: 'session-' + Date.now(),
    title: title || 'New Conversation',
    createdAt: now,
    updatedAt: now,
    messages: []
  }
}
