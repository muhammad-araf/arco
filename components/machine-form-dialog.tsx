"use client"

/**
 * Machine add + edit in one modal form (POS pattern: the same form
 * for both, trigger is an Add button or a row Edit button).
 *
 * Replaces the machine slots in Masters' generic "Add a master
 * record" form and its generic edit modal, where the processing type
 * lived in a field called "extra", throughput in "number 1" and the
 * operator in "extra 2". Here every field has its real name.
 * Payloads are unchanged: on create a blank processing type becomes
 * "Grading" and a blank/zero throughput becomes undefined (as the old
 * form's `|| undefined` did); on edit a blank throughput submits 0
 * and a blank operator submits "" (as the old form's number state
 * and raw operator field did).
 */
import * as React from "react"
import { createMachine, updateMachine } from "@/app/actions/masters"
import type { Machine } from "@/lib/types/database"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export function MachineFormDialog({
  open,
  onClose,
  machine,
  machines,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** null = creating a new machine; a row = editing it. */
  machine: Machine | null
  machines: Machine[]
  onSaved: (notice: string) => void
}) {
  const isEditing = machine !== null
  const [code, setCode] = React.useState("")
  const [name, setName] = React.useState("")
  const [processingType, setProcessingType] = React.useState("")
  const [throughput, setThroughput] = React.useState("")
  const [operator, setOperator] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setCode(machine?.code ?? "")
      setName(machine?.name ?? "")
      setProcessingType(machine?.processing_type ?? "")
      setThroughput(
        machine?.capacity_kg_per_hour != null
          ? String(machine.capacity_kg_per_hour)
          : "",
      )
      setOperator(machine?.operator_name ?? "")
      setError("")
      setPending(false)
    }
  }, [open, machine])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    if (!isEditing && !code.trim()) return setError("Machine code is required.")
    if (!name.trim()) return setError("Machine name is required.")
    if (isEditing && !processingType.trim())
      return setError("Processing type is required.")
    const throughputNum =
      throughput.trim() === "" ? NaN : Number(throughput)
    if (throughput.trim() !== "" && (!Number.isFinite(throughputNum) || throughputNum < 0))
      return setError("Throughput cannot be negative.")
    if (
      !isEditing &&
      machines.some((m) => m.code.trim().toLowerCase() === code.trim().toLowerCase())
    )
      return setError(`A machine with code "${code.trim()}" already exists. Pick a different code.`)
    setPending(true)
    try {
      const res = isEditing
        ? await updateMachine(machine.id, {
            name: name.trim(),
            processing_type: processingType.trim(),
            capacity_kg_per_hour:
              throughput.trim() === "" ? 0 : throughputNum,
            operator_name: operator.trim(),
          })
        : await createMachine({
            code: code.trim(),
            name: name.trim(),
            processing_type: processingType.trim() || "Grading",
            capacity_kg_per_hour: throughputNum || undefined,
            operator_name: operator.trim() || undefined,
          })
      if (!res.success) {
        setError(res.error ?? "Could not save the machine.")
        return
      }
      onSaved(
        isEditing
          ? `"${name.trim()}" updated.`
          : `"${name.trim()}" created.`,
      )
      onClose()
    } finally {
      setPending(false)
    }
  }

  if (!open) return null
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? `Edit ${machine.code}` : "Add machine"}
      description={
        isEditing
          ? "Change the details below. The code never changes."
          : "A plant machine. It appears in Machinery jobs."
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <Field
          id="mch-code"
          label="Plant code"
          required={!isEditing}
          hint={isEditing ? "Code never changes after creation." : "e.g. MCH-01"}
        >
          <input
            id="mch-code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. MCH-01"
            className={`${inputClass} font-mono`}
            disabled={isEditing}
            required={!isEditing}
          />
        </Field>
        <Field id="mch-name" label="Machine name" required>
          <input
            id="mch-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Grading Plant 1"
            className={inputClass}
            required
          />
        </Field>
        <Field
          id="mch-processing-type"
          label="Processing type"
          required={isEditing}
          hint={
            isEditing
              ? undefined
              : "Leave blank for Grading."
          }
        >
          <input
            id="mch-processing-type"
            type="text"
            value={processingType}
            onChange={(e) => setProcessingType(e.target.value)}
            placeholder="e.g. Grading"
            className={inputClass}
            required={isEditing}
          />
        </Field>
        <Field
          id="mch-throughput"
          label="Throughput (kg/hr)"
          hint={
            isEditing
              ? "Leave blank to set 0."
              : "Leave blank for no set throughput."
          }
        >
          <input
            id="mch-throughput"
            type="number"
            min="0"
            value={throughput}
            onChange={(e) => setThroughput(e.target.value)}
            placeholder="e.g. 2000"
            className={`${inputClass} font-mono`}
          />
        </Field>
        <Field id="mch-operator" label="Assigned operator">
          <input
            id="mch-operator"
            type="text"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            placeholder="e.g. Abdul Ghafoor"
            className={inputClass}
          />
        </Field>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? <SubmitSpinner /> : null}
            <span>
              {pending ? "Saving…" : isEditing ? "Save changes" : "Create machine"}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
