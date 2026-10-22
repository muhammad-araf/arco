"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"

/**
 * Server Actions for Seed Godown & Processing System (ARCO)
 */

export async function fetchStockSummaryAction() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("products")
      .select("*, stock_ledger(inward_qty, outward_qty)")
      .eq("is_active", true)

    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true, data }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function postInwardVoucherAction(formData: FormData) {
  try {
    const supabase = await createClient()
    const voucherNo = formData.get("voucher_no") as string
    const partyId = formData.get("party_id") as string
    const godownId = formData.get("godown_id") as string
    const biltyNo = formData.get("bilty_no") as string
    const vehicleNo = formData.get("vehicle_no") as string
    const totalBags = Number(formData.get("total_bags"))
    const totalWeight = Number(formData.get("total_weight"))

    const { data: voucher, error: vError } = await supabase
      .from("incoming_goods")
      .insert({
        voucher_no: voucherNo,
        party_id: partyId,
        godown_id: godownId,
        bilty_no: biltyNo,
        vehicle_no: vehicleNo,
        total_bags: totalBags,
        total_net_weight_kg: totalWeight,
        status: "posted",
      })
      .select()
      .single()

    if (vError) {
      return { success: false, error: vError.message }
    }

    revalidatePath("/inward")
    revalidatePath("/inventory")
    revalidatePath("/dashboard")
    return { success: true, data: voucher }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function postGatePassAction(formData: FormData) {
  try {
    const supabase = await createClient()
    const passNo = formData.get("pass_no") as string
    const customerId = formData.get("customer_id") as string
    const godownId = formData.get("godown_id") as string
    const vehicleNo = formData.get("vehicle_no") as string
    const driverName = formData.get("driver_name") as string
    const totalBags = Number(formData.get("total_bags"))
    const totalWeight = Number(formData.get("total_weight"))

    const { data: pass, error: pError } = await supabase
      .from("gate_passes")
      .insert({
        pass_no: passNo,
        customer_id: customerId,
        godown_id: godownId,
        vehicle_no: vehicleNo,
        driver_name: driverName,
        total_bags: totalBags,
        total_weight_kg: totalWeight,
        status: "posted",
      })
      .select()
      .single()

    if (pError) {
      return { success: false, error: pError.message }
    }

    revalidatePath("/gatepass")
    revalidatePath("/inventory")
    revalidatePath("/dashboard")
    return { success: true, data: pass }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function recordExpenseAction(formData: FormData) {
  try {
    const supabase = await createClient()
    const categoryName = formData.get("category_name") as string
    const payee = formData.get("payee") as string
    const amount = Number(formData.get("amount"))
    const paymentMethod = formData.get("payment_method") as string
    const description = formData.get("description") as string

    const { data: exp, error } = await supabase
      .from("expenses")
      .insert({
        expense_no: `EXP-2026-${Date.now().toString().slice(-4)}`,
        category_name: categoryName,
        payee,
        amount,
        payment_method: paymentMethod,
        description,
        status: "posted",
      })
      .select()
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    revalidatePath("/daybook")
    revalidatePath("/dashboard")
    return { success: true, data: exp }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
