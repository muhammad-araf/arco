"use client"

/**
 * Gate pass create dialog on the shared Modal kit (POS pattern: the
 * dialog owns its form state; the page keeps only the register).
 *
 * Moved verbatim from the Gate Pass page's hand-rolled creator modal:
 * same fields, same validation (including the stock guard), same
 * createGatePassDraft / postGatePass payloads, same draft → confirm →
 * print flow. The only intentional changes are the ones the shared kit
 * requires: the form resets on a fresh open (it used to keep typed
 * values across closes), and errors show in the dialog's own banner.
 */
import * as React from "react"
import { Plus, CheckCircle2, Trash2 } from "lucide-react"
import { postToken } from "@/lib/idempotency"
import { createGatePassDraft, postGatePass, getGatePass } from "@/app/actions/gatepass"
import { listGodowns, listProducts, listParties, listPackagingTypes, createParty, createGodown, createProduct, createPackagingType } from "@/app/actions/masters"
import { InlineAdd, PARTY_FIELDS, GODOWN_FIELDS, PRODUCT_FIELDS, PACKAGING_FIELDS } from "@/components/print/inline-add"
import { AttachmentFields } from "@/components/attachment-fields"
import type { GatePassItem, Godown, Product, Party } from "@/lib/types/database"
import { formatWeight, formatBags } from "@/lib/utils"
import { kgPerBag } from "@/lib/dialog-calcs"
import { AlertBanner, ConfirmDialog, SubmitSpinner, isPositive } from "@/components/erp-ui"
import { Modal, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/erp-form"

type GatePassRow = {
  id: string
  pass_no: string
  date: string
  customer_id: string
  customer_name?: string
  destination?: string
  receiver_name?: string
  receiver_contact?: string
  dispatch_mode?: string
  godown_id: string
  godown_name?: string
  vehicle_no: string
  driver_name: string
  driver_phone?: string
  transporter?: string
  order_ref?: string
  status: string
  total_bags: number
  total_weight_kg: number
  notes?: string
  items: GatePassItem[]
  created_at: string
  dispatched_at: string
}

export function GatePassDialog({
  open,
  onClose,
  godowns,
  products,
  customers,
  owners,
  packagingTypes,
  summaryRows,
  approvalRequired,
  setGodowns,
  setProducts,
  setCustomers,
  setOwners,
  setPackagingTypes,
  onSaved,
  onPrinted,
}: {
  open: boolean
  onClose: () => void
  godowns: Godown[]
  products: Product[]
  customers: Party[]
  owners: Party[]
  packagingTypes: any[]
  summaryRows: any[]
  approvalRequired: boolean
  setGodowns: (g: Godown[]) => void
  setProducts: (p: Product[]) => void
  setCustomers: (p: Party[]) => void
  setOwners: (p: Party[]) => void
  setPackagingTypes: (p: any[]) => void
  /** Page sets the notice banner and reloads the register. */
  onSaved: (notice: string) => Promise<void> | void
  /** Page shows the print viewer for this posted pass. */
  onPrinted: (v: any) => void
}) {
  const [customerId, setCustomerId] = React.useState("")
  const [godownId, setGodownId] = React.useState("")
  const [destination, setDestination] = React.useState("")
  const [receiverName, setReceiverName] = React.useState("")
  const [receiverContact, setReceiverContact] = React.useState("")
  const [attachmentUrl, setAttachmentUrl] = React.useState("")
  const [attachmentNote, setAttachmentNote] = React.useState("")
  const [dispatchMode, setDispatchMode] = React.useState("")
  const [vehicleNo, setVehicleNo] = React.useState("")
  const [driverName, setDriverName] = React.useState("")
  const [driverPhone, setDriverPhone] = React.useState("")
  const [transporter, setTransporter] = React.useState("")
  const [orderRef, setOrderRef] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [items, setItems] = React.useState<{
    productId: string
    bags: number
    netWeight: number
    remarks: string
    ownerId: string
    packagingTypeId: string
  }[]>([{ productId: "", bags: 0, netWeight: 0, remarks: "", ownerId: "", packagingTypeId: "" }])
  const [error, setError] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showPostConfirm, setShowPostConfirm] = React.useState(false)
  const [draftPass, setDraftPass] = React.useState<GatePassRow | null>(null)
  const postGuard = React.useRef(false)

  React.useEffect(() => {
    if (!open) return
    const finishedProds = products.filter((p) => p.category === "finished_seed" || p.category === "by_product")
    setCustomerId(customers[0]?.id ?? "")
    setGodownId(godowns[0]?.id ?? "")
    setDestination("")
    setReceiverName("")
    setReceiverContact("")
    setAttachmentUrl("")
    setAttachmentNote("")
    setDispatchMode("")
    setVehicleNo("")
    setDriverName("")
    setDriverPhone("")
    setTransporter("")
    setOrderRef("")
    setNotes("")
    setItems([{ productId: finishedProds[0]?.id ?? "", bags: 0, netWeight: 0, remarks: "", ownerId: "", packagingTypeId: "" }])
    setError("")
    setIsPending(false)
    setShowPostConfirm(false)
    setDraftPass(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ])

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { productId: products[0]?.id || "", bags: 0, netWeight: 0, remarks: "", ownerId: "", packagingTypeId: "" },
    ])
  }

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleItemChange = (index: number, field: string, value: any) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
  }

  const totalBags = items.reduce((sum, i) => sum + (Number(i.bags) || 0), 0)
  const totalWeight = items.reduce((sum, i) => sum + (Number(i.netWeight) || 0), 0)

  const draftPayload = () => ({
    customerId,
    godownId,
    vehicleNo: vehicleNo.trim(),
    driverName: driverName.trim(),
    driverPhone: driverPhone || undefined,
    transporter: transporter || undefined,
    destination: destination.trim() || undefined,
    orderRef: orderRef || undefined,
    notes: notes || undefined,
    receiverName: receiverName.trim() || undefined,
    receiverContact: receiverContact.trim() || undefined,
    dispatchMode: dispatchMode || undefined,
    attachmentUrl: attachmentUrl || undefined,
    attachmentNote: attachmentNote || undefined,
    items: items.map((it) => ({
      productId: it.productId,
      bags: Number(it.bags),
      netWeightKg: Number(it.netWeight),
      remarks: it.remarks,
      partyId: it.ownerId || undefined,
      packagingTypeId: it.packagingTypeId || undefined,
    })),
  })

  const handleIssueGatePass = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    if (!customerId) return setError("Select the customer / receiver before issuing a gate pass.")
    if (!godownId) return setError("Select the dispatch godown so stock is deducted from the right place.")
    if (!vehicleNo.trim()) return setError("Vehicle number is required on a gate pass.")
    if (!driverName.trim()) return setError("Driver name is required on a gate pass.")
    if (!destination.trim()) return setError("Destination is required so the pass states where the goods are going.")
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item.productId) return setError(`Line ${i + 1}: select a product.`)
      if (!isPositive(Number(item.bags))) return setError(`Line ${i + 1}: bags must be greater than zero.`)
      if (!isPositive(Number(item.netWeight))) return setError(`Line ${i + 1}: net weight must be greater than zero.`)
      const ownerRow = summaryRows.find((r) => r.product_id === item.productId && r.godown_id === godownId && (r.party_id ?? null) === (item.ownerId || null))
      const available = Number(ownerRow?.balance_kg) || 0
      if (item.netWeight > available) {
        const prod = products.find((p) => p.id === item.productId)
        return setError(`Insufficient stock for ${prod?.name || "Product"}: ${available} kg available in this godown, but ${item.netWeight} kg requested. Reduce the quantity or pick another godown.`)
      }
    }
    setError("")
    const selectedCust = customers.find((c) => c.id === customerId)
    const selectedGodown = godowns.find((g) => g.id === godownId)
    const gatePassItems: GatePassItem[] = items.map((item, idx) => {
      const prod = products.find((p) => p.id === item.productId)
      return {
        id: `gpi-${Date.now()}-${idx}`,
        gate_pass_id: `gp-${Date.now()}`,
        product_id: item.productId,
        product_name: prod?.name || "Seed",
        bags_count: Number(item.bags),
        net_weight_kg: Number(item.netWeight),
        gross_weight_kg: Number(item.netWeight),
        remarks: item.remarks,
      }
    })
    setDraftPass({
      id: `gp-${Date.now()}`,
      pass_no: "",
      date: new Date().toISOString(),
      customer_id: customerId,
      customer_name: selectedCust?.name,
      destination: destination || undefined,
      receiver_name: receiverName || undefined,
      receiver_contact: receiverContact || undefined,
      dispatch_mode: dispatchMode || undefined,
      godown_id: godownId,
      godown_name: selectedGodown?.name,
      vehicle_no: vehicleNo,
      driver_name: driverName,
      driver_phone: driverPhone || undefined,
      transporter: transporter || undefined,
      order_ref: orderRef || undefined,
      status: "posted",
      total_bags: totalBags,
      total_weight_kg: totalWeight,
      notes: notes || undefined,
      items: gatePassItems,
      created_at: new Date().toISOString(),
      dispatched_at: new Date().toISOString(),
    })
    setShowPostConfirm(true)
  }

  const handleSaveDraft = async () => {
    if (isPending) return
    if (!customerId) return setError("Select the customer / receiver before saving a draft.")
    if (!godownId) return setError("Select the dispatch godown before saving a draft.")
    if (!vehicleNo.trim()) return setError("Vehicle number is required before saving a draft.")
    if (!driverName.trim()) return setError("Driver name is required before saving a draft.")
    for (let i = 0; i < items.length; i++) {
      if (!items[i].productId) return setError(`Line ${i + 1}: select a product before saving a draft.`)
      if (!isPositive(Number(items[i].netWeight))) return setError(`Line ${i + 1}: net weight must be greater than zero before saving a draft.`)
    }
    setError("")
    setIsPending(true)
    try {
      const created = await createGatePassDraft(draftPayload())
      if (!created.success || !(created.data as any)?.id) {
        setError(created.error ?? "Could not save the gate pass draft.")
        return
      }
      await onSaved(`${(created.data as any).pass_no ?? "Gate pass"} saved as a draft — nothing has been deducted yet. Post it from the register when ready.`)
      onClose()
    } finally {
      setIsPending(false)
    }
  }

  const handleConfirmPost = async () => {
    if (!draftPass || postGuard.current) return
    postGuard.current = true
    setIsPending(true)
    try {
      const created = await createGatePassDraft(draftPayload())
      if (!created.success || !(created.data as any)?.id) {
        // Close the confirm so the error is visible in the form banner
        // (it would otherwise sit behind the confirm overlay).
        setShowPostConfirm(false)
        setError(created.error ?? "Could not create the gate pass draft.")
        return
      }
      const duplicateWarning = (created.data as any)?.duplicateOrderRefWarning as string | undefined
      const posted = await postGatePass((created.data as any).id, postToken("gatepass:post", (created.data as any).id))
      if (!posted.success) {
        setShowPostConfirm(false)
        setError(posted.error ?? "Could not post the gate pass.")
        return
      }
      const row: any = posted.data ?? created.data
      const notice =
        row.status === "awaiting_approval"
          ? `${row.pass_no} submitted for approval — stock will be deducted when it is approved.${duplicateWarning ? ` ${duplicateWarning}` : ""}`
          : `${row.pass_no} dispatched — ${formatWeight(row.total_weight_kg ?? draftPass.total_weight_kg)} deducted from ${draftPass.godown_name || "the godown"}.${duplicateWarning ? ` ${duplicateWarning}` : ""}`
      const fresh = await getGatePass((created.data as any).id)
      const serverRow: any = fresh.success ? fresh.data : row
      if (serverRow.status === "posted") {
        onPrinted({
          ...serverRow,
          customer_name: customers.find((x) => x.id === serverRow.customer_id)?.name ?? serverRow.customer_id,
          godown_name: godowns.find((x) => x.id === serverRow.godown_id)?.name ?? serverRow.godown_id,
          items: (serverRow.gate_pass_items ?? serverRow.items ?? []).map((it: any) => ({
            ...it,
            product_name: products.find((x) => x.id === it.product_id)?.name ?? "Not set",
          })),
        })
      }
      setShowPostConfirm(false)
      setDraftPass(null)
      await onSaved(notice)
      onClose()
    } finally {
      setIsPending(false)
      postGuard.current = false
    }
  }

  if (!open) return null
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        xl
        title="Issue Outward Gate Pass"
        description="Upon authorization, stock is deducted from the godown inventory and an official A4 pass is generated."
      >
        <form onSubmit={handleIssueGatePass} className="space-y-4 text-xs">
          <AlertBanner tone="error" message={error} onDismiss={() => setError("")} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="customer-consignee">Customer / Consignee *</label>
              <div className="flex flex-wrap items-start gap-2"><select id="customer-consignee" title={customers.find((c) => c.id === customerId)?.name ?? ""}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                required
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select> <InlineAdd label="Party" fields={PARTY_FIELDS} createAction={async (v) => createParty({ code: v.code, name: v.name, type: v.type || "customer" })} onCreated={async (id) => { const r = await listParties(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setCustomers(list.filter((x) => x.type === "customer" || x.type === "both")); } setCustomerId(id); }} /></div>
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="dispatch-godown">Dispatch Godown *</label>
              <div className="flex flex-wrap items-start gap-2"><select id="dispatch-godown" title={godowns.find((g) => g.id === godownId)?.name ?? ""}
                value={godownId}
                onChange={(e) => setGodownId(e.target.value)}
                className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                required
              >
                {godowns.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select> <InlineAdd label="Godown" fields={GODOWN_FIELDS} createAction={async (v) => createGodown({ code: v.code, name: v.name })} onCreated={async (id) => { const r = await listGodowns(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setGodowns(list); } setGodownId(id); }} /></div>
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="delivery-destination">Delivery Destination *</label>
              <input id="delivery-destination" type="text" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. Sahiwal Regional Depot" className={inputClass} />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="vehicle-truck-no">Vehicle / Truck No *</label>
              <input id="vehicle-truck-no" type="text" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="e.g. LES-4419" className={`${inputClass} font-mono font-bold`} required />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="driver-full-name">Driver Full Name *</label>
              <input id="driver-full-name" type="text" value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Driver name" className={inputClass} required />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="driver-mobile-number">Driver Mobile Number</label>
              <input id="driver-mobile-number" type="text" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} placeholder="0300-XXXXXXX" className={inputClass} />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="receiver-name">Receiver Name</label>
              <input id="receiver-name" type="text" value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder="Person receiving the goods" className={inputClass} />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="receiver-contact">Receiver Contact</label>
              <input id="receiver-contact" type="text" value={receiverContact} onChange={(e) => setReceiverContact(e.target.value)} placeholder="0300-XXXXXXX" className={inputClass} />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="dispatch-mode">Dispatch Mode</label>
              <select id="dispatch-mode" value={dispatchMode} onChange={(e) => setDispatchMode(e.target.value)} className={inputClass}>
                <option value="">Not specified</option>
                <option value="Own Vehicle">Own Vehicle</option>
                <option value="Hired Transporter">Hired Transporter</option>
                <option value="Courier">Courier</option>
                <option value="Self Pickup">Self Pickup</option>
              </select>
            </div>

            <AttachmentFields url={attachmentUrl} note={attachmentNote} onUrlChange={setAttachmentUrl} onNoteChange={setAttachmentNote} idPrefix="gatepass" />

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="transporter-name">Transporter</label>
              <input id="transporter-name" type="text" value={transporter} onChange={(e) => setTransporter(e.target.value)} placeholder="Transport company, if any" className={inputClass} />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="order-ref">Order Reference</label>
              <input id="order-ref" type="text" value={orderRef} onChange={(e) => setOrderRef(e.target.value)} placeholder="e.g. PO-1234 (a reuse only warns, never blocks)" className={inputClass} />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="gatepass-notes">Notes</label>
              <input id="gatepass-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the pass should note" className={inputClass} />
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground uppercase tracking-wider">Authorized Product Line Items</span>
              <button type="button" onClick={handleAddItem} className="text-xs text-primary hover:underline font-semibold flex items-center gap-1 cursor-pointer">
                <Plus className="h-3 w-3" />
                <span>Add Item</span>
              </button>
            </div>

            <div className="space-y-2">
              {items.map((item, idx) => {
                const ownerRow = item.productId ? summaryRows.find((r) => r.product_id === item.productId && r.godown_id === godownId && (r.party_id ?? null) === (item.ownerId || null)) : undefined
                const available = Number(ownerRow?.balance_kg) || 0
                return (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2.5 rounded-lg bg-muted border border-border text-xs items-start">
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`gatepass-item-product-${idx}`}>
                        Product * (Available: {formatWeight(available)})
                      </label>
                      <div className="flex flex-wrap items-start gap-2"><select id={`gatepass-item-product-${idx}`}
                        value={item.productId}
                        onChange={(e) => handleItemChange(idx, "productId", e.target.value)}
                        className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-background border border-border text-foreground"
                      >
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select> <InlineAdd label="Product" fields={PRODUCT_FIELDS} createAction={async (v) => createProduct({ code: v.code, name: v.name, category: v.category || "raw_seed" })} onCreated={async (id) => { const r = await listProducts(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setProducts(list); } handleItemChange(idx, "productId", id); }} /></div>
                    </div>

                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`bags-count-${idx}`}>Bags Count *</label>
                      <input id={`bags-count-${idx}`} type="number" value={item.bags} onChange={(e) => handleItemChange(idx, "bags", Number(e.target.value))} className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground font-mono" min="1" />
                    </div>

                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`net-wt-kg-${idx}`}>Net Wt (kg) *</label>
                      <input id={`net-wt-kg-${idx}`} type="number" value={item.netWeight} onChange={(e) => handleItemChange(idx, "netWeight", Number(e.target.value))} className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground font-mono" min="1" />
                    </div>

                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`stock-owner-${idx}`}>Stock owner</label>
                      <div className="flex flex-wrap items-start gap-2"><select id={`stock-owner-${idx}`}
                        value={item.ownerId}
                        onChange={(e) => handleItemChange(idx, "ownerId", e.target.value)}
                        className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-background border border-border text-foreground"
                      >
                        <option value="">Company stock</option>
                        {owners.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select> <InlineAdd label="Party" fields={PARTY_FIELDS} createAction={async (v) => createParty({ code: v.code, name: v.name, type: v.type || "customer" })} onCreated={async (id) => { const r = await listParties(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setOwners(list); } handleItemChange(idx, "ownerId", id); }} /></div>
                    </div>

                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`bag-type-${idx}`}>Bag type</label>
                      <div className="flex flex-wrap items-start gap-2"><select id={`bag-type-${idx}`}
                        value={item.packagingTypeId}
                        onChange={(e) => handleItemChange(idx, "packagingTypeId", e.target.value)}
                        className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-background border border-border text-foreground"
                      >
                        <option value="">No specific type</option>
                        {packagingTypes.map((t: any) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select> <InlineAdd label="Packaging" fields={PACKAGING_FIELDS} createAction={async (v) => createPackagingType({ code: v.code, name: v.name })} onCreated={async (id) => { const r = await listPackagingTypes(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setPackagingTypes(list); } handleItemChange(idx, "packagingTypeId", id); }} /></div>
                    </div>

                    <div className="sm:col-span-2 flex items-center gap-2">
                      <div className="flex-1">
                        <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`packaging-remarks-${idx}`}>Packaging Remarks</label>
                        <input id={`packaging-remarks-${idx}`} type="text" value={item.remarks} onChange={(e) => handleItemChange(idx, "remarks", e.target.value)} placeholder="e.g. 50kg PP Green Bags" className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground" />
                      </div>
                      {items.length > 1 && (
                        <button type="button" onClick={() => handleRemoveItem(idx)} className="mt-3.5 p-1 text-destructive hover:bg-destructive/10 rounded cursor-pointer">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="sm:col-span-2 text-[11px] text-muted-foreground">
                      Line {idx + 1}: <strong className="text-foreground">{formatWeight(Number(item.netWeight) || 0)}</strong>
                      {Number(item.bags) > 0 && (
                        <> — {kgPerBag(Number(item.netWeight) || 0, Number(item.bags)).toFixed(2)} kg per bag</>
                      )}
                      {available > 0 && <> — {formatWeight(available)} available in this godown</>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-between text-xs">
            <div>
              <span className="text-muted-foreground">Total Bags Cleared: </span>
              <strong className="text-foreground font-mono">{formatBags(totalBags)}</strong>
            </div>
            <div>
              <span className="text-muted-foreground">Total Dispatched Weight: </span>
              <strong className="text-blue-600 dark:text-blue-400 font-mono text-sm">{formatWeight(totalWeight)}</strong>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={secondaryButtonClass}>Cancel</button>
            <button type="button" onClick={() => void handleSaveDraft()} disabled={isPending} className="px-5 py-2 rounded-lg bg-card border border-border text-foreground text-xs font-bold cursor-pointer disabled:opacity-60">
              Save as draft
            </button>
            <button type="submit" disabled={isPending} className={primaryButtonClass}>
              {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
              <span>{isPending ? "Authorizing…" : "Authorize & Deduct Stock"}</span>
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={showPostConfirm}
        title="Authorize this gate pass?"
        description={draftPass ? (approvalRequired ? `Submitting will send ${draftPass.pass_no || "this pass"} for owner_admin approval — no stock moves until it is approved. A pass number is assigned on submission.` : `Posting will deduct ${formatWeight(draftPass.total_weight_kg)} (${formatBags(draftPass.total_bags)}) from ${draftPass.godown_name || "the dispatch godown"} for vehicle ${draftPass.vehicle_no}. A pass number is assigned on posting. A posted pass can only be changed by reversal.`) : ""}
        confirmLabel={approvalRequired ? "Submit for Approval" : "Authorize & Deduct Stock"}
        pending={isPending}
        onConfirm={handleConfirmPost}
        onCancel={() => { setShowPostConfirm(false); setDraftPass(null) }}
      />
    </>
  )
}
