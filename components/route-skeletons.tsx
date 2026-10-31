import { DetailRowsSkeleton, FilterFieldsSkeleton, ListCardSkeleton, Skel, StatCardsSkeleton, TabBarSkeleton, TableCardSkeleton, TitleRowSkeleton } from "@/components/erp-ui"

/* Shared route skeletons: each route's loading.tsx and the page's own
   in-page loading state render the SAME component, so the shape never
   shifts between navigation skeleton and mount skeleton. */

export function AuditSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={0} subtitle />
      <FilterFieldsSkeleton fields={4} button />
      {/* Real audit table: When, User, Action, Entity, Voucher, Reason,
          Before / After. The old centred text blocks matched no section
          on the page, so they are replaced by this table. */}
      <TableCardSkeleton rows={8} columns={[2, 2, 1, 2, 1, 2, 2]} />
    </div>
  )
}

export function BillingSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {/* Customers table: Party Code, Customer Name, Contact / Phone,
              Opening Due, Current Balance, Action. */}
          <TableCardSkeleton rows={8} columns={[1, 2, 2, 1, 1, 1]} />
        </div>
        {/* Receipts feed beside it (list rows, not a table). */}
        <ListCardSkeleton rows={4} />
      </div>
      {/* Customer Invoices table below: Invoice, Date, Customer, Total,
          Paid, Balance, Status / Actions. */}
      <TableCardSkeleton rows={8} columns={[1, 1, 2, 1, 1, 1, 1]} />
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      {/* 7 real quick actions: New Inward, Issue Gate Pass, Run Batch,
          Purchase, Receipt, Expense, Attendance. They wrap on phones
          via the shared title row. */}
      <TitleRowSkeleton buttons={7} />
      {/* 4 real stat cards: Today's Inward, Processing Output,
          Dispatched, Cash. */}
      <StatCardsSkeleton count={4} cols="sm:grid-cols-2 lg:grid-cols-4" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Stock by Product: Product / Grade, Available Weight, Status. */}
          <TableCardSkeleton rows={6} columns={[3, 2, 1]} />
          <ListCardSkeleton rows={4} />
        </div>
        <div className="space-y-6">
          <div className="expensive-card p-5 space-y-3">
            <Skel className="h-4 w-28 bg-muted rounded" />
            <Skel className="h-16 w-full rounded-lg bg-muted" />
            <Skel className="h-16 w-full rounded-lg bg-muted" />
            <Skel className="h-10 w-full rounded-lg bg-muted" />
          </div>
          {/* Godown Space: one block per godown — name/percent row,
              occupancy bar, stored/capacity row. */}
          <div className="expensive-card p-5 space-y-4">
            <Skel className="h-4 w-28 bg-muted rounded" />
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <Skel className="h-3 w-24 bg-muted rounded" />
                  <Skel className="h-3 w-16 shrink-0 bg-muted rounded" />
                </div>
                <Skel className="h-2 w-full rounded bg-muted" />
                <div className="flex items-center justify-between gap-3">
                  <Skel className="h-3 w-20 bg-muted rounded" />
                  <Skel className="h-3 w-16 shrink-0 bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function DaybookSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      {/* 4 real liquidity cards: Cash in Hand, Bank, Online, Total Cash. */}
      <StatCardsSkeleton count={4} cols="sm:grid-cols-2 lg:grid-cols-4" />
      {/* Balances by account: Account, Kind, Opening, Closing. */}
      <TableCardSkeleton rows={5} columns={[2, 1, 1, 1]} />
      {/* Date-range filter: From / To + Load daybook. */}
      <FilterFieldsSkeleton fields={2} button />
      {/* Expenses in range: Expense, Date, Category, Payee, Location,
          Amount, Status / Actions. The Cash transfer form between the
          filter and this table is not shown. */}
      <TableCardSkeleton rows={8} columns={[2, 1, 1, 1, 1, 1, 1]} />
    </div>
  )
}

export function EmployeesSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      {/* Default tab is Directory: its one header button is Add employee.
          Payroll tab has 4 buttons, Attendance/Advances 1 each — only the
          default tab is shown, as on the real page. */}
      <TitleRowSkeleton buttons={1} />
      {/* 4 real tabs: Directory, Attendance, Payroll, Advances. */}
      <TabBarSkeleton tabs={4} />
      {/* Default Directory table: Code, Staff Name, Designation, Wage
          Category, Base Rate, Phone, Payment, Status, Actions. */}
      <TableCardSkeleton rows={8} title={false} columns={[1, 3, 2, 2, 1, 1, 1, 1, 1]} />
    </div>
  )
}

export function GatepassSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      {/* 4 real header buttons: Export CSV, Export Excel, Export PDF,
          New Gate Pass. */}
      <TitleRowSkeleton buttons={4} />
      {/* Register filters: Status, Customer, Vehicle, From, To. No
          always-on button — Clear appears only when a filter is set. */}
      <FilterFieldsSkeleton fields={5} button={false} />
      {/* Gate Passes table: Gate Pass No, Date & Time, Customer /
          Receiver, Vehicle / Driver, Dispatch Godown, Bags, Weight (kg),
          Status, Actions. */}
      <TableCardSkeleton rows={8} columns={[2, 2, 2, 2, 2, 1, 1, 1, 1]} />
    </div>
  )
}

export function InventorySkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      {/* 5 real header buttons: Export CSV, Export Excel, Export PDF,
          Transfer, Correct stock. */}
      <TitleRowSkeleton buttons={5} />
      {/* 6 real tabs: Live Stock Summary, Movement Ledger, Transfers,
          Adjustments, Count, Ageing. */}
      <TabBarSkeleton tabs={6} />
      {/* Summary-tab filter: search + category select, no button. */}
      <FilterFieldsSkeleton fields={2} button={false} />
      {/* Default Live Stock Summary table, one godown card: Product /
          Grain, Owner, Available Weight, Min Threshold, Status. The
          real page repeats this card per godown. */}
      <TableCardSkeleton rows={8} columns={[2, 1, 2, 1, 1]} />
    </div>
  )
}

export function InwardSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      {/* List filters: Search, From, To + Apply (Clear is conditional). */}
      <FilterFieldsSkeleton fields={3} button />
      {/* Vouchers table: Voucher No, Date, Supplier / Source, Target
          Godown, Bilty / Vehicle, Bags, Net Weight, Total Value,
          Actions. */}
      <TableCardSkeleton rows={8} columns={[2, 1, 2, 2, 2, 1, 1, 1, 1]} />
    </div>
  )
}

export function LedgersSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={0} subtitle />
      {/* 6 real tabs: Stock, Party, Cash, Bardana, Cost, Payments. */}
      <TabBarSkeleton tabs={6} />
      {/* Date range shared by every tab: From / To + Apply. */}
      <FilterFieldsSkeleton fields={2} button />
      {/* Default Stock ledger table: Date, Voucher, Type, Godown,
          Product, Lot, Inward, Outward, Balance. Other tabs show their
          own columns, not shown here. */}
      <TableCardSkeleton rows={8} columns={[1, 1, 1, 1, 2, 1, 1, 1, 1]} />
    </div>
  )
}

export function MachinerySkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      {/* Jobs table: Job No, Date, Client / Owner, Machine Plant, Input
          Grain, Processed Weight, Billing Basis, Rate, Total Charge,
          Status. */}
      <TableCardSkeleton rows={8} columns={[1, 1, 2, 2, 2, 1, 1, 1, 1, 1]} />
    </div>
  )
}

export function MastersSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} subtitle />
      {/* 7 real tabs: Products, Godowns, Machinery Plants, Packaging
          types, Expense categories, Cash accounts, Processing types. */}
      <TabBarSkeleton tabs={7} />
      {/* Default tab is Products: Code, Product Name, Category, Unit,
          Standard Bag Wt, Safety Stock, Status, Actions. */}
      <TableCardSkeleton rows={8} title={false} columns={[1, 3, 2, 1, 2, 2, 1, 2]} />
    </div>
  )
}

export function MigrationSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={0} />
      {/* 3 real tabs confirmed: Data Dictionary, Opening Balances, Import. */}
      <TabBarSkeleton tabs={3} />
      {/* Default tab is the Sheet Map: Source Sheet, Excel Column Name,
          Target Field, Database Entity, Conversion Rule, Status. */}
      <TableCardSkeleton rows={8} columns={[2, 2, 2, 2, 3, 1]} />
    </div>
  )
}

export function PackingSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      {/* No header buttons on the real page. */}
      <TitleRowSkeleton buttons={0} />
      {/* 4 real sections: Batch packing, Standalone packing, History,
          Bardana. */}
      <TabBarSkeleton tabs={4} />
      {/* Default Batch packing tab is a form, not a table or stat cards:
          labeled field blocks + a submit block. The old stat cards
          matched no section on this page. History and Bardana tables
          live on their own tabs, not shown here. */}
      <div className="expensive-card p-5 space-y-4">
        <Skel className="h-4 w-36 max-w-full bg-muted rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2 min-w-0">
              <Skel className="h-3 w-16 bg-muted rounded" />
              <Skel className="h-9 w-full rounded-lg bg-muted" />
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Skel className="h-10 w-36 max-w-full rounded-lg bg-muted" />
        </div>
      </div>
    </div>
  )
}

export function PayrollSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <TableCardSkeleton rows={8} />
      <TableCardSkeleton rows={6} />
      <div className="expensive-card p-5 space-y-4">
        <Skel className="h-4 w-32 bg-muted rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skel key={i} className="h-9 w-full rounded-lg bg-muted" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skel key={i} className="h-9 w-full rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function PeopleSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={0} subtitle />
      {/* 2 real tabs: Employees, System users. */}
      <TabBarSkeleton tabs={2} />
      {/* System-users table (the tab this skeleton replaces in-page):
          Operator, Role, Status, Action. The default Employees tab is
          a link card, not this table. */}
      <TableCardSkeleton rows={6} title={false} columns={[3, 2, 1, 2]} />
    </div>
  )
}

export function ProductionSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      {/* Batches table: Batch No, Date, Machine Plant, Godown, Raw
          Input, Graded Output, By-Product, Yield %, Actions. */}
      <TableCardSkeleton rows={8} columns={[2, 1, 2, 1, 1, 1, 1, 1, 1]} />
      {/* Seed Recipes table below it: Code, Name, Version, Expected
          yield. Its create form is not shown. */}
      <TableCardSkeleton rows={4} columns={[1, 2, 1, 1]} />
    </div>
  )
}

export function PurchasesSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      {/* Invoices table: Purchase No, Date, Supplier / Grower, Invoice
          Ref, Total Payable, Paid Amount, Remaining Balance, Status,
          Actions. */}
      <TableCardSkeleton rows={8} columns={[2, 1, 2, 1, 1, 1, 1, 1, 1]} />
      {/* Pay a posted purchase form (always shown): 4 fields + Pay. The
          conditional draft-purchases card and the returns section below
          it are not shown. */}
      <FilterFieldsSkeleton fields={4} button />
    </div>
  )
}

export function ReportsSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <Skel className="h-7 w-56 max-w-full bg-muted rounded" />
        <div className="flex flex-wrap items-center gap-2">
          {/* Real header controls: From / To dates, then Export CSV,
              Export Excel, Export PDF, Print. */}
          <Skel className="h-8 w-32 max-w-full rounded-lg bg-muted" />
          <Skel className="h-8 w-32 max-w-full rounded-lg bg-muted" />
          <Skel className="h-10 w-28 max-w-full rounded-lg bg-muted" />
          <Skel className="h-10 w-32 max-w-full rounded-lg bg-muted" />
          <Skel className="h-10 w-28 max-w-full rounded-lg bg-muted" />
          <Skel className="h-10 w-40 max-w-full rounded-lg bg-muted" />
        </div>
      </div>
      <Skel className="h-3 w-64 max-w-full bg-muted rounded -mt-3" />
      {/* 3 real tabs: Profit & Loss, Godown Stock Summary, Valuation. */}
      <TabBarSkeleton tabs={3} />
      {/* Default tab is the P&L sheet: header, two label/value columns,
          totals bar. */}
      <div className="expensive-card p-6 space-y-6">
        <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
          <div className="space-y-2">
            <Skel className="h-5 w-72 max-w-full bg-muted rounded" />
            <Skel className="h-3 w-56 max-w-full bg-muted rounded" />
          </div>
          <Skel className="h-6 w-24 shrink-0 rounded bg-muted" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {Array.from({ length: 2 }).map((_, col) => (
            <DetailRowsSkeleton key={col} rows={4} card={false} />
          ))}
        </div>
        <Skel className="h-14 w-full rounded-md bg-muted" />
      </div>
    </div>
  )
}

export function SettingsSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={0} subtitle />
      {/* Company card: Name, Phone, Email, Logo URL, Address (full
          width) + Save company. */}
      <div className="expensive-card p-5 space-y-4">
        <Skel className="h-4 w-28 max-w-full bg-muted rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2 min-w-0">
              <Skel className="h-3 w-16 bg-muted rounded" />
              <Skel className="h-9 w-full rounded-lg bg-muted" />
            </div>
          ))}
          <div className="space-y-2 sm:col-span-2 min-w-0">
            <Skel className="h-3 w-16 bg-muted rounded" />
            <Skel className="h-9 w-full rounded-lg bg-muted" />
          </div>
        </div>
        <div className="flex justify-end">
          <Skel className="h-10 w-36 max-w-full rounded-lg bg-muted" />
        </div>
      </div>
      {/* Business settings card: Business model, Valuation method,
          Currency, Session timeout, Cutover date, Bilty duplicate
          check, Variance tolerance, plus two checkbox rows + Save. */}
      <div className="expensive-card p-5 space-y-4">
        <Skel className="h-4 w-36 max-w-full bg-muted rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="space-y-2 min-w-0">
              <Skel className="h-3 w-16 bg-muted rounded" />
              <Skel className="h-9 w-full rounded-lg bg-muted" />
            </div>
          ))}
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skel className="h-4 w-4 shrink-0 rounded bg-muted" />
              <Skel className="h-3 w-48 max-w-full bg-muted rounded" />
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Skel className="h-10 w-36 max-w-full rounded-lg bg-muted" />
        </div>
      </div>
      {/* Voucher prefixes table: Series, Prefix, Last number, Action. */}
      <TableCardSkeleton rows={4} columns={[2, 2, 1, 1]} />
    </div>
  )
}

export function UsersSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={0} subtitle />
      <TableCardSkeleton rows={6} title={false} />
    </div>
  )
}
