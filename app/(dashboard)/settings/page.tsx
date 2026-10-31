import { getSettingsSnapshot, listDocNumbering } from "@/app/actions/settings"
import {
  type SettingsSnapshot,
  type DocNumberingRow,
} from "@/lib/settings-validation"
import { SettingsForm } from "@/components/settings-form"

/**
 * Server component: fetches the Settings initial data on the server
 * (in parallel, as the old client page did) and passes it as plain,
 * serializable props to the client form island. The form therefore
 * paints with content immediately instead of mounting, showing a
 * skeleton, then waiting on a client action round trip.
 *
 * On fetch failure the page still renders the island, with the error
 * in the same formError banner the old page showed — never a blank
 * page or a crash. A partially successful fetch still passes through
 * whichever half succeeded, exactly as the old loadData() did.
 * Route loading (loading.tsx) still shows SettingsSkeleton while
 * this server component loads.
 */
export default async function SettingsPage() {
  let initialSnapshot: SettingsSnapshot | null = null
  let initialNumbering: DocNumberingRow[] = []
  let initialError = ""
  try {
    const [snap, num] = await Promise.all([
      getSettingsSnapshot(),
      listDocNumbering(),
    ])
    const failed = [snap, num].find((x) => !x.success)
    if (failed) initialError = failed.error ?? "Could not load settings."
    if (snap.success && snap.data) {
      initialSnapshot = snap.data as SettingsSnapshot
    }
    if (num.success && Array.isArray(num.data)) {
      initialNumbering = num.data as DocNumberingRow[]
    }
  } catch (err) {
    initialError = err instanceof Error ? err.message : "Could not load settings."
  }

  return (
    <SettingsForm
      initialSnapshot={initialSnapshot}
      initialNumbering={initialNumbering}
      initialError={initialError}
    />
  )
}
