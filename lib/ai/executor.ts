import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export interface ToolExecutionResult {
  action: string
  details: string
  success: boolean
  data?: any
}

export async function executeArcoTool(
  toolName: string,
  args: Record<string, any>,
  actor: { userId: string; email: string | null; role: string; displayName?: string | null }
): Promise<ToolExecutionResult> {
  const supabase = await createClient()

  try {
    switch (toolName) {
      // ==================== 1. FINANCE, CASHBOOK & DAYBOOK ====================
      case 'query_daybook_summary': {
        const todayStr = new Date().toISOString().slice(0, 10)
        const fromDate = args.from_date || todayStr
        const toDate = args.to_date || todayStr

        // Query receipts
        let receiptsQuery = supabase
          .from('receipts')
          .select('id, receipt_no, date, amount, payment_method, reference_no, notes, customer:parties!receipts_customer_id_fkey(name)')
          .gte('date', fromDate)
          .lte('date', toDate)
        
        // Query expenses
        let expensesQuery = supabase
          .from('expenses')
          .select('id, expense_no, date, amount, payment_method, payee, description, category:expense_categories(name)')
          .gte('date', fromDate)
          .lte('date', toDate)

        // Query vendor payments
        let vendorPaymentsQuery = supabase
          .from('vendor_payments')
          .select('id, voucher_no, date, amount, payment_method, notes, vendor:parties!vendor_payments_vendor_id_fkey(name)')
          .gte('date', fromDate)
          .lte('date', toDate)

        const [receiptsRes, expensesRes, vpRes] = await Promise.all([
          receiptsQuery,
          expensesQuery,
          vendorPaymentsQuery
        ])

        const receipts = receiptsRes.data || []
        const expenses = expensesRes.data || []
        const vendorPayments = vpRes.data || []

        const totalCashIn = receipts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
        const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
        const totalVendorPaid = vendorPayments.reduce((sum, v) => sum + (Number(v.amount) || 0), 0)
        const totalCashOut = totalExpenses + totalVendorPaid
        const netCashFlow = totalCashIn - totalCashOut

        // Account-wise breakdown
        const cashInHand = receipts.filter(r => r.payment_method === 'cash').reduce((sum, r) => sum + Number(r.amount), 0)
          - expenses.filter(e => e.payment_method === 'cash').reduce((sum, e) => sum + Number(e.amount), 0)
          - vendorPayments.filter(v => v.payment_method === 'cash').reduce((sum, v) => sum + Number(v.amount), 0)

        const bankFlow = receipts.filter(r => r.payment_method === 'bank' || r.payment_method === 'online').reduce((sum, r) => sum + Number(r.amount), 0)
          - expenses.filter(e => e.payment_method === 'bank' || e.payment_method === 'online').reduce((sum, e) => sum + Number(e.amount), 0)
          - vendorPayments.filter(v => v.payment_method === 'bank' || v.payment_method === 'online').reduce((sum, v) => sum + Number(v.amount), 0)

        return {
          action: 'QUERY_DAYBOOK_SUMMARY',
          details: `Daybook (${fromDate} to ${toDate}): Total Inflow: Rs ${totalCashIn.toLocaleString()} (${receipts.length} receipts), Total Outflow: Rs ${totalCashOut.toLocaleString()} (${expenses.length} expenses, ${vendorPayments.length} vendor payments), Net Flow: Rs ${netCashFlow.toLocaleString()}.`,
          success: true,
          data: {
            period: { from: fromDate, to: toDate },
            total_cash_in: totalCashIn,
            total_cash_out: totalCashOut,
            net_cash_flow: netCashFlow,
            cash_in_hand_flow: cashInHand,
            bank_online_flow: bankFlow,
            receipts_count: receipts.length,
            expenses_count: expenses.length,
            vendor_payments_count: vendorPayments.length,
            recent_receipts: receipts.slice(0, 5).map((r: any) => ({
              no: r.receipt_no,
              date: r.date,
              customer: r.customer?.name || 'Customer',
              amount: r.amount,
              method: r.payment_method
            })),
            recent_expenses: expenses.slice(0, 5).map((e: any) => ({
              no: e.expense_no,
              date: e.date,
              payee: e.payee,
              category: e.category?.name || 'General',
              amount: e.amount,
              method: e.payment_method
            }))
          }
        }
      }

      case 'query_party_balances': {
        const filterType = args.type || 'all'
        const limit = args.limit || 10
        let query = supabase
          .from('parties')
          .select('id, code, name, type, phone, current_balance, balance_type, is_active')
          .eq('is_active', true)

        if (args.search_query) {
          query = query.ilike('name', `%${args.search_query.trim()}%`)
        }

        const { data: parties, error } = await query
        if (error) throw new Error(error.message)

        let resultParties = parties || []

        if (filterType === 'receivables') {
          // Customers owing us money
          resultParties = resultParties
            .filter(p => p.balance_type === 'receivable' && (p.current_balance || 0) > 0)
            .sort((a, b) => (b.current_balance || 0) - (a.current_balance || 0))
        } else if (filterType === 'payables') {
          // Vendors we owe money to
          resultParties = resultParties
            .filter(p => p.balance_type === 'payable' && (p.current_balance || 0) > 0)
            .sort((a, b) => (b.current_balance || 0) - (a.current_balance || 0))
        } else {
          resultParties = resultParties.sort((a, b) => (b.current_balance || 0) - (a.current_balance || 0))
        }

        const totalReceivables = (parties || [])
          .filter(p => p.balance_type === 'receivable')
          .reduce((sum, p) => sum + (Number(p.current_balance) || 0), 0)

        const totalPayables = (parties || [])
          .filter(p => p.balance_type === 'payable')
          .reduce((sum, p) => sum + (Number(p.current_balance) || 0), 0)

        const sliced = resultParties.slice(0, limit)

        return {
          action: 'QUERY_PARTY_BALANCES',
          details: `Party Balances: Total Receivables (from customers): Rs ${totalReceivables.toLocaleString()}, Total Payables (to suppliers): Rs ${totalPayables.toLocaleString()}. Returning top ${sliced.length} parties.`,
          success: true,
          data: {
            total_receivables: totalReceivables,
            total_payables: totalPayables,
            parties: sliced.map(p => ({
              name: p.name,
              code: p.code,
              type: p.type,
              balance: p.current_balance || 0,
              balance_type: p.balance_type,
              phone: p.phone || 'N/A'
            }))
          }
        }
      }

      case 'query_customer_invoices': {
        let query = supabase
          .from('invoices')
          .select('id, invoice_no, date, customer:parties!invoices_customer_id_fkey(name), source_type, total_amount, paid_amount, balance_amount, status')
          .order('date', { ascending: false })
          .limit(15)

        if (args.status && args.status !== 'all') {
          query = query.eq('status', args.status)
        }

        const { data: invoices, error } = await query
        if (error) throw new Error(error.message)

        let filtered = invoices || []
        if (args.customer_name) {
          filtered = filtered.filter((inv: any) => 
            inv.customer?.name?.toLowerCase().includes(args.customer_name.toLowerCase())
          )
        }

        const totalOutstanding = filtered.reduce((sum, i) => sum + (Number(i.balance_amount) || 0), 0)

        return {
          action: 'QUERY_CUSTOMER_INVOICES',
          details: `Retrieved ${filtered.length} customer invoices. Total outstanding balance: Rs ${totalOutstanding.toLocaleString()}.`,
          success: true,
          data: {
            total_outstanding: totalOutstanding,
            invoices: filtered.map((i: any) => ({
              invoice_no: i.invoice_no,
              date: i.date,
              customer: i.customer?.name || 'Customer',
              source: i.source_type,
              total: i.total_amount,
              paid: i.paid_amount,
              balance: i.balance_amount,
              status: i.status
            }))
          }
        }
      }

      case 'record_expense': {
        const { category_name, amount, payee, payment_method, description, date } = args
        const todayStr = date || new Date().toISOString().slice(0, 10)

        // Find or create expense category
        let categoryId: string | null = null
        if (category_name) {
          const { data: existingCat } = await supabase
            .from('expense_categories')
            .select('id')
            .ilike('name', category_name.trim())
            .limit(1)
            .single()

          if (existingCat) {
            categoryId = existingCat.id
          } else {
            const { data: newCat } = await supabase
              .from('expense_categories')
              .insert({ name: category_name.trim(), is_active: true })
              .select('id')
              .single()
            categoryId = newCat?.id || null
          }
        }

        const expenseNo = `EXP-${Date.now().toString().slice(-6)}`

        const { data: expense, error } = await supabase
          .from('expenses')
          .insert({
            expense_no: expenseNo,
            date: todayStr,
            category_id: categoryId,
            payee: payee.trim(),
            amount: Number(amount) || 0,
            payment_method: payment_method || 'cash',
            description: description.trim(),
            status: 'posted'
          })
          .select('id, expense_no, amount, payee, date')
          .single()

        if (error) throw new Error(error.message)

        revalidatePath('/daybook')
        revalidatePath('/ledgers')
        revalidatePath('/dashboard')

        return {
          action: 'RECORD_EXPENSE',
          details: `Recorded expense voucher ${expenseNo} of Rs ${Number(amount).toLocaleString()} paid to ${payee} via ${payment_method}.`,
          success: true,
          data: expense
        }
      }

      case 'record_customer_receipt': {
        const { customer_name, amount, payment_method, reference_no, notes, date } = args
        const todayStr = date || new Date().toISOString().slice(0, 10)

        // Match customer party
        const { data: party, error: pError } = await supabase
          .from('parties')
          .select('id, name, current_balance, balance_type')
          .ilike('name', `%${customer_name.trim()}%`)
          .limit(1)
          .single()

        if (pError || !party) {
          throw new Error(`Customer party "${customer_name}" not found in database. Please check the party name.`)
        }

        const receiptNo = `RCT-${Date.now().toString().slice(-6)}`
        const numAmount = Number(amount) || 0

        const { data: receipt, error: rError } = await supabase
          .from('receipts')
          .insert({
            receipt_no: receiptNo,
            date: todayStr,
            customer_id: party.id,
            amount: numAmount,
            payment_method: payment_method || 'cash',
            reference_no: reference_no || null,
            notes: notes || 'Receipt recorded via AI Assistant'
          })
          .select('id, receipt_no, amount, date')
          .single()

        if (rError) throw new Error(rError.message)

        // Update party current balance
        const updatedBal = Math.max(0, (party.current_balance || 0) - numAmount)
        await supabase
          .from('parties')
          .update({ current_balance: updatedBal })
          .eq('id', party.id)

        revalidatePath('/daybook')
        revalidatePath('/billing')
        revalidatePath('/parties')
        revalidatePath('/ledgers')
        revalidatePath('/dashboard')

        return {
          action: 'RECORD_CUSTOMER_RECEIPT',
          details: `Recorded receipt ${receiptNo} of Rs ${numAmount.toLocaleString()} from ${party.name} (${payment_method}). Customer outstanding balance updated to Rs ${updatedBal.toLocaleString()}.`,
          success: true,
          data: {
            receipt_no: receiptNo,
            customer: party.name,
            amount: numAmount,
            remaining_balance: updatedBal
          }
        }
      }

      case 'record_vendor_payment': {
        const { vendor_name, amount, payment_method, notes, date } = args
        const todayStr = date || new Date().toISOString().slice(0, 10)

        const { data: party, error: pError } = await supabase
          .from('parties')
          .select('id, name, current_balance, balance_type')
          .ilike('name', `%${vendor_name.trim()}%`)
          .limit(1)
          .single()

        if (pError || !party) {
          throw new Error(`Vendor party "${vendor_name}" not found in database.`)
        }

        const voucherNo = `VP-${Date.now().toString().slice(-6)}`
        const numAmount = Number(amount) || 0

        const { data: vp, error: vError } = await supabase
          .from('vendor_payments')
          .insert({
            voucher_no: voucherNo,
            date: todayStr,
            vendor_id: party.id,
            amount: numAmount,
            payment_method: payment_method || 'cash',
            notes: notes || 'Vendor payment recorded via AI Assistant'
          })
          .select('id, voucher_no, amount, date')
          .single()

        if (vError) throw new Error(vError.message)

        // Update party balance
        const updatedBal = Math.max(0, (party.current_balance || 0) - numAmount)
        await supabase
          .from('parties')
          .update({ current_balance: updatedBal })
          .eq('id', party.id)

        revalidatePath('/daybook')
        revalidatePath('/purchases')
        revalidatePath('/parties')
        revalidatePath('/ledgers')
        revalidatePath('/dashboard')

        return {
          action: 'RECORD_VENDOR_PAYMENT',
          details: `Recorded vendor payment ${voucherNo} of Rs ${numAmount.toLocaleString()} to ${party.name} (${payment_method}). Remaining payable balance: Rs ${updatedBal.toLocaleString()}.`,
          success: true,
          data: {
            voucher_no: voucherNo,
            vendor: party.name,
            amount: numAmount,
            remaining_balance: updatedBal
          }
        }
      }

      // ==================== 2. INVENTORY & STOCK ====================
      case 'query_stock_inventory': {
        let productsQuery = supabase
          .from('products')
          .select('id, code, name, category, default_unit, min_stock, is_active')
          .eq('is_active', true)

        if (args.category && args.category !== 'all' && args.category !== 'low_stock') {
          productsQuery = productsQuery.eq('category', args.category)
        }
        if (args.product_name) {
          productsQuery = productsQuery.ilike('name', `%${args.product_name.trim()}%`)
        }

        const { data: products, error } = await productsQuery
        if (error) throw new Error(error.message)

        // Query current stock levels from stock_ledger running balances
        const { data: stockRows } = await supabase
          .from('stock_ledger')
          .select('product_id, inward_qty, outward_qty, godown:godowns(name)')

        // Calculate balances per product
        const balanceMap: Record<string, number> = {}
        for (const row of stockRows || []) {
          const pid = row.product_id
          const qty = (Number(row.inward_qty) || 0) - (Number(row.outward_qty) || 0)
          balanceMap[pid] = (balanceMap[pid] || 0) + qty
        }

        let items = (products || []).map(p => ({
          name: p.name,
          code: p.code,
          category: p.category,
          unit: p.default_unit,
          current_stock: balanceMap[p.id] || 0,
          min_stock: p.min_stock || 0,
          is_low: (balanceMap[p.id] || 0) <= (p.min_stock || 0)
        }))

        if (args.category === 'low_stock') {
          items = items.filter(i => i.is_low)
        }

        return {
          action: 'QUERY_STOCK_INVENTORY',
          details: `Audited ${items.length} products. Low stock alerts: ${items.filter(i => i.is_low).length} item(s).`,
          success: true,
          data: {
            total_products: items.length,
            low_stock_count: items.filter(i => i.is_low).length,
            items: items.slice(0, 15)
          }
        }
      }

      case 'query_godowns': {
        const { data: godowns, error } = await supabase
          .from('godowns')
          .select('id, code, name, capacity_metric_tons, address, is_active')
          .order('name')

        if (error) throw new Error(error.message)

        return {
          action: 'QUERY_GODOWNS',
          details: `Found ${godowns?.length || 0} godowns/warehouses in system.`,
          success: true,
          data: godowns
        }
      }

      case 'record_stock_adjustment': {
        const { product_name, godown_name, quantity, direction, reason } = args
        const todayStr = new Date().toISOString().slice(0, 10)

        const { data: product } = await supabase
          .from('products')
          .select('id, name, default_unit')
          .ilike('name', `%${product_name.trim()}%`)
          .limit(1)
          .single()

        if (!product) throw new Error(`Product "${product_name}" not found.`)

        const { data: godown } = await supabase
          .from('godowns')
          .select('id, name')
          .ilike('name', `%${godown_name.trim()}%`)
          .limit(1)
          .single()

        if (!godown) throw new Error(`Godown "${godown_name}" not found.`)

        const numQty = Number(quantity) || 0
        const inwardQty = direction === 'inward' ? numQty : 0
        const outwardQty = direction === 'outward' ? numQty : 0
        const voucherNo = `ADJ-${Date.now().toString().slice(-6)}`

        const { error: sError } = await supabase
          .from('stock_ledger')
          .insert({
            date: todayStr,
            voucher_type: 'adjustment',
            voucher_id: '00000000-0000-0000-0000-000000000000',
            voucher_no: voucherNo,
            godown_id: godown.id,
            product_id: product.id,
            inward_qty: inwardQty,
            outward_qty: outwardQty,
            unit: product.default_unit || 'kg',
            running_balance: numQty,
            notes: `AI Adjustment: ${reason}`
          })

        if (sError) throw new Error(sError.message)

        revalidatePath('/inventory')
        revalidatePath('/dashboard')

        return {
          action: 'RECORD_STOCK_ADJUSTMENT',
          details: `Adjusted ${direction.toUpperCase()} ${numQty} ${product.default_unit} of ${product.name} in ${godown.name} (${reason}).`,
          success: true,
          data: { voucher_no: voucherNo, product: product.name, godown: godown.name, quantity: numQty, direction }
        }
      }

      // ==================== 3. INWARD GOODS & PURCHASES ====================
      case 'query_inward_goods': {
        const limit = args.limit || 10
        let query = supabase
          .from('inward_goods')
          .select('id, voucher_no, date, party:parties!inward_goods_party_id_fkey(name), godown:godowns(name), bilty_no, vehicle_no, driver_name, total_bags, total_net_weight_kg, status')
          .order('date', { ascending: false })
          .limit(limit)

        if (args.status && args.status !== 'all') {
          query = query.eq('status', args.status)
        }

        const { data: inward, error } = await query
        if (error) throw new Error(error.message)

        return {
          action: 'QUERY_INWARD_GOODS',
          details: `Retrieved ${inward?.length || 0} inward goods vouchers.`,
          success: true,
          data: (inward || []).map((i: any) => ({
            voucher_no: i.voucher_no,
            date: i.date,
            supplier: i.party?.name || 'Supplier',
            godown: i.godown?.name || 'Godown',
            vehicle: i.vehicle_no || 'N/A',
            bilty: i.bilty_no || 'N/A',
            bags: i.total_bags,
            net_weight_kg: i.total_net_weight_kg,
            status: i.status
          }))
        }
      }

      case 'query_purchases': {
        let query = supabase
          .from('purchases')
          .select('id, purchase_no, date, vendor:parties!purchases_vendor_id_fkey(name), total_amount, paid_amount, balance_amount, status')
          .order('date', { ascending: false })
          .limit(15)

        if (args.unpaid_only) {
          query = query.gt('balance_amount', 0)
        }

        const { data: purchases, error } = await query
        if (error) throw new Error(error.message)

        const totalUnpaid = (purchases || []).reduce((sum, p) => sum + (Number(p.balance_amount) || 0), 0)

        return {
          action: 'QUERY_PURCHASES',
          details: `Retrieved ${purchases?.length || 0} purchase vouchers. Total unpaid vendor balance: Rs ${totalUnpaid.toLocaleString()}.`,
          success: true,
          data: {
            total_unpaid: totalUnpaid,
            purchases: (purchases || []).map((p: any) => ({
              purchase_no: p.purchase_no,
              date: p.date,
              vendor: p.vendor?.name || 'Vendor',
              total: p.total_amount,
              paid: p.paid_amount,
              balance: p.balance_amount,
              status: p.status
            }))
          }
        }
      }

      // ==================== 4. PRODUCTION, RECIPES & MACHINERY ====================
      case 'query_production_summary': {
        const limit = args.limit || 10
        let query = supabase
          .from('production_batches')
          .select('id, batch_no, date, machine:machines(name), planned_size_kg, actual_input_kg, actual_output_kg, byproduct_kg, waste_kg, yield_pct, status')
          .order('date', { ascending: false })
          .limit(limit)

        if (args.status && args.status !== 'all') {
          query = query.eq('status', args.status)
        }

        const { data: batches, error } = await query
        if (error) throw new Error(error.message)

        const totalInput = (batches || []).reduce((sum, b) => sum + (Number(b.actual_input_kg) || 0), 0)
        const totalOutput = (batches || []).reduce((sum, b) => sum + (Number(b.actual_output_kg) || 0), 0)
        const avgYield = totalInput > 0 ? ((totalOutput / totalInput) * 100).toFixed(1) : '0'

        return {
          action: 'QUERY_PRODUCTION_SUMMARY',
          details: `Production Summary: ${batches?.length || 0} batches processed. Total Input: ${totalInput.toLocaleString()} kg, Total Output: ${totalOutput.toLocaleString()} kg, Average Yield: ${avgYield}%.`,
          success: true,
          data: {
            batches_count: batches?.length || 0,
            total_input_kg: totalInput,
            total_output_kg: totalOutput,
            average_yield_pct: avgYield,
            batches: (batches || []).map((b: any) => ({
              batch_no: b.batch_no,
              date: b.date,
              machine: b.machine?.name || 'Machine',
              input_kg: b.actual_input_kg,
              output_kg: b.actual_output_kg,
              waste_kg: b.waste_kg,
              yield_pct: b.yield_pct,
              status: b.status
            }))
          }
        }
      }

      case 'query_machinery_jobs': {
        const limit = args.limit || 10
        let query = supabase
          .from('machinery_jobs')
          .select('id, job_no, date, customer:parties!machinery_jobs_customer_id_fkey(name), machine:machines(name), processing_type, input_weight_kg, output_weight_kg, service_charge, rate_basis, rate, status, payment_status')
          .order('date', { ascending: false })
          .limit(limit)

        if (args.payment_status && args.payment_status !== 'all') {
          query = query.eq('payment_status', args.payment_status)
        }

        const { data: jobs, error } = await query
        if (error) throw new Error(error.message)

        const totalCharges = (jobs || []).reduce((sum, j) => sum + (Number(j.service_charge) || 0), 0)

        return {
          action: 'QUERY_MACHINERY_JOBS',
          details: `Machinery Jobs: Retrieved ${jobs?.length || 0} jobs. Total Service Charges: Rs ${totalCharges.toLocaleString()}.`,
          success: true,
          data: {
            total_jobs: jobs?.length || 0,
            total_charges: totalCharges,
            jobs: (jobs || []).map((j: any) => ({
              job_no: j.job_no,
              date: j.date,
              customer: j.customer?.name || 'Customer',
              machine: j.machine?.name || 'Machine',
              type: j.processing_type,
              input_kg: j.input_weight_kg,
              output_kg: j.output_weight_kg,
              charge: j.service_charge,
              billing_status: j.payment_status,
              status: j.status
            }))
          }
        }
      }

      case 'query_packing_records': {
        const limit = args.limit || 10
        const { data: packing, error } = await supabase
          .from('packing_records')
          .select('id, packing_no, date, bags_packed, total_packed_kg, packing_charge, damaged_bags, status')
          .order('date', { ascending: false })
          .limit(limit)

        if (error) throw new Error(error.message)

        return {
          action: 'QUERY_PACKING_RECORDS',
          details: `Retrieved ${packing?.length || 0} packing records.`,
          success: true,
          data: packing
        }
      }

      // ==================== 5. GATE PASSES ====================
      case 'query_gate_passes': {
        const limit = args.limit || 10
        let query = supabase
          .from('gate_passes')
          .select('id, pass_no, date, customer:parties!gate_passes_customer_id_fkey(name), godown:godowns(name), vehicle_no, driver_name, destination, total_bags, total_weight_kg, status')
          .order('date', { ascending: false })
          .limit(limit)

        if (args.status && args.status !== 'all') {
          query = query.eq('status', args.status)
        }

        const { data: passes, error } = await query
        if (error) throw new Error(error.message)

        return {
          action: 'QUERY_GATE_PASSES',
          details: `Retrieved ${passes?.length || 0} gate passes.`,
          success: true,
          data: (passes || []).map((p: any) => ({
            pass_no: p.pass_no,
            date: p.date,
            customer: p.customer?.name || 'Customer',
            vehicle: p.vehicle_no,
            driver: p.driver_name,
            destination: p.destination || 'N/A',
            bags: p.total_bags,
            weight_kg: p.total_weight_kg,
            status: p.status
          }))
        }
      }

      // ==================== 6. EMPLOYEES, ATTENDANCE & PAYROLL ====================
      case 'query_employees_and_attendance': {
        const todayStr = args.date || new Date().toISOString().slice(0, 10)

        const { data: employees, error: eErr } = await supabase
          .from('employees')
          .select('id, code, full_name, designation, pay_type, base_rate, is_active')
          .eq('is_active', true)
          .order('full_name')

        if (eErr) throw new Error(eErr.message)

        const { data: attendance, error: aErr } = await supabase
          .from('attendance')
          .select('employee_id, status, overtime_hours, notes')
          .eq('date', todayStr)

        if (aErr) throw new Error(aErr.message)

        const attMap = new Map((attendance || []).map(a => [a.employee_id, a]))

        let roster = (employees || []).map(emp => {
          const log = attMap.get(emp.id)
          return {
            id: emp.id,
            name: emp.full_name,
            designation: emp.designation,
            pay_type: emp.pay_type,
            status: log ? log.status : 'not_marked',
            overtime: log?.overtime_hours || 0
          }
        })

        if (args.filter_status && args.filter_status !== 'all') {
          roster = roster.filter(r => r.status === args.filter_status)
        }

        const presentCount = roster.filter(r => r.status === 'present').length
        const absentCount = roster.filter(r => r.status === 'absent').length

        return {
          action: 'QUERY_EMPLOYEES_AND_ATTENDANCE',
          details: `Attendance for ${todayStr}: Total Employees: ${employees?.length || 0}, Present: ${presentCount}, Absent: ${absentCount}.`,
          success: true,
          data: {
            date: todayStr,
            total_active: employees?.length || 0,
            present_count: presentCount,
            absent_count: absentCount,
            roster
          }
        }
      }

      case 'record_daily_attendance': {
        const { employee_name, status, overtime_hours, date, notes } = args
        const todayStr = date || new Date().toISOString().slice(0, 10)

        const { data: emp, error: eErr } = await supabase
          .from('employees')
          .select('id, full_name')
          .ilike('full_name', `%${employee_name.trim()}%`)
          .limit(1)
          .single()

        if (eErr || !emp) throw new Error(`Employee "${employee_name}" not found.`)

        // Upsert attendance
        const { data: existing } = await supabase
          .from('attendance')
          .select('id')
          .eq('employee_id', emp.id)
          .eq('date', todayStr)
          .maybeSingle()

        if (existing) {
          await supabase
            .from('attendance')
            .update({
              status,
              overtime_hours: Number(overtime_hours) || 0,
              notes: notes || null
            })
            .eq('id', existing.id)
        } else {
          await supabase
            .from('attendance')
            .insert({
              date: todayStr,
              employee_id: emp.id,
              status,
              overtime_hours: Number(overtime_hours) || 0,
              notes: notes || null
            })
        }

        revalidatePath('/employees')

        return {
          action: 'RECORD_DAILY_ATTENDANCE',
          details: `Marked ${emp.full_name} as "${status.toUpperCase()}" for ${todayStr}.`,
          success: true,
          data: { employee: emp.full_name, date: todayStr, status }
        }
      }

      case 'mark_bulk_attendance': {
        const { present_employee_names = [], absent_employee_names = [], default_status_for_others = 'absent', date } = args
        const todayStr = date || new Date().toISOString().slice(0, 10)

        const { data: allEmployees } = await supabase
          .from('employees')
          .select('id, full_name')
          .eq('is_active', true)

        if (!allEmployees?.length) throw new Error('No active employees found.')

        const presentLower = present_employee_names.map((n: string) => n.toLowerCase().trim())
        const absentLower = absent_employee_names.map((n: string) => n.toLowerCase().trim())

        let markedCount = 0

        for (const emp of allEmployees) {
          const empNameLower = emp.full_name.toLowerCase()
          let assignedStatus = default_status_for_others

          if (presentLower.some((p: string) => empNameLower.includes(p))) {
            assignedStatus = 'present'
          } else if (absentLower.some((a: string) => empNameLower.includes(a))) {
            assignedStatus = 'absent'
          }

          const { data: existing } = await supabase
            .from('attendance')
            .select('id')
            .eq('employee_id', emp.id)
            .eq('date', todayStr)
            .maybeSingle()

          if (existing) {
            await supabase
              .from('attendance')
              .update({ status: assignedStatus })
              .eq('id', existing.id)
          } else {
            await supabase
              .from('attendance')
              .insert({
                date: todayStr,
                employee_id: emp.id,
                status: assignedStatus
              })
          }
          markedCount++
        }

        revalidatePath('/employees')

        return {
          action: 'MARK_BULK_ATTENDANCE',
          details: `Bulk marked attendance for ${markedCount} staff members on ${todayStr} (Present: ${present_employee_names.length}, Default for others: ${default_status_for_others}).`,
          success: true,
          data: { date: todayStr, count: markedCount }
        }
      }

      case 'query_payroll_summary': {
        const now = new Date()
        const month = args.month || (now.getMonth() + 1)
        const year = args.year || now.getFullYear()

        const { data: payrolls } = await supabase
          .from('payrolls')
          .select('id, employee:employees(full_name), net_salary, status')
          .eq('month', month)
          .eq('year', year)

        const { data: advances } = await supabase
          .from('advances')
          .select('id, employee:employees(full_name), amount, status')
          .eq('status', 'approved')

        const totalPayroll = (payrolls || []).reduce((sum, p) => sum + (Number(p.net_salary) || 0), 0)
        const unpaidSalaries = (payrolls || []).filter(p => p.status !== 'paid').reduce((sum, p) => sum + (Number(p.net_salary) || 0), 0)
        const totalAdvances = (advances || []).reduce((sum, a) => sum + (Number(a.amount) || 0), 0)

        return {
          action: 'QUERY_PAYROLL_SUMMARY',
          details: `Payroll (${month}/${year}): Total Net: Rs ${totalPayroll.toLocaleString()}, Unpaid Salaries: Rs ${unpaidSalaries.toLocaleString()}, Active Advance Loans: Rs ${totalAdvances.toLocaleString()}.`,
          success: true,
          data: {
            month,
            year,
            total_net_payroll: totalPayroll,
            unpaid_salaries: unpaidSalaries,
            active_advances: totalAdvances,
            payrolls_count: payrolls?.length || 0
          }
        }
      }

      // ==================== 7. MASTERS CREATION ====================
      case 'create_party': {
        const { name, type, phone, address, opening_balance = 0, balance_type = 'receivable' } = args
        const code = `P-${Date.now().toString().slice(-5)}`

        const { data: newParty, error } = await supabase
          .from('parties')
          .insert({
            code,
            name: name.trim(),
            type,
            phone: phone || null,
            address: address || null,
            opening_balance: Number(opening_balance) || 0,
            current_balance: Number(opening_balance) || 0,
            balance_type,
            is_active: true
          })
          .select('id, code, name, type, current_balance')
          .single()

        if (error) throw new Error(error.message)

        revalidatePath('/parties')
        revalidatePath('/masters')

        return {
          action: 'CREATE_PARTY',
          details: `Created new ${type} party "${newParty.name}" (Code: ${newParty.code}) with initial balance of Rs ${Number(opening_balance).toLocaleString()}.`,
          success: true,
          data: newParty
        }
      }

      case 'create_product': {
        const { name, code, category, default_unit = 'kg', min_stock = 0 } = args
        const prodCode = code || `PRD-${Date.now().toString().slice(-5)}`

        const { data: newProd, error } = await supabase
          .from('products')
          .insert({
            code: prodCode,
            name: name.trim(),
            category,
            default_unit,
            min_stock: Number(min_stock) || 0,
            is_active: true
          })
          .select('id, code, name, category, default_unit')
          .single()

        if (error) throw new Error(error.message)

        revalidatePath('/inventory')
        revalidatePath('/masters')

        return {
          action: 'CREATE_PRODUCT',
          details: `Added new product "${newProd.name}" (${newProd.code}) under category "${category}" with unit "${default_unit}".`,
          success: true,
          data: newProd
        }
      }

      default:
        throw new Error(`Unknown tool "${toolName}"`)
    }
  } catch (err: any) {
    console.error(`Tool execution failed for ${toolName}:`, err)
    return {
      action: toolName.toUpperCase(),
      details: err?.message || 'Tool execution encountered an error.',
      success: false
    }
  }
}
