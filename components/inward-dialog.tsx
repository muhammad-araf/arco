"use client"

/**
 * Inward create dialog on the shared Modal kit (POS pattern: the dialog
 * owns its form state; the page keeps only the register).
 *
 * Moved verbatim from the Inward page's hand-rolled creation modal:
 * same fields, same validation, same createInwardDraft / postInward
 * payloads, same draft → post-confirm → print flow. The only
 * intentional changes are the ones the shared kit requires: the form
 * resets on a fresh open (it used to keep typed values across closes),
 * and errors show in the dialog's own banner instead of the page banner.
 */
import * as React from "react"
import { Plus, CheckCircle2, Trash2 } from "lucide-react"
import { postToken } from "@/lib/idempotency"
import { createInwardDraft, postInward, getInward } from "@/app/actions/inward"
import { listGodowns, listProducts, listParties, createParty, createGodown, createProduct } from "@/app/actions/masters"
import { InlineAdd, PARTY_FIELDS, GODOWN_FIELDS, PRODUCT_FIELDS } from "@/components/print/inline-add"
import { AttachmentFields } from "@/components/attachment-fields"
import type { IncomingGoodsVoucher, IncomingGoodsItem, Godown, Product, Party } from "@/lib/types/database"
import { formatWeight, formatBags, formatCurrency } from "@/lib/utils"
import { AlertBanner, ConfirmDialog, SubmitSpinner, isPositive } from "@/components/erp-ui"
import { Modal, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/erp-form"

export function InwardDialog({
  open,
  onClose,
  godowns,
  products,
  parties,
  owners,
  employees,
  setGodowns,
  setProducts,
  setParties,
  setOwners,
  onSaved,
  onPrinted,
}: {
  open: boolean
  onClose: () => void
  godowns: Godown[]
  products: Product[]
  parties: Party[]
  owners: Party[]
  employees: { id: string; full_name: string }[]
  setGodowns: (g: Godown[]) => void
  setProducts: (p: Product[]) => void
  setParties: (p: Party[]) => void
  setOwners: (p: Party[]) => void
  /** Page sets the notice/warning banners and reloads the register. */
  onSaved: (notice: string, warning?: string) => Promise<void> | void
  /** Page shows the print viewer for this voucher. */
  onPrinted: (v: IncomingGoodsVoucher) => void
}) {
  const [partyId, setPartyId] = React.useState("")
  const [godownId, setGodownId] = React.useState("")
  const [ownerId, setOwnerId] = React.useState("")
  const [biltyNo, setBiltyNo] = React.useState("")
  const [vehicleNo, setVehicleNo] = React.useState("")
  const [driverName, setDriverName] = React.useState("")
  const [driverPhone, setDriverPhone] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [inwardDate, setInwardDate] = React.useState("")
  const [receivedBy, setReceivedBy] = React.useState("")
  const [byHand, setByHand] = React.useState(false)
  const [nature, setNature] = React.useState("")
  const [attachmentUrl, setAttachmentUrl] = React.useState("")
  const [attachmentNote, setAttachmentNote] = React.useState("")
  const [items, setItems] = React.useState<{
    productId: string
    bags: number
    grossWeight: number
    tareWeight: number
    rate: number
    lotNo: string
  }[]>([{ productId: "", bags: 0, grossWeight: 0, tareWeight: 0, rate: 0, lotNo: "" }])
  const [error, setError] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [isSavingDraft, setIsSavingDraft] = React.useState(false)
  const [showPostConfirm, setShowPostConfirm] = React.useState(false)
  const [draftVoucher, setDraftVoucher] = React.useState<IncomingGoodsVoucher | null>(null)
  const postGuard = React.useRef(false)

  // Fresh create resets everything (defaults from the current master
  // lists, receipt date = today), so a reopened dialog never shows a
  // previous half-filled voucher.
  React.useEffect(() => {
    if (!open) return
    setPartyId(parties[0]?.id ?? "")
    setGodownId(godowns[0]?.id ?? "")
    setOwnerId("")
    setBiltyNo("")
    setVehicleNo("")
    setDriverName("")
    setDriverPhone("")
    setNotes("")
    setInwardDate(new Date().toISOString().slice(0, 10))
    setReceivedBy("")
    setByHand(false)
    setNature("")
    setAttachmentUrl("")
    setAttachmentNote("")
    setItems([{ productId: products[0]?.id ?? "", bags: 0, grossWeight: 0, tareWeight: 0, rate: 0, lotNo: "" }])
    setError("")
    setIsPending(false)
    setIsSavingDraft(false)
    setShowPostConfirm(false)
    setDraftVoucher(null)
    // Lists are page state and are loaded before the dialog can open;
    // intentionally reset only on open, not on every list change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ])

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { productId: products[0]?.id || "", bags: 0, grossWeight: 0, tareWeight: 0, rate: 0, lotNo: "" },
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
  const totalNetWeight = items.reduce(
    (sum, i) => sum + Math.max(0, (Number(i.grossWeight) || 0) - (Number(i.tareWeight) || 0)),
    0,
  )
  const totalValue = items.reduce(
    (sum, i) =>
      sum +
      Math.max(0, (Number(i.grossWeight) || 0) - (Number(i.tareWeight) || 0)) * (Number(i.rate) || 0),
    0,
  )

  const validationIssues: string[] = []
  if (!partyId) validationIssues.push("Supplier / source")
  if (!godownId) validationIssues.push("Target godown")
  if (!inwardDate) validationIssues.push("Receipt date")
  if (totalBags <= 0) validationIssues.push("At least one product line with bags greater than zero")
  if (totalNetWeight <= 0) validationIssues.push("At least one product line with net weight greater than zero")
  const canPost = validationIssues.length === 0
  const selectedSupplierName = parties.find((x) => x.id === partyId)?.name ?? ""
  const selectedGodownName = godowns.find((x) => x.id === godownId)?.name ?? ""
  const selectedOwnerName = owners.find((x) => x.id === ownerId)?.name ?? ""

  const draftPayloadItems = () =>
    items.map((it) => ({
      productId: it.productId,
      bags: Number(it.bags),
      grossWeightKg: Number(it.grossWeight),
      tareWeightKg: Number(it.tareWeight),
      ratePerUnit: Number(it.rate),
      lotNo: it.lotNo || undefined,
    }))

  const draftPayload = () => ({
    partyId,
    godownId,
    date: inwardDate ? `${inwardDate}T00:00:00.000Z` : undefined,
    biltyNo: biltyNo || undefined,
    vehicleNo: vehicleNo || undefined,
    driverName: driverName || undefined,
    driverPhone: driverPhone || undefined,
    notes: notes || undefined,
    receivedBy: receivedBy || undefined,
    byHand,
    nature: nature || undefined,
    attachmentUrl: attachmentUrl || undefined,
    attachmentNote: attachmentNote || undefined,
    isCustomerOwned: ownerId ? true : false,
    ownerPartyId: ownerId || undefined,
    items: draftPayloadItems(),
  })

  const handleSaveDraft = async () => {
    if (isPending || isSavingDraft) return
    if (!partyId) return setError("Select a supplier / source before saving a draft. Add one in Masters if the list is empty.")
    if (!godownId) return setError("Select the target godown before saving a draft.")
    if (!inwardDate) return setError("Select the receipt date before saving a draft.")
    if (!items.some((it) => it.productId && Number(it.grossWeight) > 0))
      return setError("Add at least one product line with a product and a gross weight greater than zero before saving a draft.")
    setError("")
    setIsSavingDraft(true)
    try {
      const created = await createInwardDraft(draftPayload())
      if (!created.success || !(created.data as any)?.id) {
        setError(created.error ?? "Could not save the draft.")
        return
      }
      const row: any = created.data
      await onSaved(`${row.voucher_no ?? "Draft"} saved as draft — stock is unchanged until it is posted.`)
      onClose()
    } finally {
      setIsSavingDraft(false)
    }
  }

  const handleSubmitVoucher = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    if (!partyId) return setError("Select a supplier / source before posting. Add one in Masters if the list is empty.")
    if (!godownId) return setError("Select the target godown that will receive this stock.")
    if (!inwardDate) return setError("Select the receipt date before posting.")
    if (totalBags <= 0 || totalNetWeight <= 0)
      return setError("Cannot post an empty receipt: add at least one product line with bags and net weight greater than zero.")
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item.productId) return setError(`Line ${i + 1}: select a product.`)
      if (!isPositive(Number(item.bags))) return setError(`Line ${i + 1}: bags must be greater than zero.`)
      if (!isPositive(Number(item.grossWeight))) return setError(`Line ${i + 1}: gross weight must be greater than zero.`)
      if (Number(item.tareWeight) < 0) return setError(`Line ${i + 1}: tare weight cannot be negative.`)
      if (Number(item.tareWeight) >= Number(item.grossWeight))
        return setError(`Line ${i + 1}: tare weight must be less than gross weight, otherwise net weight is zero.`)
      if (Number(item.rate) < 0) return setError(`Line ${i + 1}: rate cannot be negative.`)
    }
    setError("")
    const selectedParty = parties.find((p) => p.id === partyId)
    const selectedGodown = godowns.find((g) => g.id === godownId)
    const voucherItems: IncomingGoodsItem[] = items.map((item, idx) => {
      const prod = products.find((p) => p.id === item.productId)
      const netWeight = Math.max(0, item.grossWeight - item.tareWeight)
      return {
        id: `inwi-${Date.now()}-${idx}`,
        incoming_id: `inw-${Date.now()}`,
        product_id: item.productId,
        product_name: prod?.name || "Seed Grain",
        bags_count: Number(item.bags),
        gross_weight_kg: Number(item.grossWeight),
        tare_weight_kg: Number(item.tareWeight),
        net_weight_kg: netWeight,
        rate_per_unit: Number(item.rate),
        total_value: netWeight * Number(item.rate),
      }
    })
    setDraftVoucher({
      id: `inw-${Date.now()}`,
      voucher_no: "",
      date: inwardDate ? `${inwardDate}T00:00:00.000Z` : new Date().toISOString(),
      party_id: partyId,
      party_name: selectedParty?.name,
      godown_id: godownId,
      godown_name: selectedGodown?.name,
      bilty_no: biltyNo || undefined,
      vehicle_no: vehicleNo || undefined,
      driver_name: driverName || undefined,
      driver_phone: driverPhone || undefined,
      status: "posted",
      total_bags: totalBags,
      total_net_weight_kg: totalNetWeight,
      total_value: totalValue,
      notes: notes || undefined,
      items: voucherItems,
      created_at: new Date().toISOString(),
      posted_at: new Date().toISOString(),
    })
    setShowPostConfirm(true)
  }

  const handleConfirmPost = async () => {
    if (!draftVoucher || postGuard.current) return
    postGuard.current = true
    setIsPending(true)
    try {
      const created = await createInwardDraft(draftPayload())
      if (!created.success || !(created.data as any)?.id) {
        // Close the confirm so the error is visible in the form banner
        // (it would otherwise sit behind the confirm overlay).
        setShowPostConfirm(false)
        setError(created.error ?? "Could not create the inward draft.")
        return
      }
      const posted = await postInward((created.data as any).id, postToken("inward:post", (created.data as any).id))
      if (!posted.success) {
        setShowPostConfirm(false)
        setError(posted.error ?? "Could not post the inward voucher.")
        return
      }
      const row: any = posted.data ?? created.data
      const warns = [(created.data as any)?.biltyWarning, (created.data as any)?.columnsWarning].filter(Boolean).join(" ")
      const notice = `${row.voucher_no} posted — ${formatWeight(row.total_net_weight_kg ?? draftVoucher.total_net_weight_kg)} added to ${draftVoucher.godown_name || "the godown"}.`
      const fresh = await getInward((created.data as any).id)
      const serverRow: any = fresh.success ? fresh.data : row
      onPrinted({
        ...serverRow,
        party_name: parties.find((x) => x.id === serverRow.party_id)?.name ?? serverRow.party_id,
        godown_name: godowns.find((x) => x.id === serverRow.godown_id)?.name ?? serverRow.godown_id,
        items: (serverRow.incoming_goods_items ?? serverRow.items ?? []).map((it: any) => ({
          ...it,
          product_name: products.find((x) => x.id === it.product_id)?.name ?? "Not set",
        })),
      })
      setShowPostConfirm(false)
      setDraftVoucher(null)
      await onSaved(notice, warns || undefined)
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
        title="New Receiving Voucher"
        description="A receipt only: posting increases godown stock. The vendor bill is created separately in Purchases."
      >
        <form onSubmit={handleSubmitVoucher} className="space-y-5 pt-1">
          <AlertBanner tone="error" message={error} onDismiss={() => setError("")} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="supplier-party">Supplier / Party *</label>
              <div className="flex flex-wrap items-start gap-2"><select id="supplier-party"
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                required
              >
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select> <InlineAdd label="Party" fields={PARTY_FIELDS} createAction={async (v) => createParty({ code: v.code, name: v.name, type: v.type || "supplier" })} onCreated={async (id) => { const r = await listParties(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setParties(list.filter((x) => x.type === "supplier" || x.type === "both" || x.type === "source")); } setPartyId(id); }} /></div>
              {selectedSupplierName && <p className="mt-1 break-words text-muted-foreground">Selected: {selectedSupplierName}</p>}
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="target-godown">Target Godown *</label>
              <div className="flex flex-wrap items-start gap-2"><select id="target-godown"
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
              {selectedGodownName && <p className="mt-1 break-words text-muted-foreground">Selected: {selectedGodownName}</p>}
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="stock-owner">Stock owner</label>
              <div className="flex flex-wrap items-start gap-2"><select id="stock-owner"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
              >
                <option value="">Company stock</option>
                {owners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select> <InlineAdd label="Party" fields={PARTY_FIELDS} createAction={async (v) => createParty({ code: v.code, name: v.name, type: v.type || "customer" })} onCreated={async (id) => { const r = await listParties(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setOwners(list); } setOwnerId(id); }} /></div>
              <p className="mt-1 break-words text-muted-foreground">{selectedOwnerName ? `Selected: ${selectedOwnerName}` : "Leave as Company stock unless the goods belong to a customer."}</p>
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="bilty-number">Bilty Number</label>
              <input id="bilty-number" type="text" value={biltyNo} onChange={(e) => setBiltyNo(e.target.value)} placeholder="e.g. BL-88412" className={inputClass} />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="truck-vehicle-no">Truck / Vehicle No</label>
              <input id="truck-vehicle-no" type="text" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="e.g. LES-9941" className={inputClass} />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="driver-name">Driver Name</label>
              <input id="driver-name" type="text" value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Driver name" className={inputClass} />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="driver-contact">Driver Contact</label>
              <input id="driver-contact" type="text" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} placeholder="0300-XXXXXXX" className={inputClass} />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="inward-date">Date *</label>
              <input id="inward-date" type="date" value={inwardDate} onChange={(e) => setInwardDate(e.target.value)} className={inputClass} required />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="received-by">Received by (staff)</label>
              {employees.length > 0 ? (
                <select id="received-by" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} className={inputClass}>
                  <option value="">Not recorded</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.full_name}>
                      {emp.full_name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="px-2.5 py-2 rounded-lg bg-muted border border-border text-muted-foreground">
                  No staff on record yet — add staff on the <a href="/employees" className="underline font-semibold text-foreground">Employees page</a>, then pick them here.
                </p>
              )}
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="nature">Nature (free text)</label>
              <input id="nature" type="text" value={nature} onChange={(e) => setNature(e.target.value)} placeholder="Receiving classification (free text)" className={inputClass} />
            </div>

            <div className="flex items-center gap-2 pt-5">
              <input id="by-hand" type="checkbox" checked={byHand} onChange={(e) => setByHand(e.target.checked)} className="h-4 w-4" />
              <label className="font-medium text-foreground" htmlFor="by-hand">Delivered by hand</label>
            </div>

            <div className="sm:col-span-2">
              <label className="block font-medium text-foreground mb-1" htmlFor="remarks-quality-notes">Remarks / Quality Notes</label>
              <input id="remarks-quality-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Moisture, purity, condition" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <p className="font-medium text-foreground mb-1">Attachments</p>
              <p className="text-muted-foreground mb-2">Paste link to scanned bill (optional) — no file is uploaded; only the link is saved with the voucher, and it becomes a clickable link on the slip once saved.</p>
              <AttachmentFields url={attachmentUrl} note={attachmentNote} onUrlChange={setAttachmentUrl} onNoteChange={setAttachmentNote} idPrefix="inward" />
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground uppercase tracking-wider">Unloaded Product Lines</span>
              <button type="button" onClick={handleAddItem} className="text-xs text-primary hover:underline font-semibold flex items-center gap-1 cursor-pointer">
                <Plus className="h-3 w-3" />
                <span>Add Item Line</span>
              </button>
            </div>

            <div className="space-y-2">
              {items.map((item, idx) => {
                const netWeight = Math.max(0, item.grossWeight - item.tareWeight)
                const lineTotal = netWeight * item.rate
                const lineIssues: string[] = []
                if (!item.productId) lineIssues.push("product")
                if (!(Number(item.bags) > 0)) lineIssues.push("bags greater than zero")
                if (!(Number(item.grossWeight) > 0)) lineIssues.push("gross weight greater than zero")
                if (Number(item.tareWeight) >= Number(item.grossWeight) && Number(item.grossWeight) > 0) lineIssues.push("tare weight less than gross weight")
                return (
                  <div key={idx} className="p-2.5 rounded-lg bg-muted border border-border text-xs space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`product-${idx}`}>Product *</label>
                        <div className="flex flex-wrap items-start gap-2"><select id={`product-${idx}`}
                          value={item.productId}
                          onChange={(e) => handleItemChange(idx, "productId", e.target.value)}
                          className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-background border border-border text-foreground"
                        >
                          {products.map((pr) => (
                            <option key={pr.id} value={pr.id}>
                              {pr.name}
                            </option>
                          ))}
                        </select> <InlineAdd label="Product" fields={PRODUCT_FIELDS} createAction={async (v) => createProduct({ code: v.code, name: v.name, category: v.category || "raw_seed" })} onCreated={async (id) => { const r = await listProducts(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setProducts(list); } handleItemChange(idx, "productId", id); }} /></div>
                        {products.find((pr) => pr.id === item.productId) && (
                          <p className="mt-1 break-words text-muted-foreground">Selected: {products.find((pr) => pr.id === item.productId)?.name}</p>
                        )}
                      </div>
                      {items.length > 1 && (
                        <button type="button" onClick={() => handleRemoveItem(idx)} className="mt-4 p-1 text-destructive hover:bg-destructive/10 rounded cursor-pointer" title="Delete Row">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <div>
                        <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`bags-count-${idx}`}>Bags Count *</label>
                        <input id={`bags-count-${idx}`} type="number" value={item.bags} onChange={(e) => handleItemChange(idx, "bags", Number(e.target.value))} className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground" min="1" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`gross-wt-kg-${idx}`}>Gross Wt (kg) *</label>
                        <input id={`gross-wt-kg-${idx}`} type="number" value={item.grossWeight} onChange={(e) => handleItemChange(idx, "grossWeight", Number(e.target.value))} className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`tare-wt-kg-${idx}`}>Tare Wt (kg)</label>
                        <input id={`tare-wt-kg-${idx}`} type="number" value={item.tareWeight} onChange={(e) => handleItemChange(idx, "tareWeight", Number(e.target.value))} className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`rate-kg-${idx}`}>Rate / kg</label>
                        <input id={`rate-kg-${idx}`} type="number" value={item.rate} onChange={(e) => handleItemChange(idx, "rate", Number(e.target.value))} className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`lot-no-${idx}`}>Lot No. (optional)</label>
                        <input id={`lot-no-${idx}`} type="text" value={item.lotNo} onChange={(e) => handleItemChange(idx, "lotNo", e.target.value)} placeholder="Leave empty for no lot tracking" className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground" />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4 text-foreground">
                      <span><span className="text-muted-foreground">Net weight: </span><strong className="font-mono">{formatWeight(netWeight)}</strong></span>
                      <span><span className="text-muted-foreground">Line value: </span><strong className="font-mono">{formatCurrency(lineTotal)}</strong></span>
                      {lineIssues.length > 0 && (
                        <span className="text-red-600 dark:text-red-400">Line {idx + 1} still needs: {lineIssues.join(", ")}.</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Total Bags: </span>
              <strong className="text-foreground font-mono">{formatBags(totalBags)}</strong>
            </div>
            <div>
              <span className="text-muted-foreground">Net Weight: </span>
              <strong className="text-emerald-600 dark:text-emerald-400 font-mono text-sm">{formatWeight(totalNetWeight)}</strong>
            </div>
            <div>
              <span className="text-muted-foreground">Estimated value (receipt estimate — not a purchase bill): </span>
              <strong className="text-foreground font-mono">{formatCurrency(totalValue)}</strong>
            </div>
          </div>

          {!canPost && (
            <p className="text-xs text-red-600 dark:text-red-400">Before posting, complete: {validationIssues.join("; ")}.</p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={secondaryButtonClass}>Cancel</button>
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isPending || isSavingDraft}
              title="Save without posting — stock is unchanged until the voucher is posted."
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-muted text-foreground text-xs font-bold shadow-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSavingDraft ? <SubmitSpinner /> : null}
              <span>{isSavingDraft ? "Saving…" : "Save as draft"}</span>
            </button>
            <button
              type="submit"
              disabled={isPending || !canPost}
              title={!canPost ? `Complete before posting: ${validationIssues.join("; ")}` : "Post and add this stock to the ledger"}
              className={primaryButtonClass}
            >
              {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
              <span>{isPending ? "Posting…" : "Post & Update Stock Ledger"}</span>
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={showPostConfirm}
        title="Post this inward voucher?"
        description={draftVoucher ? `Posting will add ${formatWeight(draftVoucher.total_net_weight_kg)} (${formatBags(draftVoucher.total_bags)}) to ${draftVoucher.godown_name || "the selected godown"}. A voucher number is assigned on posting. Posted vouchers can only be changed by reversal.` : ""}
        confirmLabel="Post & Update Stock Ledger"
        pending={isPending}
        onConfirm={handleConfirmPost}
        onCancel={() => { setShowPostConfirm(false); setDraftVoucher(null) }}
      />
    </>
  )
}
