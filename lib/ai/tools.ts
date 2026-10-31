export interface ToolDeclaration {
  name: string
  description: string
  parameters: {
    type: 'OBJECT' | 'object'
    properties: Record<string, {
      type: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'INTEGER' | 'ARRAY' | 'OBJECT' | 'string' | 'number' | 'boolean' | 'integer' | 'array' | 'object'
      description: string
      enum?: string[]
      items?: any
    }>
    required?: string[]
  }
}

export const ARCO_ERP_TOOLS: ToolDeclaration[] = [
  // ==================== 1. FINANCE, CASHBOOK & DAYBOOK ====================
  {
    name: 'query_daybook_summary',
    description: 'Query live financial transactions, daybook, and cashbook summaries (cash, bank, online accounts). Returns debits (cash-in/receipts), credits (cash-out/expenses/payments), and net balances for today or a custom date range.',
    parameters: {
      type: 'OBJECT',
      properties: {
        from_date: { type: 'STRING', description: 'Start date in YYYY-MM-DD format (defaults to today if omitted)' },
        to_date: { type: 'STRING', description: 'End date in YYYY-MM-DD format (defaults to today if omitted)' },
        account_type: { 
          type: 'STRING', 
          description: 'Filter by account type: "all", "cash", "bank", or "online"',
          enum: ['all', 'cash', 'bank', 'online']
        }
      }
    }
  },
  {
    name: 'query_party_balances',
    description: 'Check party account balances: top customer receivables (who owes us money), vendor payables (whom we owe money to), or search for a specific customer/supplier by name.',
    parameters: {
      type: 'OBJECT',
      properties: {
        type: { 
          type: 'STRING', 
          description: 'Filter by party balance type: "receivables" (unpaid customers), "payables" (unpaid vendors/suppliers), or "all"',
          enum: ['receivables', 'payables', 'all']
        },
        search_query: { type: 'STRING', description: 'Party name or phone number to search for specific balance' },
        limit: { type: 'INTEGER', description: 'Maximum number of parties to return (default 10)' }
      }
    }
  },
  {
    name: 'query_customer_invoices',
    description: 'Query customer billing invoices for machinery service jobs, packing, or seed sales. Check unpaid, partially paid, or posted invoices.',
    parameters: {
      type: 'OBJECT',
      properties: {
        status: { 
          type: 'STRING', 
          description: 'Invoice status: "unpaid", "partially_paid", "paid", or "all"',
          enum: ['unpaid', 'partially_paid', 'paid', 'all']
        },
        customer_name: { type: 'STRING', description: 'Search invoices for a specific customer name' }
      }
    }
  },
  {
    name: 'record_expense',
    description: 'Record an operational expense voucher into the company financial ledger and daybook.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category_name: { type: 'STRING', description: 'Expense category name (e.g., "Electricity", "Fuel/Diesel", "Maintenance", "Office Supplies", "Labor", "Transport"). Auto-created if new.' },
        amount: { type: 'NUMBER', description: 'Expense amount in PKR' },
        payee: { type: 'STRING', description: 'Person or vendor paid (e.g., "WAPDA", "PSO Petrol Pump", "Mechanic Tariq")' },
        payment_method: { 
          type: 'STRING', 
          description: 'Payment method used',
          enum: ['cash', 'bank', 'online']
        },
        description: { type: 'STRING', description: 'Brief description/reason for the expense' },
        date: { type: 'STRING', description: 'Date in YYYY-MM-DD format (defaults to today)' }
      },
      required: ['amount', 'payee', 'payment_method', 'description']
    }
  },
  {
    name: 'record_customer_receipt',
    description: 'Record a receipt payment received from a customer into cash/bank accounts, reducing their outstanding receivable balance.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: { type: 'STRING', description: 'Name of the customer paying' },
        amount: { type: 'NUMBER', description: 'Payment amount received in PKR' },
        payment_method: { 
          type: 'STRING', 
          description: 'Mode of payment',
          enum: ['cash', 'bank', 'online']
        },
        reference_no: { type: 'STRING', description: 'Cheque number, online transaction ID, or receipt slip reference' },
        notes: { type: 'STRING', description: 'Optional payment notes or remarks' },
        date: { type: 'STRING', description: 'Date in YYYY-MM-DD format (defaults to today)' }
      },
      required: ['customer_name', 'amount', 'payment_method']
    }
  },
  {
    name: 'record_vendor_payment',
    description: 'Record a payment made to a supplier/vendor for raw seed, packaging, or services, reducing our payable balance.',
    parameters: {
      type: 'OBJECT',
      properties: {
        vendor_name: { type: 'STRING', description: 'Name of the vendor/supplier' },
        amount: { type: 'NUMBER', description: 'Payment amount made in PKR' },
        payment_method: { 
          type: 'STRING', 
          description: 'Mode of payment',
          enum: ['cash', 'bank', 'online']
        },
        notes: { type: 'STRING', description: 'Payment notes or invoice reference' },
        date: { type: 'STRING', description: 'Date in YYYY-MM-DD format (defaults to today)' }
      },
      required: ['vendor_name', 'amount', 'payment_method']
    }
  },

  // ==================== 2. INVENTORY & STOCK ====================
  {
    name: 'query_stock_inventory',
    description: 'Check live physical inventory balances in warehouses/godowns. View stock by category (raw_seed, intermediate, finished_seed, by_product, packaging) or inspect low stock levels.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: { 
          type: 'STRING', 
          description: 'Product category filter',
          enum: ['all', 'raw_seed', 'intermediate', 'finished_seed', 'by_product', 'packaging', 'low_stock']
        },
        godown_name: { type: 'STRING', description: 'Filter by specific godown/warehouse name' },
        product_name: { type: 'STRING', description: 'Search for a specific product name' }
      }
    }
  },
  {
    name: 'query_godowns',
    description: 'List all storage warehouses/godowns, capacities (metric tons), and status.',
    parameters: {
      type: 'OBJECT',
      properties: {
        active_only: { type: 'BOOLEAN', description: 'Return only active godowns (default true)' }
      }
    }
  },
  {
    name: 'record_stock_adjustment',
    description: 'Adjust inventory stock in a godown for manual stock corrections, count adjustments, or spoilage.',
    parameters: {
      type: 'OBJECT',
      properties: {
        product_name: { type: 'STRING', description: 'Name of the product to adjust' },
        godown_name: { type: 'STRING', description: 'Name of the godown' },
        quantity: { type: 'NUMBER', description: 'Quantity (positive number)' },
        direction: { 
          type: 'STRING', 
          description: '"inward" to add stock, "outward" to remove stock',
          enum: ['inward', 'outward']
        },
        reason: { type: 'STRING', description: 'Reason for the adjustment (e.g. Physical count reconciliation, Spoilage)' }
      },
      required: ['product_name', 'godown_name', 'quantity', 'direction', 'reason']
    }
  },

  // ==================== 3. INWARD GOODS & PURCHASES ====================
  {
    name: 'query_inward_goods',
    description: 'Query inward goods consignments received at the gate/godown (raw seeds, bilty numbers, vehicle numbers, gross/tare/net weight, bag counts).',
    parameters: {
      type: 'OBJECT',
      properties: {
        supplier_name: { type: 'STRING', description: 'Filter by supplier name' },
        status: { 
          type: 'STRING', 
          description: 'Filter by voucher status',
          enum: ['all', 'posted', 'draft']
        },
        limit: { type: 'INTEGER', description: 'Number of recent inward vouchers (default 10)' }
      }
    }
  },
  {
    name: 'query_purchases',
    description: 'Query purchase vouchers from vendors for raw seed or packaging bags (vendor name, total amount, paid amount, balance).',
    parameters: {
      type: 'OBJECT',
      properties: {
        vendor_name: { type: 'STRING', description: 'Filter by vendor name' },
        unpaid_only: { type: 'BOOLEAN', description: 'Show only purchases with outstanding balance' }
      }
    }
  },

  // ==================== 4. PRODUCTION, RECIPES & MACHINERY ====================
  {
    name: 'query_production_summary',
    description: 'Query seed processing & production batches. Check actual input kg, output kg, by-product kg, waste kg, and average yield percentage.',
    parameters: {
      type: 'OBJECT',
      properties: {
        status: { 
          type: 'STRING', 
          description: 'Batch status',
          enum: ['all', 'posted', 'draft']
        },
        limit: { type: 'INTEGER', description: 'Number of recent batches (default 10)' }
      }
    }
  },
  {
    name: 'query_machinery_jobs',
    description: 'Query machinery service jobs (cleaning, grading, chemical treatment, drying, gravity separation). View customer name, machine, input/output kg, bag count, rate basis, service charge, and billing status.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: { type: 'STRING', description: 'Filter by customer name' },
        payment_status: { 
          type: 'STRING', 
          description: 'Filter by billing status',
          enum: ['all', 'unbilled', 'invoiced', 'paid']
        },
        limit: { type: 'INTEGER', description: 'Number of recent jobs (default 10)' }
      }
    }
  },
  {
    name: 'query_packing_records',
    description: 'Query packing and bagging records (packaging type, bags packed, total packed kg, damaged bags, packing charges).',
    parameters: {
      type: 'OBJECT',
      properties: {
        limit: { type: 'INTEGER', description: 'Number of recent records (default 10)' }
      }
    }
  },

  // ==================== 5. GATE PASSES ====================
  {
    name: 'query_gate_passes',
    description: 'Query outgoing gate passes (dispatches, vehicles, drivers, customer name, total bags, total weight in kg, destination, and status).',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: { type: 'STRING', description: 'Filter by customer name' },
        status: { 
          type: 'STRING', 
          description: 'Gate pass status',
          enum: ['all', 'posted', 'draft', 'returned']
        },
        limit: { type: 'INTEGER', description: 'Number of recent gate passes (default 10)' }
      }
    }
  },

  // ==================== 6. EMPLOYEES, ATTENDANCE & PAYROLL ====================
  {
    name: 'query_employees_and_attendance',
    description: 'Check active employees, designations, pay types, and today\'s attendance status (present, absent, half_day, leave).',
    parameters: {
      type: 'OBJECT',
      properties: {
        date: { type: 'STRING', description: 'Date in YYYY-MM-DD format (defaults to today)' },
        filter_status: { 
          type: 'STRING', 
          description: 'Filter attendance status',
          enum: ['all', 'present', 'absent', 'leave']
        }
      }
    }
  },
  {
    name: 'record_daily_attendance',
    description: 'Log daily attendance for an individual employee (Present, Absent, Half-Day, Leave).',
    parameters: {
      type: 'OBJECT',
      properties: {
        employee_name: { type: 'STRING', description: 'Full or partial name of the employee (e.g. "Araf", "Ali")' },
        status: { 
          type: 'STRING', 
          description: 'Attendance status',
          enum: ['present', 'absent', 'half_day', 'leave']
        },
        overtime_hours: { type: 'NUMBER', description: 'Overtime hours if any (default 0)' },
        date: { type: 'STRING', description: 'Date in YYYY-MM-DD format (defaults to today)' },
        notes: { type: 'STRING', description: 'Remarks or reason' }
      },
      required: ['employee_name', 'status']
    }
  },
  {
    name: 'mark_bulk_attendance',
    description: 'Bulk mark attendance for all staff at once. Ideal for commands like "Mark Araf and Fasih present, and everyone else absent".',
    parameters: {
      type: 'OBJECT',
      properties: {
        present_employee_names: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'List of employee names who are present'
        },
        absent_employee_names: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'List of employee names who are explicitly absent'
        },
        default_status_for_others: {
          type: 'STRING',
          description: 'Default status for any other active employees not mentioned (default: "absent")',
          enum: ['present', 'absent', 'leave']
        },
        date: { type: 'STRING', description: 'Date in YYYY-MM-DD format (defaults to today)' }
      }
    }
  },
  {
    name: 'query_payroll_summary',
    description: 'Query payroll estimates, unpaid employee salaries, and outstanding employee advance loans.',
    parameters: {
      type: 'OBJECT',
      properties: {
        month: { type: 'INTEGER', description: 'Month (1-12, defaults to current month)' },
        year: { type: 'INTEGER', description: 'Year (defaults to current year)' }
      }
    }
  },

  // ==================== 7. MASTERS CREATION ====================
  {
    name: 'create_party',
    description: 'Register a new customer, supplier, or partner party in the system.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Name of the party (company or individual)' },
        type: { 
          type: 'STRING', 
          description: 'Party type',
          enum: ['customer', 'supplier', 'both']
        },
        phone: { type: 'STRING', description: 'Phone number' },
        address: { type: 'STRING', description: 'City or physical address' },
        opening_balance: { type: 'NUMBER', description: 'Opening balance in PKR (default 0)' },
        balance_type: { 
          type: 'STRING', 
          description: '"receivable" if customer owes us, "payable" if we owe supplier',
          enum: ['receivable', 'payable']
        }
      },
      required: ['name', 'type']
    }
  },
  {
    name: 'create_product',
    description: 'Add a new product or seed variety to the master catalog.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Product name (e.g., "Wheat Seed Grade A", "50kg PP Bag", "Mustard Seed")' },
        code: { type: 'STRING', description: 'Unique product code (auto-generated if omitted)' },
        category: { 
          type: 'STRING', 
          description: 'Product category',
          enum: ['raw_seed', 'intermediate', 'finished_seed', 'by_product', 'packaging']
        },
        default_unit: { 
          type: 'STRING', 
          description: 'Standard measurement unit',
          enum: ['kg', 'bag', 'maund']
        },
        min_stock: { type: 'NUMBER', description: 'Minimum reorder stock alert level' }
      },
      required: ['name', 'category']
    }
  }
]
