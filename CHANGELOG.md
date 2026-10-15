# Changelog

## 2026-10-15

### Crew certifications

- Settings, Credential types holds OSHA 10, OSHA 30, Fall protection, Forklift, CPR/First Aid, Driver license, and Trade license. A type is Active or Archived, and can be marked required. Field cannot edit the list.
- A card is a type, an optional number, an issued date, and an expiration, unless it does not expire. A photo or PDF of the card uses the same file checks as other uploads. Status is Active, Expired, or Revoked.
- Office sees every card. A person sees their own, including the number. Field does not see anyone else’s card or number. A viewer sees the last four.
- Today, Safety, and Certifications count Expired and cards inside 7, 30, and 90 days. Copy the link or mark requested. The row stores the date and who. No message is sent. Assigning someone with an expired required card warns and still saves.
- CSV numbers are on the file for an owner or admin. Office, field, and viewer get a blank number column.
- Seed: Dana’s OSHA 10 expired last month and is marked requested. Maya’s OSHA 30 expires in 20 days. Luis’s forklift is current.

### Material requests

- Field submits a request from My day or the job. Office submits one from Materials. Job, one or more lines, quantity, Normal or Urgent, and an optional note. A line is an inventory SKU or a description with an optional cost code. No location is read and no vendor is contacted.
- Materials is Draft, Submitted, Approved, then Fulfilled, Ordered, or Rejected. A rejection needs a note. Field sees only their own. Office approves, issues stock to the job, or adds the lines to a draft purchase order. Prices come from the price book.
- The same job and SKU within three days shows a Duplicate pill and a link. It still saves.
- Today and Inbox count submitted requests older than two days, and any urgent submitted request.
- CSV is on Materials. Seed: Dana’s tile request is urgent and waiting. Maya’s tile on Okonkwo is fulfilled from the existing yard issue. Quartz vanity is ordered on PO-1056. Extra blades is rejected, and the note is on the request.

### Mileage logs

- Settings, Mileage holds the company cents-per-mile rate in dated periods. 2026 is 72.5 through June 30 and 76 from July 1. The IRS figure stays on the period when the company rate differs. Office can edit. Field cannot.
- Field logs a trip from My day. Office logs one from Mileage. Date, start and end odometer or total miles, optional job, from, to, and a purpose. Business or personal. Only business miles are reimbursed. No location is read.
- Mileage filters by person, job, dates, and Draft, Submitted, Approved, Reimbursed, or Rejected. Office approves or rejects. A rejection needs a note. Field sees only their own trips.
- Approved business miles sit under Reimbursements, with a total per person and a CSV. The amount is the miles times the rate for that date, in cents. Mark reimbursed records the date and who. No payout is sent. A later rate edit leaves an approved amount as it was.
- Today counts submitted trips older than two days.
- Seed: Dana’s April lumber run is waiting. Maya’s September client walk is reimbursed. Dana’s February shop commute is rejected.

### Receipts and cost inbox

- Field and office capture a receipt from My day or the job. Photo, optional job, store, date, total, optional cost code, note, and company card, personal, or cash. The photo uses the same checks as a job photo. Capture needs a connection. It is not saved on the phone.
- Receipts is New, Coded, Posted, and Rejected. Office assigns the job, store, and cost code, and can split the total across codes. Field sees only the receipts they submitted.
- Post writes a job cost, so budget, WIP, and job profit pick it up. A vendor or a PO writes a draft bill instead, through the existing bill. Job cost and the cash line follow when that bill is approved. Reject needs a note the submitter sees.
- The same store and amount within three days, or the same photo, shows a Duplicate pill and a link. It still saves.
- A photo is typed by hand. No model is called, and nothing is filled in from the image.
- Personal receipts that are posted sit under Reimbursements, with a total per person and a CSV. Mark reimbursed records the date and who. No payout is sent.
- Today counts new receipts older than two days.
- Seed: two Home Depot receipts on Brooks are a possible duplicate. Dana's Ace Hardware receipt is posted and waiting. Lobby kiosk is rejected.

### 1099 vendor report

- Reports, 1099 is one calendar year of vendor payments. Cash is the paid date on bills already in Fieldline, net of retainage and of vendor credits applied to that bill. Card and third-party processor payments stay off box 1.
- The threshold is $600 through 2025 and $2,000 from 2026. It lives in code. A C corp or S corp is exempt. An attorney is not. An office flag can exempt anyone else.
- W-9 is On file, Missing, or Stale. Needs W-9 lists vendors over the threshold without a current W-9. Copy the portal link or mark requested. No message is sent.
- The table masks the TIN to the last four. CSV carries the full TIN for an owner or admin only. Office and viewer get a blank TIN. Field does not see the report.
- From December 1 through January 31, Today and Inbox count vendors over the threshold who still need a W-9.
- Seed for 2026: Harbor and Casa are over $2,000 with a W-9. Brighton is over and missing a W-9. Summit is between $600 and $2,000. Mill & Co is a corporation. Slab House was paid by card.

### Bid leveling

- On an open bid, a no-bid or blank line can take an internal plug in cents, with a short note. The plug is for leveling only. It is not the vendor’s price, it is not on the vendor portal, and it cannot be awarded.
- Each vendor column shows a raw total of submitted prices and a leveled total that adds plugs on that vendor’s missing lines. A vendor with any no-bid or blank line stays Incomplete until those lines are plugged or left open.
- Plugs stay on the bid while it is out. Awarding clears them. Field does not see the amounts.

## 2026-10-14

### Crew workload

- Settings, Capacity is the company week in hours, 40 unless you change it, and the same workdays the schedule already uses. A person can have their own hours. Blank puts them back on the company week. Field cannot change it.
- Schedule, Workload is people by week, this week and the next seven. Move the date to shift the window. A cell is booked hours, capacity, and a percent. Over 100% is teal. Open a cell for the items. Filter by office or field, or by a crew. Crews and vendors show only when they are on an item, and only with the Crews filter. CSV downloads the same grid.
- Booked hours come from schedule assignments, dispatch visits, and bookings. Hours set on an item are the total for the span, spread across that span's workdays in the company time zone. A start and end clock, with no hours set, counts on every workday. Otherwise each workday is 8 hours. Weekends and company days off get nothing. The same person and item count once, including a visit tied to that item. Approved PTO lowers that week's capacity and is not booked time.
- Assigning someone on the schedule or the day board past that week's capacity shows the resulting hours and still saves.
- Today lists the people over this week, with the count, and opens Workload.
- Seed: Dana is over this week and next. Luis has framing and drywall and stays under. Sam is 24 hours a week, with 8 hours of approved PTO this week, and a short measure next week. Nothing is emailed or texted.

### Sales commissions

- Settings, Commissions is a plan for a person or a role. The rate is on contract value or on gross profit. Gross profit is sold minus job cost. When the job has no cost yet, the basis is the contract and the line says so. A project type can carry its own rate. Milestones are percents that add to 100, for deposit, job start, and completion or fully collected. Field cannot change the plans.
- A won job holds splits for setter, consultant, manager, or another person. Percents must add to 100 or less. The rest is unassigned. A fixed share is dollars of that person's basis. A change order that moves the sold amount recalculates the earned commission and shows the delta. Nothing is paid by itself.
- Commission is earned as cash is collected. Invoice payments count. An applied credit memo counts. A voided payment comes back out. Each line stores the person, the job, the basis, the rate, the earned cents, the milestone, and a status of Draft, Owed, Paid, or Void. Running it again does not earn the same dollars twice. Mark paid records the office payment. It does not send ACH or payroll.
- Work, Commissions lists owed and paid by person and job, filters, and downloads CSV. Open a row to Mark paid or Void. A person who cannot see company money sees only their own rows, and cannot mark them. Today counts Owed for an owner or admin. Inbox has one note. Automations can run on `commission_owed` and `commission_marked_paid`.
- Seed: Maya is 5% of contract, 6% on Bath remodel, paid 40/30/30. Luis is 10% of gross profit, paid 30/40/30. Office is 4% of contract for the estimator role. Okonkwo is 60% Maya and 40% Luis, with Maya's deposit marked paid. Diaz is 70% Luis and 30% Maya, with Luis's deposit marked paid. Brooks is 50% Maya, so 50% stays unassigned. Nothing is emailed or texted.

### Lead sources

- Settings, Lead sources is the company list. Each source has a name, Active or Archived, and optional spend in cents for a month. Spend can change the next month. A new company starts with Website form, Referral, Google, Repeat client, Yard sign, and Other. Field cannot change the list or the spend.
- Every lead has one source. The public lead form uses Website form. Online booking uses Online booking and files one lead for a new contact. A second booking for that contact keeps the same lead. An office lead starts on Other unless someone picks another source. Changing it writes an audit entry. The source shows on the lead and on the client, and both lists filter by it.
- A job created from a won lead keeps the source it had at signing. Changing the lead later leaves the job on the original source.
- Reports, Lead sources uses the report date range and CSV. Each source shows leads, won, win rate, sold value, collected cash, spend, cost per lead, cost per won job, and return (collected divided by spend). Sold value is the signed contract plus approved change orders. A zero denominator is a dash. The totals row uses the sums. Money stays integer cents. Nothing is emailed or texted.
- Seed: Rivera has those sources plus an archived Home show and Online booking. Google, Yard sign, and Home show have a few months of spend. Chen and Okonkwo stay Referral. Brooks stays Yard sign. Diaz stays Repeat client. Ellis stays Website form.

### Selection deadline follow-ups

- Settings, Selections turns deadline follow-ups on. Days before is 3 unless you change it. Days after is optional and stays 0 until you set it. Neither can pass 90. The message can use {client}, {job}, {selection}, {due}, and {link}. Tags on the exclude list skip that job. Field cannot change it.
- A released selection inside the before-due window gets one follow-up for that cadence. A draft gets one only once it is past due. The same selection and cadence stays one row. Choosing or locking the selection closes an open follow-up.
- Work, Selection follow-ups lists the rows, filters them, and downloads CSV. Open one to copy the portal link and Mark sent when the office has sent it outside Fieldline. Status is Draft, Ready, Copied, Sent, Skipped, or Void. Skip needs a reason.
- Today counts a Ready follow-up for an owner or admin. Inbox has the note. Automations can run on `selection_followup_created` and `selection_followup_marked_sent`. The Okonkwo portal shows Due on Floor tile.
- Field does not open the list. Nothing is emailed or texted.
- Seed: Floor tile on Okonkwo is one day past due and Ready, with a portal link. Vanity is already chosen and has no follow-up.

### Client credit memos

- A client credit memo sits on a job. It is a flat fee or cost-code lines. It has a number such as CM-1048, a title, a description, and an amount in cents. Status is Draft, Ready, Partial, Applied, or Void. Ready means released.
- Releasing it does not change the revised contract or the job running total. Applying it lowers the open balance on an owner invoice. The payment method is Credit memo. Cash recorded on that payment is $0.
- Office applies part or all of a Ready memo to an open invoice on the same job. The same idempotency key does not apply twice. More than the memo left, or more than the invoice balance, is refused. Voiding reverses each application, puts that amount back on the invoice, and leaves the memo unusable.
- Work, Credit memos lists the rows, filters them, and downloads CSV. A job shows the open and applied amounts. The client record shows the open credit balance. The invoice page lists applied memos under Payments. The client portal lists released memos and shows applied credits on the price summary and on the invoice. Clients cannot apply.
- Today counts a Ready or partial memo for an owner or admin. Inbox has the note. Automations can run on `client_credit_created`, `client_credit_applied`, and `client_credit_voided`.
- Field can propose a draft and does not see the amount. Field cannot release, apply, or void. Nothing is emailed or texted. Nothing is sent to a payment processor.
- Seed: CM-1048 is an open $180 window allowance on Brooks. CM-1049 is $300, with $80 applied to RR-1036. Diaz and RR-1019 are unchanged.

## 2026-10-13

### Invoice follow-ups

- Settings, Collections turns overdue follow-ups on. Two reminders are days after the due date, 3 and 14 unless you change them, and neither can pass 90. The message can use {client}, {invoice}, {amount}, {due}, and {link}. Tags on the exclude list skip that job. Field cannot change it.
- An invoice that is sent and past due gets one follow-up per cadence. The same invoice and cadence stays one row. Paid, void, and draft invoices do not get one. Paying or voiding closes an open follow-up.
- Draft means the pay link is missing. Ready means the portal pay link is there. Copy link records Copied. Mark sent records that the office sent it outside Fieldline. Skip needs a reason. Void closes it.
- Work, Collections lists the rows, filters them, and downloads CSV. The detail page has the message and the pay link. Today counts a Ready follow-up for an owner or admin. Inbox has the note. An automation can run when a follow-up is created, and when it is marked sent.
- The client portal keeps Pay on an open invoice, and shows Pay now while a follow-up is Ready or Copied. Reports count follow-ups created, marked sent, and skipped this month, and the dollars still open on Ready rows.
- Seed: RR-1019 on Diaz is past due, with a Ready follow-up and a pay link. Nothing is emailed or texted.

### Review requests

- Settings, Reviews holds the Google review link, and optional Facebook and website links. Timing is Job completed or Job fully paid. Tags on the exclude list skip that job. The message can use {client}, {job}, and {link}. Field cannot change it.
- A finished job, or a job whose invoices are all paid, gets one review request. A second trigger keeps that same row. Draft means there is no link yet. Ready means the link is there. Copy link records Copied. Mark sent records that the office sent it outside Fieldline. Skip needs a reason. Void closes it.
- Work, Reviews lists the requests, filters them, and downloads CSV. The detail page has the link and the message. Today counts an open request for an owner or admin. Inbox has the note. An automation can run when a request is created, and when it is marked sent.
- The client portal shows Leave a review once the request is ready. The link opens the pasted review page. My day shows Ask for review on a job the tech is already on, and copies the link. Nothing is emailed or texted.
- Reports count requests created, marked sent, and skipped this month.
- Seed: Diaz deck replacement is complete, with a Ready request and a Google review link on the company.

### Online booking

- Settings, Bookings turns the public page on, sets the days and hours, the earliest lead time, the interval, and the buffer. The link is on that page to copy. Field cannot change it.
- A price-book service can be bookable, with a duration from 15 minutes to 12 hours and an optional price. A field tech can be bookable, with hours that replace the company window, or time off that closes those days.
- The public page lists the services, then the open days and times. A slot appears only when a bookable tech is free for the whole duration. Existing dispatch cards, schedule items, and agreement visits block that tech. A buffer widens those cards. A shared edge stays free.
- The client enters a name, phone, email, and the questions. That writes or updates the contact and places the visit on the day board. One free tech is assigned. Several free techs resolve to the first user id in ascending order. A taken time is refused. No invoice is written.
- Today lists Online booking for an owner or admin. Inbox has the same note. An automation can run on Online booking created.
- Seed: Service call is bookable at $189 for 1 hour. Dana is bookable weekdays 8:00–16:00. Nora Ellis is an unassigned Service call today at 16:00, in Open.

### Proposal options

- An estimate can carry Good, Better, and Best, up to four. Each option has its own lines, cost, price, and margin. Scope, terms, and the deposit rule stay on the estimate. An estimate with no options prices the same way it did.
- The estimate page shows the options as pills. The open one is teal. The totals bar follows that option, and a strip lists each option’s price and margin. Duplicate copies a tier. One option can be recommended.
- The client proposal shows the options side by side, with the price, the deposit, and the lines. Choosing one marks the others Declined, then the signature is the same as before. The office can switch the choice before any deposit is paid, and the reason is stored on the audit row. A sent proposal keeps each option’s lines as they were.
- The signed contract, budget, draws, and later job cost use only the chosen option. Reports list how often each tier was picked, and the average signed amount with options and without.
- Seed: Cho primary bath is a draft with Good, Better, and Best. Bath options is signed on Better.

### Day dispatch board

- Work > Dispatch is one day from 7a to 6p. Prev, Today, and Next sit with the date. Day and Week switch views. Each field tech, and anyone already booked, has a column and the hours on it.
- A card shows the title, the job, and the clock, sized to its duration. An overlap is a red edge. Open is a narrow list: title, job, date. Drop a row on a column to place it on a 15-minute mark. A card opens start, end, tech, and Unassign.
- The same person cannot take two cards whose times overlap. A shared edge is free. A missing end is 60 minutes. The other card stays put, and the page says which job it overlaps.
- Each move writes an audit row. Unassign adds a row and leaves the earlier assign in the log.
- Field sees only their column and cannot move anyone else. Today counts unassigned work. Inbox has the unassigned note. An automation can run on Unassigned visit today.
- Seed: Coil visit is unassigned at 08:30 on Chen. Tile shower is Dana at 07:30. Framing walk is Luis at 08:00 when that day is in the current week.
- The open count in the toolbar is the Open list. Dates read Oct 13. A column shows hours as 1h booked.

### Service agreements

- An agreement sits on a client and an optional job. It names the included price-book lines, a start date, a term, a visit cadence, a billing rule, a checklist, and a default crew.
- Cadence is weekly, every N weeks, monthly, quarterly, semiannual, annual, a list of dates, or as needed. Dates stay on the calendar day, including month-end and the spring-forward weekend. A rolling 90-day horizon fills visits. As-needed agreements add visits in a block.
- Billing writes a draft invoice. Per visit, that happens when the visit is completed. A fixed month, quarter, or year writes the draft on the period date from the follow-up cron. The same visit or period does not write a second draft.
- Status is draft, active, expiring soon (inside 30 days), pending renewal, renewed, expired, or cancelled. Renew copies the agreement into a draft. The current agreement becomes renewed when that draft is accepted.
- Visits land on the schedule. Office can assign, move, or link a job. The crew can skip with a reason or complete the checklist. Today lists unscheduled visits, overdue visits, and agreements expiring. Inbox carries the same three notes.
- Work > Agreements filters by status and downloads CSV. The client record shows the active agreement and the next visit. The client portal accepts a draft by typing a name. Reports cover monthly recurring revenue, visits completed against scheduled, and the renewal rate. Automations can run on a visit due or an agreement expiring.
- Seed: Filter plan on Okonkwo, Seasonal cut expiring on Brooks, Furnace tune pending renewal on Chen, Snow route renewed on Diaz, and an expired coil cleaning.

## 2026-10-12

### Job-site geofence

- Each job can store a site pin and an optional radius. The office sets the pin from coordinates, from the browser location, or from a clock-in that already has a point. Address lookup stays behind a stub and is off.
- Company time settings are Off, Warn, or Require location. Warn is the seeded mode. The default radius is 300 m, shown in feet or meters. A person can be set to require a location even when the company warns.
- Clock in, switch job, and clock out read the device once. A denial still saves the punch. The same reading is stored on an offline punch and checked when it syncs. Nothing is stored between punches.
- Distance is haversine. A job with no pin shows No pin and is not a flag. General time is not a flag. A point with no reading is No location. Accuracy wider than the radius is Weak GPS, not Outside. A point past the radius shows the distance, such as Outside 0.4 mi.
- The punch is still saved. The pill shows on the week grid, the shift row, time review, and My day. Field sees only their own pill. An approver adds a reason; a later reason is a new row, and the earlier row stays. Approving in Warn names the open flags. Require location waits for an override.
- Today and Inbox show a new outside punch to owners, admins, and the job’s PM. An automation can run on Clock punch outside job site. Payroll CSV and the Labor cost report include a Site column, and the CSV can be limited to Outside. The shift row shows the coordinates and a radius sketch. No tile server.

### Material inventory

- A stock item is a price-book row: name, unit, cost code, and default unit cost stay on the catalog. The stock row adds an optional SKU, a reorder point, and a preferred vendor.
- Locations are the yard, a warehouse, a truck, or a job. Each item keeps on hand, allocated, and available at each location. Available is on hand minus allocated. Allocated is the quantity already issued to that job.
- Cost is a moving average per location. A receipt blends its cost into that location. An issue, return, transfer, or adjustment takes a proportional share of the location value, and the last units take the remaining cents.
- Movements are received, adjusted, issued, returned, transferred, or moved job to job. None of them edit an older row. Void writes the reason and puts the quantity and the cost back. The same source key does not post twice.
- Receive can put a good line on the job or in a stock location. Short, damaged, and backordered lines do not add available stock.
- Issue posts job cost at the stock cost on the catalog cost code. Return posts the opposite cost. A job-to-job move carries the quantity and reclasses that cost. A yard-to-truck transfer does not post job cost.
- An item at or below its reorder point shows on Today. Order creates one draft purchase order to the preferred vendor. A second click opens that draft instead of adding another line.
- Field can issue from a truck or return leftover to the yard. Field does not see cost. Work > Inventory lists on hand, available, and value, filters by location and low stock, and downloads CSV. A job overview shows materials issued and the quantity on the job.
- Job cost, WIP, and profitability include issued stock. Voiding the movement takes it back. The bills CSV adds inventory issues as job cost. An automation can run on low stock.
- Seed: the yard and Truck 1 hold floor tile. Two shower valves sit below the reorder point. Eight square feet of tile moved from Okonkwo to Brooks with the cost.

### Vendor credits and backcharges

- A vendor credit or backcharge belongs to a vendor and a job. It can point at a purchase-order line, a receipt, a punch item, or a bill. It stores a reason, an amount in cents, a cost code, and a photo. Status is Draft, Issued, Acknowledged, Disputed, Partially applied, Applied, or Void.
- Office starts one from a short or damaged receipt, a punch item assigned to a vendor, or a purchase-order line. The same receipt or punch item is not credited again unless Another credit is checked. Field can propose a draft from a receipt or a punch item and does not see the amount. Office issues it.
- An issued credit reduces job cost on its cost code. Voiding puts that cost back. Paid bills are left as they were. The purchase order shows committed and billed after the credit. Budget, WIP, job profit, and the cash forecast follow it.
- Pay on an approved bill lists that vendor’s open credits. Apply all or part. The cash recorded is the net after retainage and the credit. More than that net, or more than the credit left, is refused. A lien waiver with a blank amount uses the same net.
- The vendor portal lists credits with the reason and photo. The vendor can acknowledge or dispute with a note. A dispute shows in Inbox. Nothing is emailed or texted.
- Work > Vendor credits filters, counts the rows, and downloads CSV. A vendor record shows the open credit balance. A job overview shows the open amount. Today lists disputed credits and unapplied credits older than Credit age days in Settings (7 by default). An automation can run when a vendor credit is issued. The bills CSV adds vendor credits as negative rows.
- Seed: BC-1044 is the short pallet on PO-1044. BC-1045 is the escutcheon punch item. BC-1046 is disputed on Brooks. BC-1047 is partly applied to HP-441.

### Purchase order detail

- The order header uses one status pill. Zero retainage, retained, and released rows stay off the money stack. A plan already on the order is not repeated beside the plan menu. Void sits on that receipt. Comments sit in a narrow column under History.

### Deliveries and three-way match

- An issued purchase order line can carry an expected date. The order shows Not received, Partially received, or Received from its lines. A work order tracks percent complete.
- Receive from the office or the field. The quantity starts at what is still open. A line can be short, damaged, or backordered, and a backorder takes a new expected date. A packing-slip photo is optional. Each receipt records the date and the person, and voiding it puts the quantity back. Field does not see prices.
- A bill linked to a tracked order warns when the amount is past what was received. Approving that bill needs a reason, and the reason is audited. Bill received starts a draft from what arrived and is not yet billed.
- Today lists deliveries expected today and deliveries that are late. A job shows its open deliveries. The 13-week cash forecast dates the remaining purchase-order balance on the expected delivery date. Work > Deliveries filters expected, late, and received, and downloads CSV. Reports includes Deliveries.
- A line can point at a schedule item. A late or backordered line shows on that item, and on the items that follow it.
- Automations can run on Delivery late and Delivery received. Inbox and the audit log record both.

### Purchase orders from selections

- An approved selection, an approved change-order line, or an open budget line that is not already committed can become a draft purchase order or be added to an existing draft. The line keeps the cost code, description, quantity, and unit cost, and a second open line is not created for the same choice.
- A purchase order can be a work order. The commitment is the same. The list, print title, and vendor Orders list show the type. Older orders stay purchase orders.
- Today lists approved selections with no open or issued order after 3 days. A portal confirmation that still needs an order leaves an inbox notice. An automation can create the draft when a selection is confirmed.
- The week overtime total is the sum of the OT and DT columns. An open punch on a fresh demo is recent, and clocking out stays on that row. Add PTO and the payroll CSV sit behind buttons. Time entries show the punch and open an edit sheet.
- The full-width job Gantt keeps the job title and a link back to the job. Inspections, confirmations, and exception days sit in the schedule toolbar.
- T&M ticket numbers are one company sequence, shown as TM-001. Convert sits in the selection bar. The list counts the tickets.

## 2026-10-11

### Overtime and labor burden

- Settings > Time is for an owner or admin. Overtime starts off. When it is on, daily overtime, weekly overtime (40), double time, overtime days, and the 1.5 and 2.0 multipliers use the company workweek and time zone. A labor burden percent applies to the company, and a person can override it.
- Approved minutes in a workweek split into regular, overtime, and double time. Overtime days come first, then the daily thresholds, then the weekly threshold. A minute lands in one bucket. A shift that crosses midnight stays on the clock-in day. Breaks come off before the split.
- Approval posts base labor, the overtime premium, and the burden to the job by cost code. A later approval that crosses the weekly line puts the premium on that punch. A punch already on an invoice stays as posted.
- Job costs list labor, the overtime premium, and the burden. Cost-plus still bills the bill rate. Burden is billed only when the job opts in.
- Shift types are Regular, PTO, Holiday, Sick, and Training. The non-job shifts go to General, count as hours paid, and stay off the job. They do not count toward overtime unless Settings says so. The week grid can add one of those days.
- The week grid shows Reg, OT, DT, PTO, and the burdened cost. Hours over 40 stay amber. Field sees their own Reg and OT hours, and does not see rates, burden, or cost.
- The payroll CSV is one row per person, day, job, and cost code, with regular, overtime, double time, PTO, and the shift type, plus a summary per person. It does not pay anyone.
- Reports includes Labor cost, with the overtime share. Job profitability uses the burdened labor. Today adds one row when someone is on track to hit weekly overtime within the next two workdays.

## 2026-10-11

### T&M tickets

- A job can hold T&M tickets for extra work: date, location, who ordered it, a description, photos, and lines for labor, materials, and equipment. Labor uses the crew member’s bill rate, or the company T&M rate when the member has none. Materials use the price book or a typed line. Equipment uses the register rate. Totals are integer cents, with the job’s cost-plus tax rate.
- On the phone, New ticket is on My day and the job. A company signature moves a draft to Ready for review. The customer’s name and drawn signature mark it Field verified and lock the lines. Field logins do not see cost, price, or margin. The office does.
- The homeowner can sign an unsigned ticket in the client portal. Signed tickets stay there read-only. Request signature only posts a portal notice. No email or SMS.
- Work > T&M tickets filters by job and status and downloads CSV. Field-verified tickets on one job become a draft change order, with prices on the lines and the ticket photos linked, or, on a cost-plus job, lines on the next draft cost-plus invoice. Voiding that draft or sent change order, or voiding the invoice, returns the tickets to Field verified.
- Today counts unbilled field-verified tickets and their total. The job overview shows the same. Automations can run on T&M ticket verified. Inbox and the audit log record the signature. The ticket prints on letter paper, the same way a waiver does.
- Tickets stay online. The offline queue still covers punches, logs, and toolbox talks only.

## 2026-10-11

### Confirmations

- A schedule item with a vendor can be requested once, for that vendor’s next items, or for a date range on the job Gantt. The pill is Requested, Confirmed, or Declined. A decline keeps the reason and an optional proposed date. Accepting that date runs through the cascade preview.
- Moving a confirmed item, including a cascade, a delay, a gate hold, or a Gantt drag, sets it back to Requested and keeps the history. The preview names the items that would reset.
- The vendor portal look-ahead is two weeks, or four. It lists only that vendor’s items, with the job, address, gate, and whether they are cleared to start, plus the plans and pins they can already see. Confirm and Decline use the portal request limit. No email or SMS goes out. The office copies the portal link and the message.
- Work > Confirmations filters by status, vendor, and job, and downloads CSV. Today counts unconfirmed items starting inside the reminder window. Inbox gets a notice when a vendor confirms or declines. Settings can auto-request on assign, off by default, and set the reminder lead in days.
- Automations can run on Schedule item declined and Unconfirmed N days before start, and can Request confirmation. Reports includes a Confirmations report. Request, confirm, decline, and reset are in the audit log.

### Schedule

- A job’s List and Gantt use the full width. Inspections and non-work days open from Inspections and Days.

### Cash

- The header reads Starting balance, and that amount is edited from a sheet.

### Takeoff

- Name, room, height, pitch, estimate, and Use sit in the measurements pane. The toolbar stays on tools and scale.

## 2026-10-11

### Takeoff

- Takeoff opens on a plan sheet, and from Measure on plan on a draft estimate. Set the scale with two points and a length, or a standard architectural or engineering scale. A sheet without a scale says No scale.
- Linear, wall area, area, and count. Area can take a pitch and a depth. Each measurement has a name, a color, and a room. Vertices move. Undo, redo, and delete. Snaps to a vertex already on the sheet.
- A measurement can use an existing estimate measurement or add one. Redrawing it updates that measurement and every formula on a draft estimate. The line says Updated from plan. A sent or approved proposal keeps the numbers it was sent with.
- The side pane lists measurements by sheet, with totals. A new revision carries the scale and the measurements and marks them Review.

### Cash

- Cash, under Reports, is the next 13 weeks. Office and Owner only. Invoices, draws, unbilled change orders, and retainage come in. Bills, open purchase orders, retainage releases, and scheduled labor go out. Net and the running balance sit on the last rows. Past due is the first column.
- Starting balance and the low line are one number each. A week under the line is tinted, and Today gains one row. A customer’s days late defaults to how late that customer has paid, and can be set by hand. Projected turns on unsigned proposals and open leads, drawn lighter.
- The line above the table is the running balance. A cell opens the records behind it. Filter by job or customer. CSV and Print are on the page. The same forecast is a dashboard tile named 13-week cash.

### Job

- Check out and Add punch open from a button. Punch counts sit on one line.

### Today

- Pipeline, To collect, and the dashboard tiles share one tile.

### Schedule

- A job’s Schedule has List and Gantt. The company Schedule has Grid and Gantt. The choice is remembered for that person. Field can look and cannot drag.
- The Gantt lists name, start, finish, workdays, and percent done, with the bars on a timeline that uses the width of the page. The name columns stay narrow so the bars take the rest of the row, including on a job next to Details. Week shows the day number, Month the week start, Quarter the month. Today is labeled. The finish date stays on the schedule title. Phases roll up. Dependencies connect. Non-work days are shaded. A baseline shows as a tick. A gated item says Held.
- Critical uses the longest path to the job finish, with workday lag and non-work days. Critical bars are teal and the rest dim. The item shows float in workdays. A loop is still refused.
- Drag a bar to move it, or its end to resize it. Arrow keys do the same, and Shift changes the finish. A move that pulls other items says how many, and a gate still warns. The audit log records the shift.
- Week, Month, and Quarter change the scale. Print keeps that scale. The company Gantt lists each job as a row that opens.

### Today and reports

- Today’s numbers sit on one row. Rows with a count of one, and no money, sit under More.
- A grouped report heading reads Jul 2026 · 1. Subtotal text stays blank. The bar chart is short, with thin bars. Pinned jobs in the sidebar have space between them.

### Reports

- Reports lists the ready-made reports and any report you save. Pending proposals, AR aging, job profitability, sales by month, time by job and cost code, expiring COIs, and open change orders use one engine. WIP, Variance, and Cash stay in that list.
- A new report picks a record type, columns (including custom fields you can see), filters, a date range, a sort, and one group. A grouped report can show a bar or a line. Count, sum, and average sit on the group, with a total row.
- Save, rename, duplicate, or archive. Share it as Private, Office, or Everyone. Field only opens reports on records that role can already open, and cost columns stay off that view. Every report has CSV and Print.
- An owner can build a dashboard from number, list, and chart tiles, drag them into order, and assign the board to a role. On Today the tiles sit above the existing rows. On My day they sit under the clock. Owner starts with AR 60+, pending proposals, margin, and underbilled. Field starts with today’s to-dos and open punch items. A tile opens its report.

### Custom fields

- Settings > Custom fields holds a company’s own fields for jobs, clients, leads, vendors, to-dos, daily logs, and price book items. A field has a label, a type, an optional default, required, a one-line hint, and who can see it.
- Values sit on the record as key-value rows. Empty rows stay hidden until Edit. Required fields block that save and show Missing on older records.
- Lists can show a custom column from the views menu, filter it, and include it in CSV. Job templates can carry the values the author picks. Import can map a column onto a field.
- A rule can test a custom field and set one. Pull permit is on: an active job with Permit required creates that to-do for the PM.
- A job field can show on the proposal and on print when Show on documents is on.

### Safety and automations

- The job Safety tab counts every talk, checklist, and incident. Talks, checklists, and incidents share one column layout, so the status pill lines up.
- Custom fields use the same column widths in every section. Drag the handle to reorder. Archive sits in the row menu. Visibility and Required are small pills.
- Automation rows wrap inside the sheet. Remove is an icon button. Preview on picks a record and shows the result inline.

## 2026-10-10

### Safety

- Toolbox talks use a company topic library, including Spanish text. Office schedules a talk on a job, assigns a leader, and the leader signs the crew in from My day. A visitor can be typed in. Completing locks the record. A past talk that was not completed is Missed.
- Signing offline queues with the time clock and applies once when the phone syncs again.
- Safety checklists are Pass, Fail, or N/A. A finished checklist records who, when, and a photo on an item. A failed item opens one to-do or one punch, and a second click keeps that link.
- Incidents cover a near miss, first aid, a recordable injury, property damage, and an equipment failure. People, photos, factors, and corrective actions are on the record. Each action is an assigned to-do. Linking equipment marks that item out of service.
- Field can file an incident and see their own. Office sees the company’s. They stay off the client portal, the vendor portal, and client updates.
- Safety is a job tab and a company list. The list filters by type, status, and job, and it prints and exports CSV. Today shows talks missed this week, checklists with a failed item still open, and incidents with an open corrective action. Closeout counts those per job.

### Automations

- The rule editor is a sheet that reads When, If, and Then. Conditions and actions are added with text buttons. The list uses a switch for on, and the run log opens beside the list.
- Incident logged and Checklist item failed can start a rule. Schedule toolbox talk puts a talk on that job a set number of workdays out. Incident schedules a talk is on: a logged incident schedules ladder safety within 2 workdays.

- Settings lists each rule with its trigger, last run, run count, and an on/off switch. A rule is one trigger, optional conditions, and actions that run in order.
- Triggers follow a job status change, a signed proposal, a finished schedule item, an inspection result, a verified punch item, an invoice overdue by N days, vendor insurance or a license expiring within N days, and equipment overdue for return. The daily cron evaluates the time-based ones.
- Actions stay in the app: apply a template’s schedule and to-dos without duplicating them, create a to-do, add a Today row, set the job status, create a punch item from a failed inspection, and hold or release a schedule item.
- A rule runs once per record. A chain stops after three levels. A failed action is logged and the save still completes. Turning a rule off stops it. The audit log records Automation and the rule name.
- Each rule has a run log. Test on a record previews the actions and writes nothing.
- Sold kitchen job, Failed inspection, and COI expiring in 14 days are on. Okonkwo is in the kitchen rule’s log.

### Equipment

- The register lists tools and equipment: name, category, make, serial, tag, purchase date and cost, an optional hourly or daily rate, status, and where it is now. Search and compact filters sit on the list. The detail pane is read-only. Edit opens a sheet.
- Check out assigns a job, a person, or both, with a return date. One assignment stays open. Checking out something that is already out asks to transfer. The history keeps who, when, from, and to. Overdue returns show a count.
- A job page and the field to-do list can check an item out or in. A daily log can tag equipment, which records that job and its address as the last place it was seen.
- Checking an item in from a job with a rate posts one equipment cost: days or hours times the rate, editable before it posts. The same assignment does not post twice. Reverse removes the cost unless it is already on an invoice. Budget versus actual and a cost-plus invoice list it as Equipment.
- A service interval counts days or hours. Today lists overdue returns, service due within 7 days, and equipment still on a job that is closed or in closeout. In service, lost, and retired cannot be checked out. Closeout counts equipment still on the job.
- Tag labels print with a QR code drawn on this machine. The code opens that item.
- The list filters read Status: Any and Location: Any. New opens the sheet. The location column shows the full job name.

### Markup

- A job photo opens in an editor: pen, arrow, rectangle, ellipse, text, teal plus red, yellow, black, and white. Undo, redo, and delete. Save keeps the original and stores the layer plus a flattened image. The record shows the marked-up photo, a Marked up pill, and a toggle for the original. The audit log has who and when.
- A plan revision opens fitted to the view, with zoom and pan. Tools are icon buttons. Save sits in the header. A numbered pin links to a punch item, an RFI, or a to-do. The record shows a crop around the pin. Pins use teal for open and a neutral pill for done or verified. The pin list filters by type and status with compact controls. A new revision carries the pins forward and asks to review them. The old revision keeps its pins read-only.
- The client portal shows a markup or a pin only when that item is already shared. The vendor portal shows a pin only when it is linked to that vendor’s item. Internal notes stay off both.
- Punch list and RFI print include the plan crop and the marked-up photo.
- Okonkwo A-101 rev 2 has two punch pins and one RFI pin, plus a marked-up curb photo. Rev 1 keeps one superseded pin.

### Inspections

- The inspection detail shows the date, and a schedule item, gate, or file only when one is set. The name and the result stay in the title and the pill. Edit opens a sheet with Save and Cancel. Correction notes show once.

### Schedule

- A gated item shows Held. The person column stays put when the board scrolls. A holiday column shows its name, and other non-work columns say Off.

### Permits

- A job holds permits: type, number, jurisdiction, status, applied, issued, and expiry dates, and an optional fee. The fee posts one job cost to the chosen cost code. Office edits. Field sees the number and status.
- Inspections sit on a permit. A failed or partial result turns the correction notes into to-dos. Request re-inspection opens the next attempt and keeps the earlier ones.
- An inspection can gate later schedule items. Settings chooses Off, Warn, or Block. Warn is the default. The schedule shows the gate on the item and the inspection as a milestone, on the job, the crew board, and the calendar feed.
- Today counts inspections in the next three workdays, failed inspections with no re-inspection, and permits that expire within 30 days.
- Bathroom and Kitchen templates carry a building permit and an inspection sequence. Closeout counts a permit that is not Closed and an inspection that has not passed.
- The client portal can list passed inspections, name and date. The vendor portal lists an inspection when it gates that vendor’s item, date and result.
- Brooks has an issued building permit, a passed framing inspection, a failed rough plumbing inspection with two to-dos and a pending re-inspection that gates drywall, and a permit that expires in three weeks.

### Schedule

- The variance report wraps the job name, hides reason columns that are zero on every row, and lists jobs with a baseline. All jobs shows the rest.
- Each schedule item shows a baseline tick. The variance in workdays is on the item.

- Settings holds company non-workdays and extra workdays. A job can add its own. Lags, cascades, template starts, to-do offsets, and RFI shifts use those days. The schedule grid shades non-workdays. Rivera has US federal holidays for this year and next, and Brooks works one Saturday.
- Set baseline freezes each item and the job finish. Setting it again keeps the earlier baseline, with who and when. The job schedule shows baseline against current and the variance in workdays.
- Moving an item past its baseline asks for a reason. A cascade logs that reason once, on the root item. Delays stay off the portal and out of client updates. Field cannot edit.
- Schedule variance lists each open job: baseline finish, current finish, variance, and delay days by reason, with CSV and print. Today counts jobs 5 or more workdays past baseline. Brooks has a baseline and two delays.

### Costs

- Markup, tax, and cost-code percents sit on one line. Edit markup opens a sheet. The date range uses the list date filter. Billed and non-billable rows leave the checkbox cell empty. Non-billable sits on the selection bar. The invoice preview is a pane with lines, markup, tax, and total.

### Cost-plus

- A job can bill cost-plus, with a markup percent and a tax percent. A cost code can use its own markup. Draws and progress jobs stay as they are.
- Approved bills, posted receipts, and approved time (hours at the person’s bill rate) show as Unbilled, Billed with the invoice number, or Non-billable. A draft invoice takes the checked costs, grouped or itemized, with markup in the line or on its own. Tax is on the marked-up total. A cost stays on one invoice. Voiding the invoice puts those costs back to Unbilled. A billed bill or time entry cannot be edited.
- The portal and the print view show those lines. Internal notes stay off both. Field roles do not see markup or bill rates.
- Ellis kitchen is cost-plus: an old cabinet bill still unbilled, a plumbing bill, a Mill & Co receipt, and four hours on one draft, plus a non-billable scrap. Today counts cost-plus jobs with unbilled costs older than 14 days.

### Client updates

- The update editor is one block per section. Each block grows with the text. Sources show the record’s title and date and open that record.
- The portal gives each section a heading. The photo is shown once, with its caption. The draft says what happened, such as a walk on a date or a pick that is past due.

- On a job, office can draft a client update for a date range. The range defaults to the last seven days on the job’s clock. The draft uses published client logs, schedule items, approved or pending change orders, invoices sent or paid, and selections due in that range.
- The draft is the local stub. It does not call out. Sections are This week, Next week, Decisions needed, Money, and Photos. Each sentence keeps the record it came from. Delays, safety notes, crew, hours, costs, bills, and purchase orders stay out.
- Office edits the text, keeps or drops photos, and publishes. Publish puts it on the client portal only. The portal lists published updates newest first. Opening that page records Viewed. A later edit keeps the earlier version. Unpublish asks for a reason. Draft, edit, publish, view, and unpublish are on the audit log.
- Okonkwo has one published update and one draft. Today counts active jobs with no published update in seven days.
- Add assembly sits on the same row as + Add line.

## 2026-10-09

### Measurements and quantity formulas

- An estimate has a Measurements list: name, number, and unit (sf, lf, ea, sq, cy). A lead’s square footage becomes Floor. Vasquez kitchen starts with Floor 240 sf, Walls 410 sf, Backsplash 38 sf, and Base 62 lf.
- A line can take its quantity from a formula over those measurements, with a waste percent and an optional round-up to the purchase unit. The quantity shows an fx mark. The formula reads in the numbers it produced, such as 410 sf × 1.10 → 451, rounded to 480 (15 × 32 sf).
- Changing a measurement recalculates every line that uses it, and the cost, price, total, and margin. Typed quantities stay put. Deleting a measurement that lines use is blocked and names the count. A bad formula is refused with a plain message.
- A sent proposal stores the computed quantity. The client sees numbers only. Price-book items and cost-code template lines can carry a default formula and waste, and a new line with that code picks them up when the measurements exist.
- The estimate draft uses those measurements. It marks a line needs-measure only when a formula’s measurement is missing.

### Assemblies

- A price-book assembly has a name, a driving measurement (area, length, or count), and parts. Each part is a catalog item or a free line, with a formula on that measurement, a waste percent, and an optional round-up. Rivera starts with Tile shower wall, Interior wall paint, and Base cabinet run. Assemblies can be edited, duplicated, or archived.
- Add assembly on an estimate picks the assembly and a measurement, new or already on the job. The parts land as a collapsible group with the assembly name, the measurement, and the group total. Changing the measurement recalculates the group. A line can be overridden, removed, or the group can be ungrouped into ordinary lines. Deleting a measurement that a group uses is blocked.
- A sent proposal stores the numbers. Each group shows as one line with the group total, or as its parts when that group is set to parts. The draft can name a matching assembly. It does not insert the parts.
- Comments sit in the estimate side pane. Measurement rows use an actions menu. A low-confidence line keeps that percent on the item, not as a pill.

### Purchase order detail

- A purchase order opens as a compact header: number, status, vendor, and job, with Edit, New bill, Print, and a more menu for close, void, and release. Amount, committed, billed, open, retainage, and the plan are key-value rows. Lines show billed and remaining. Linked bills sit in their own table. Edit is a sheet with Save and Cancel.
- New bill on that order starts with the vendor, the job, and each line’s remaining amount. Retainage comes from the order. A line past the remainder uses the same over-purchase-order warning.
- Bills, change orders, and bids use the same header. Ready to pay has one Blocked by column and one pill on a row. Vendor cost codes sit in a disclosure under the vendor.
- Okonkwo PO-1055 lists HP-510 and HP-511, with $3,000 billed and $2,000 remaining on the shower line. Lines and Bills are labeled. Comments is one heading and one field on purchase orders, bills, change orders, and estimates.

### Ready to pay

- Bills has a Ready to pay view. A bill is ready when it is approved, the required waiver is signed for the company’s Off, Warn, or Block setting, and required certificates are current when that setting blocks. Approved bills that are not ready show one reason, such as Waiver unsigned, COI expired, or Over PO. The totals row is the count and the net dollars.
- Checked ready rows can be marked paid with a date, method, and reference. Block refuses a bill that is not ready, including a bulk request. Mark paid still sends no money. The unconditional waiver can be requested for that batch.
- A purchase order holds a percent from the vendor or the company, otherwise 0. Each linked bill keeps retainage and a net payable. Release retainage writes one bill for the held amount, and Block waits for a signed final waiver. Job cost stays the full bill. Cash is the net.
- The vendor portal lists that vendor’s bills with paid, retained, and released amounts. Field and the client portal do not see bills. Today counts bills ready to pay, and retainage still held on closed jobs.
- The bill CSV adds Retained, Net, and Released. Okonkwo PO-1055 is Harbor at 10%. HP-510 is ready. HP-511 is waiting on a waiver.

### Compact controls

- List toolbars, selection bars, sheets, and detail panes share one control size: 24px tall, only as wide as the label, capped at 260px. A form row still stretches.
- Bills with rows checked is one line: count, waiver type, Request waiver, Clear. Job files keeps the date, size, and revision on one line, and the file pane uses the same file button as the rest of the app.
- A check across the office, the client portal, and the vendor portal fails if a bar or pane select grows, a raw file button shows, or a date, size, amount, or status cell wraps.

### Job files and bills layout

- Job files: Upload sits in the toolbar and opens a sheet for the file and folder. The folder starts as the one you are viewing, or the selected file’s folder. Selecting a row opens the file beside the list: name, folder, revisions, visibility, a new revision, share history, and delete. Folder add, rename, and archive are in the toolbar menu. Checked rows can move, change visibility, or download. Sidebar names stay intact, with a small visibility pill. Seeded plans show as 860 KB and 1.4 MB.
- Bills: Request waiver appears after you check rows, and the type is chosen there. The job column is the job name, full text on hover. Draft, Approved, Paid, and Void are the same kind of pill. Vendors is a numeric table, with cost codes indented under the vendor.

### Job files

- A job has a Files tab. Company defaults start as Plans, Specs, Contracts, and Photos. The office can add, rename, or archive a folder on the job or in Settings.
- Each folder is Team, Client, or Subs. A file can override that. Field sees those folders and can add a photo. A vendor upload sits in a folder only that vendor and the office can see.
- A plan keeps older revisions. The newest is Current. The rest stay Superseded, with the revision, the date, and who uploaded it. Portals show Current unless the office shares history.
- Attached lists files already on an RFI, submittal, bill, punch item, daily log, bid, or purchase order, and links back. Field does not see money files. A vendor does not see another party’s files.
- The client portal lists client folders. The vendor portal lists sub folders for jobs that vendor is on. A bid or purchase order can point at the current plan, and that file shows on the vendor’s bid or order.
- Upload, revision, visibility, and delete are on the audit log. Delete hides the file.
- Okonkwo Plans holds A-101 floor plan, revision 2 current and revision 1 superseded. Specs and Contracts stay with the team. Photos is on the client portal. Harbor Plumbing is the vendor folder.

### Lien waivers

- Four waiver types: conditional progress, unconditional progress, conditional final, and unconditional final. Settings holds the company wording for each. The seeded lines are templates.
- Request one from a bill, or several from Bills. The amount starts as the bill amount and the through date starts as the bill date. Status is Requested, Signed, or Void.
- Harbor’s portal lists only Harbor’s open requests. A typed name stores the name, the time, and the exact text. That text does not change after signing. The office can also file a signed paper copy. Print is a letter page.
- Mark paid can be Off, Warn, or Block when the conditional waiver is unsigned. Warn is the default. After a bill is marked paid, one click requests the matching unconditional waiver. A final waiver is the one for a closed job or the vendor’s last open bill. Mark paid still sends no money.
- The bill shows the waiver, the vendor shows open requests, and Today counts waivers still unsigned on bills that are paid or due within 7 days. Bills filters Missing, Requested, and Signed. The CSV includes that status.
- HP-220 is Harbor’s signed conditional progress waiver. HP-442 is requested and unsigned, due this week. SL-1904 is paid on the closed Diaz job with no unconditional waiver.

### Submittals list

- The company list opens on open submittals, so SUB-001 and SUB-002 both show. Overdue still narrows the list when you set it.
- The Overdue control fits its label. The filter row lines up with the title and the table on Submittals, RFIs, Bills, and Clients.

## 2026-10-08

### Submittals

- A job numbers submittals SUB-001 and up. A voided number stays taken. Each one has a title, a spec note, a division, a due date, an assignee, and an optional link to a schedule item, selection, purchase order, or bid.
- Status runs Draft, Submitted, Under review, then Approved, Approved as noted, Revise and resubmit, Rejected, or Void. Revise and resubmit keeps the prior files and the review note, and the next send is a new revision. Each change is on the audit log.
- Office reviews from the job or from Submittals under Work. Harbor’s portal lists only Harbor’s submittals and can send one. The Okonkwo client portal reviews one only when it is assigned to Amara. Neither portal sees the office note.
- The company list uses the same filter row as the other lists. Filter by job, assignee, status, division, overdue, or waiting on review. CSV and Print are on the list. Today counts submittals that are overdue and the ones waiting on you.
- Okonkwo SUB-001 is Harbor’s shower valve cut sheet, past due, on revision 2 after a revise note. SUB-002 is the tile sample, under review with Maya.
- Office photo and file pickers use the same button as the portals. The button shows the file name. The browser’s file control stays off the page.

### Lists

- To-dos, RFIs, Bills, Purchase orders, WIP, Clients, Leads, Jobs, and Inbox share one filter row. Each control shows its current value, such as Assignee: Any, and the list updates when it changes. Clear removes them. On a phone the row sits behind Filter.
- A saved view stores that list’s filters for one person. Pin makes it the default. Office can share a view with the company. Maya has My overdue and Awaiting answer. Dana has This week and High.
- A checklist row shows the item, the person, and the date. Click the row to edit it. Enter saves and Esc cancels. Move and Delete sit in the row menu. Checks on a to-do list shows the first items under the title.
- Dates read Oct 7 this year, Oct 7, 2025 in another year, and 2:30 PM for a time.
- A selected table row stays a light teal tint, and a job name truncates instead of wrapping.

## 2026-10-07

### To-dos

- A to-do has a title, notes, priority, tags, assignees, photos, and a checklist. Each checklist item can have its own person and date. The row shows progress, such as 3/7. Checking the last item offers Mark to-do done. Unchecking an item on a done to-do opens it again. Every completion is on the audit log.
- The deadline is a date, or a number of workdays before or after a schedule item’s start or finish. Moving that item, including a cascade, moves the to-do. The Moves count includes those to-dos. Deleting the schedule item keeps the last date and shows it unlinked.
- A reminder of N days before the deadline lands in Inbox for the assigned people. Nothing is emailed or texted. Today shows one Overdue to-dos row with the count.
- Field sees and ticks only items assigned to them. A vendor portal shows only that vendor’s items, and they can tick one and attach a photo. They do not see money or another job. Office filters the list by assignee, job, priority, due, and status, sorts by due date, and can complete several at once.
- Bathroom remodel and Kitchen remodel include a Pre-drywall walk checklist tied to rough plumbing. A new job can copy those to-dos with the schedule.

### Work in progress

- Reports holds a WIP page for the owner, an admin, and office. Field does not see it. One row per open job, plus a total. The as-of date rebuilds the month from records dated on or before that day. Filter by PM or status. A row opens that job’s cost codes. A projected-cost override needs a note and shows on the row.
- CSV downloads the rows on screen. The filename carries the as-of date. Print is a landscape page. Today lists Underbilled with the count and the dollars. A selected row uses a light teal tint so a red underbilled amount stays readable.

### Job templates

- A schedule item can depend on another item finishing first, with a lag in company workdays. Moving or extending that item shifts the items that follow. A loop is refused. The count shows before the save, as in Moves 4 items. An RFI schedule impact uses the same shift. The change is on the audit log.
- Templates live under Work. A template holds a schedule with offsets and trades, estimate lines, a draw schedule in percent, selections with allowances, and a punch list. It does not keep a client, a vendor price, or a photo. Saving a job as a template asks which parts, with a count on each, and drops the client, the dates, the actuals, and the statuses.
- A new job picks a template, the parts, a start date, a PM, and a vendor for each trade. Dates land on workdays. Draws are rescaled so they match the contract to the cent. An empty template is refused. Importing into a job only adds rows. The job keeps the template name and version it was made from. Later edits to the template do not change that job. Field does not see template money. Office manages templates. Writes are rate limited and audited.

### Comments and Inbox

- A job, estimate, change order, purchase order, bill, RFI, punch item, daily log, or schedule item can hold an internal comment thread. Text keeps line breaks. A photo uses the same upload check as the rest of the app. The author can edit for 15 minutes and can delete their own comment. Both are on the audit log. Posting is rate limited. Client and vendor portals do not show these comments. Field can comment on jobs they can see, and cannot see comments on estimates, change orders, purchase orders, or bills.
- Typing @ opens the people who can see that record, plus Office, Field, and Admins. A mention is stored as a person or a role, and it shows as a neutral pill. Mentioning someone who cannot see the record is refused. A person named and included by role gets one notice. The author is not notified.
- Inbox sits in the sidebar with the unread count. A row shows who, the job and record (RFI-001, CO-3), a one-line snippet, and the age. Notices are created for a mention, a reply in a thread you joined, an assignment on an RFI, punch item, or schedule item, and a vendor or client answer on an RFI you asked. Opening a row marks it read. Mark all read, and filter Unread, Mentions, or All. j and k move, Enter opens the record at the comment. Today has one Mentions count that opens Inbox. Each person can take mentions only, or all activity on their jobs. Nothing is emailed or texted.
- Number, date, age, and money columns stay on one line with tabular figures. Portal photo and file controls are a button that shows the chosen file name and a remove control.

### Requests for information

- A job can hold an RFI: a short title, the question, a due date, and an assignee. The assignee is a teammate, a vendor already on the job, or the client. It can point at a schedule item, selection, purchase order, bid, punch item, or change order, and it can carry a photo. Numbers run RFI-001, RFI-002, and so on for that job. A voided number is not reused. Status is Open, Answered, Closed, or Void. Field can add one from the job on a phone.
- The assignee answers in the office, on the vendor portal, or on the client portal. A vendor sees only the RFIs assigned to them. A client sees only the RFIs assigned to them. An answer can include a photo. The office closes it after review. No email or text goes out. Portal answers share the same request limit as the other portal forms.
- On the way to an answer or a close, the office can mark a cost impact, a schedule impact in days, or both. Cost impact can draft a change order from the question and link it back. Schedule impact moves the linked schedule item by those days and keeps its length. Create, answer, close, and impact are on the audit log. Field does not see the cost amount. Vendors and clients do not see another party's RFIs or internal notes.
- The job shows a table with number, title, assignee, due date, age in days, status, and impact. Linked items list their RFIs. Today counts RFIs overdue and RFIs awaiting your answer. A schedule item with an open RFI past due shows a small RFI mark. The company list filters by job, assignee, status, and overdue. Each job has a print log and a CSV.

### Draws and progress billing

- A signed job gets a draw schedule from the company defaults in Settings. Each draw is a percent or a fixed amount, optionally tied to a schedule item. The due date is that item’s end plus the company terms, or a date. The rows have to equal the contract, including approved change orders, to the cent. An invoiced draw cannot be edited. When the linked item is done or its date has passed, the draw is Ready to bill. Today counts those draws and the dollars. Billing creates a draft invoice and a pay link. No email goes out.
- An approved change order is its own draw, already invoiced, or it can be rolled into the next open draw. It is not billed twice.
- A job can bill by percent complete instead. The schedule of values is the signed budget plus approved change orders. The office enters a percent or a dollar amount for this period. The columns are scheduled value, previous, this period, total to date, percent, balance, and retainage. A line cannot go past 100%. Each application freezes the previous column. Voiding the latest one restores it. Retainage defaults to 0, is set per job, and is released after closeout.
- The client portal lists the draws and the pay application lines. It does not show cost or margin. The number strip adds Retained when retainage is held. The job summary shows billed to date, percent billed, percent complete, and an underbilled or overbilled amount. The jobs list has a Billed column. A pay application has a print page with those columns. The QuickBooks invoice CSV includes the draft draw and progress invoices.

### Bid requests

- The office can ask two or more subs to price the same scope on a job. Lines come from the job budget, with a quantity and a unit. The vendor portal shows the request. No email or text goes out.
- A vendor enters a unit price or marks a line no bid, types a name, and can attach a photo. They can change it until the due date or until the office awards the work. After that the request is read-only. They can decline the whole request. They do not see another vendor's price, the budget, or the client price.
- The comparison is a table: lines down, vendors across, the low price marked, and a variance against the budget. Award one vendor or split lines. Award writes a draft purchase order for each winner and can update those budget lines. The others are marked lost. Changing the lines after a price comes in asks the vendors to bid again. Today counts bids due in the next three days and bids waiting on an award. A company set to block cannot award a vendor whose required certificate is expired or missing.

### Sub and vendor portal

- A sub or vendor has one portal link. The office creates it from the vendor record, and a new link replaces the old one. The secret is stored as a hash. The link is shown to copy. No email or text goes out.
- The portal lists that vendor's issued purchase orders, schedule days, punch items, and bills. Draft and void orders stay off it. Accept takes a typed name. Decline takes a reason. Both are on the audit log. A bill from the portal is always a draft, with the same duplicate bill number check and the same over-order warning. Today counts those drafts until the office reviews them.
- Certificates are general liability, workers comp, license, W-9, or other, each with an expiration date and a file. The vendor or the office can replace one. The vendor list shows Current, Expires in N days, Expired, or Missing. Settings can warn or block a new purchase order when a required certificate is expired or missing. Warn is the default. Today counts vendors with a certificate expiring within 30 days or already expired.

### Punch list and warranty

- A job has a punch list. Each item has a title, a room, an optional cost code, a crew member or a vendor, a due date, and a status of open, done, or verified. Before and after photos use the same rules as job photos. The office can verify an item and share it with the homeowner. The job page shows open, done, and verified counts.
- Field can add an item and mark one done with a photo from My day. That stays online. The office marks a job substantially complete, then sees a closeout count for punch still open, a missing or draft final invoice, draft change orders, draft bills, issued purchase orders, and unapproved time. Close is allowed when those counts are zero, or with a reason that is stored on the audit log. Closing sets the warranty end from the company default, and that default is editable per job. Reopen is on the audit log too.
- A closed job inside the warranty window accepts a request on the client portal: title, description, urgency, and up to three photos. The homeowner sees status and the end date. Outside the window the form is hidden and the end date stays. The office assigns a visit, which shows on the crew schedule, then resolves or declines with a note the client can read. An optional cost code posts job cost. Today counts open warranty requests. No email or text goes out. A visit note is there to copy.

### Lead form

- Settings has a lead form for an owner or admin. Turn it on, choose the fields, and set a short intro and thank-you line. Name is required, plus an email or a phone. Address, project type, budget, timeline, description, and up to three photos are optional. The page shows the public link and an embed snippet. A new link replaces the old one.
- The public page uses the company name. A request creates a contact and a lead in the first stage, source Website form. An email or phone that already belongs to a contact in that company reuses the contact. The description is read for project type, size, and value hints. Photos follow the same rules as job photos. Today counts new web leads until someone opens them. The lead shows the answers. The pipeline can filter by source.
- A hidden field, a short wait, and per-address and per-company limits sit on the form. A form that is off says it is not taking requests. One company's link cannot write into another company. No email or text goes out.

### Selections

- A job can hold selections, each with two or more choices and an optional allowance from the signed budget. Release puts it on the client portal. The homeowner picks one and types their name. The office can approve on their behalf, reset it, or lock it.
- The chosen cost posts to that allowance’s cost code. An overage can become a draft change order. A credit is shown and left alone. An unlinked choice becomes a draft change order only when the office asks for one. The contract does not move until a change order is approved.
- Field sees the name and the chosen item. The client sees prices, not cost. Another company gets a 404. Release, choose, approve, reset, and lock are on the audit log.

### Import

- An owner or admin can import contacts, subs and vendors, or price book items from a CSV or a pasted spreadsheet. Templates are on the import screen. Common headers map themselves, including a QuickBooks customer export and a contacts export with address columns. Each column can be remapped before anything is saved.
- The review step counts new, update, duplicate, and error rows. A bad email, a missing name, a negative amount, an amount over $10,000,000, or an unknown unit stays on the row. A match on email, phone, or name can be skipped or used to update. A price row with cost and margin fills in the other side. An unknown cost code is created under General, or mapped to one that already exists.
- The import is one batch. Undo removes rows that import created and puts back fields it changed. A row already used on an estimate or a job is left in place. Field and portal logins do not get the screen. A new company sees a four-step list until the first proposal is sent.

### Schedule

- Schedule is a week grid of crew against days. An empty cell adds an item. A chip opens the same sheet to edit the job, the title, the days, and who is on it. Drag a chip, or move it with the arrow keys and save with Command-Return. Week and two weeks share the company calendar.
- A person on two different jobs the same day shows a conflict on the chip and in the count. The item still saves. The job page lists that job’s items and adds from the same sheet. My day shows today and tomorrow for the signed-in person. Field can look, not edit.
- Settings can create a calendar link for the signed-in person. The link is a secret stored as a hash. A new link replaces the old one. The feed is a read-only calendar of that person’s items.

### Client portal polish

- The homeowner portal opens with the company, the job, and the address, then Contract, Paid, and Balance. Contract is the signed proposal plus approved change orders. A Needs you row appears only for a change order waiting on approval, or an open invoice, with one Approve or Pay button.
- Progress lists only the dates that exist: signed, deposit paid, first shared log, a later shared log, and a final invoice. Change orders show a signed amount and a sentence-case status. Shared logs show the date, notes, next step, and photos. A photo opens in a lightbox that closes with Escape. Messages stay at the bottom, and a photo can be attached.
- The proposal page leads with the company, the title, who it is for, the price, the deposit, and the scope. Optional lines and allowances stay labeled. Sign and decline behave as before. The pay page uses the same header.

### Mac time review

- On a laptop, Time is a week grid. The office steps through the company workweek, switches day, week, or pay period, and approves every submitted punch from one button. Hours over 40 show in amber. Labor cost is the approved snapshot only. Field logins do not see rates or cost.
- Someone on site shows with the job, the clock-in, and a running duration. The office can clock them out with a reason. A selected person opens their entries. Check the ones to approve, or edit the times and save them approved in one step. Approved time stays locked. Command-Z reopens the last approval.
- The phone clock is unchanged.

### Mac estimate builder

- On a laptop, an estimate opens as a dense grid beside a live client preview. Tab, Enter, and Esc move through cells. Command-Enter or Control-Enter adds a line. Backspace on an empty row removes it, and Undo puts it back. Groups collapse, and lines move by drag or option-arrow. The totals bar shows cost, price, and margin. A target margin reprices the job, or one group, after a preview. Optional lines and allowances show on the preview and the proposal. Optional and excluded lines stay out of the total. The phone keeps the simple line list.

## 2026-10-05

### iOS shell

- The phone shell uses a Deep Teal accent, the iOS grouped background, and the SF system font. Light and dark follow the system color scheme. A blurred tab bar sits on Today, Jobs, Leads, Time, and More. Field logins get My day, Jobs, Time, and More, and still open the pipeline from More. The large title collapses to an inline title while the page scrolls. Touch targets are at least 44 points, presses scale unless motion is reduced, and the layout uses the safe area.
- Today and the jobs list use grouped inset rows and status pills. Desktop keeps the sidebar.

### Purchase orders

- An owner, admin, or office user can write a purchase order for a sub or vendor on a job. The number is assigned automatically and stays unique in the company, including after a void. A draft does not commit cost. Issuing it does. Closing it releases whatever has not been billed. Voiding it needs a reason. Revising an issued order keeps the previous lines in the history. Nothing is emailed.
- A bill can be linked to an issued or closed order. An approved or paid bill reduces that order’s open commitment on the same cost code, and the remainder never goes below zero. A bill that runs past the order is saved anyway, with a warning.
- Each cost code on the job shows budget, open commitment, actual, projected, cost to complete, and variance. Projected is the greater of the budget and actual plus open commitment. The 80% watch and the overrun change-order draft use actual plus open commitment, so a promise with no bill still counts, and a code that is only 80% spent still warns. A change order that already covers the overrun does not suggest a second draft.
- Vendor totals include the issued purchase-order amount and what is still open. Today lists issued orders with no bill after 30 days on the company clock.
- Field logins and the client portal do not see purchase orders or amounts. Another company gets a clean miss.

### Sub and vendor bills

- An owner, admin, or office user can enter a sub or vendor bill on a job: bill number, dates, and one or more cost-code lines. A text file can be read with the same local receipt reader. A low-confidence read stays a draft until someone confirms it. Nothing is approved by the reader.
- Approving a bill posts each line to that job’s cost once. Unapproving or voiding (with a reason) takes those costs back off and writes a history row. Marking a bill paid records the date, method, and reference only. No payment is sent.
- The same 80% budget warning and overrun change-order draft use those posted costs. The same vendor and bill number in one company is flagged before save. Due and overdue follow the company time zone. Today lists bills due within seven days and bills that are overdue.
- Field logins do not see bills or amounts. The client portal does not either. Another company gets a clean miss. A phone punch id is matched only for that person and company, so a reused id cannot reveal or block someone else’s punch.

### Offline time clock

- A crew member who opened My day or Time while online can clock in, start or end a break, switch job and cost code, and clock out with no signal. Each punch is written to IndexedDB at the moment of the tap, with a client id and the phone's clock. The screen says it is saved on the phone and will sync. A dropped punch is not silent.
- When the phone can reach Fieldline again, the oldest punches go up in a batch. The server keeps the capture time as the punch time and stores a separate sync time. Sending the same batch twice does not create a second punch. A phone clock more than two minutes off, a future time, or a punch older than seven days is kept and listed under Time anomalies for the office. So is a clock-out with no open punch, an overlapping clock-in, a punch inside approved time, or a job or cost code that was removed before sync.
- If the session expired or the person can no longer clock in, the phone keeps the queue and asks them to sign in again. It will not sync those punches under a different person or company. Signing out warns when punches are still only on the phone, then clears that person's queue.
- Daily log notes autosave on the phone while offline and post as a draft later. Photos, manual time, approvals, and office edits stay online. The offline banner says which of those work. The cached clock page has no names, rates, or another company's data. The service worker still does not cache API responses or office pages.

### Company time zone

- Each company has an IANA time zone and a workweek start day. Rivera is America/New_York. Northline is America/Los_Angeles. A new company takes the browser zone and starts the week on Monday. An owner or admin changes both in Settings. The change writes a before/after audit row and does not move stored clock times.
- Days and weeks use that clock: punches, the 40-hour flag, payroll CSV dates, daily logs, My day, and the missing-log nudge. A shift counts on the local day it clocked in. The week starts at local midnight and runs seven calendar days, so the spring-forward day is 23 hours and the fall-back day is 25. Unlocked week totals regroup. Approved labor on the job stays as it was.
- Follow-up drafts still wait a fixed number of hours after a proposal is sent or viewed. They do not snap to a local midnight. There is no overtime pay math and no weather service.

### Daily logs

- A job has one log per person per UTC day. Save a draft, then publish. The date cannot be in the future. Notes are the only required field. Weather, delays, deliveries, visitors, and safety sit behind a disclosure. Photos use the same camera capture as the job.
- Crew headcount and hours by cost code come from that day’s punches, including time the office has not approved. The log does not show rates or labor cost.
- Logs are internal until an office role marks a published log client-visible. The portal then shows the work note, what’s next, hand-entered weather, deliveries, visitors, and that log’s photos. Delays, safety notes, crew names, hours, and costs stay off the portal. Nothing is emailed. Once a log is on the portal, only the office can edit it.
- Edits after publish keep a history row. A log is voided with a reason, not deleted. Today lists jobs that had punches yesterday and no published log. Copilot answers “what happened on a job yesterday?” from published logs and cites the log. Weather is typed. There is no weather service.

### Time tracking

- A member clocks in on a job and cost code from the Time screen, switches jobs without a separate clock-out, takes a break, and clocks out with an optional note. They see today and this week. They do not see rates or labor cost.
- The office sets an hourly cost (a company default, or a rate per person), reviews pending punches, edits them, and approves them. A manual punch needs a reason. Approval posts hours times the rate at that moment onto the job budget by cost code. Unapproved time is not a cost. Approved punches are locked until someone reopens them with a reason.
- Every create, edit, approve, reopen, and void keeps who, when, before, after, and the reason. A punch is voided, not deleted. Today and the review list flag a shift still open after 12 hours, more than 40 hours in a Monday–UTC week, and overlapping punches. Nothing closes by itself.
- Location is optional, once per punch, from the browser. A denial still clocks in, and only coordinates are stored. Payroll export is a CSV of approved hours per person per day for an owner or admin. There is no wage calculation and no payroll provider.

### Team invites

- An owner or admin invites a teammate from Settings by email and role (admin, office, or field). Fieldline does not send email. The page shows a link and a short message to paste. The link is shown once.
- The token is 32 random bytes. The database stores only its SHA-256 hash, bound to the company, email, and role. Admin invites expire in 48 hours. Office and field invites expire in 7 days. Accepting is a single use, in one transaction with the membership insert. Inviting the same email again revokes the earlier pending invite. A bad, used, expired, or revoked link returns one generic error. The link host comes from `APP_URL`.
- The accept page previews the company, role, and inviter without joining. The signed-in email must match the invited email. Demo login and Supabase Auth both work. A field login can see jobs, notes, photos, tasks, and receipts, and cannot see prices, invoices, or the team controls.

### Onboarding

- Sign-in offers Start a new company. That creates an empty org, an owner, and a sales pipeline. The Rivera demo login is unchanged, and the new company does not see Rivera rows.
- An optional starter price book (kitchen and bath, deck, roofing, or general) is inserted only for that company and marked starter, edit your prices. The same choice is on an empty price book.
- Today shows a setup checklist derived from the license, price book, leads, estimates, and sent proposals. Hide it there, and bring it back from Settings or More. Send proposal stays a button. Nothing is emailed.
- Empty office lists say what belongs there and link to the action that fills them. The seeded demo still shows its jobs, leads, and invoices.

## 2026-10-04

### Tester readiness

- Playwright (Chromium) runs the kitchen job, a change order, and a follow-up draft against `next start` on a throwaway seeded database. `npm run e2e` is separate from `npm run check`.
- Approving a follow-up keeps the “sent” note on the page after the draft leaves the list.
- Send feedback stores a note, the page path, and optional context on the company. An owner or admin can read them. Nothing is emailed.
- A crash in the office, portal, proposal, or pay page shows Try again and a short reference. The same id is written to the server log. There is no error-tracking account.

### Mobile / PWA

- Install icons are 192 and 512 PNG, plus the SVG mark and an Apple touch icon. The manifest stays standalone and starts at `/`.
- The service worker caches that shell and content-hashed `/_next/static` files. Pages, server payloads, and API routes stay on the network. There is no offline outbox.
- Job and estimate photos open the rear camera. A large shot is reduced in the browser before upload. Receipts stay text files. No image is sent to a vision service.
- The office shows a small banner while the browser is offline and clears it when the connection returns.

### Photo context

- Drafting reads each photo caption and the words in the file name, not the raw filename alone.
- A line that only a photo triggered stays at 56% confidence and says it needs a site check. A caption that agrees with the written scope scores higher.
- Quantities still come from dimensions in the scope. A guessed quantity says it needs a site measure.
- The estimate review page lists photo-driven and low-confidence lines. Sending the proposal stays a button.
- When `AI_GATEWAY_API_KEY` is set, the prompt includes those captions. Unknown codes are dropped, and a failed call uses the local matcher. No image bytes are sent.

### QuickBooks CSV

- Customers download as `fieldline-qbo-customers.csv` with DisplayName, name, email, phone, and billing address columns for Import Data.
- Invoices download as `fieldline-qbo-invoices.csv`, one row per positive line, repeating InvoiceNo. Tax code is NON. Zero and negative lines are omitted.
- Import customers first. Customer must match DisplayName. QuickBooks Online accepts about 100 invoices and 1,000 rows per file. There is no Intuit connection.

### Office RLS

- When Supabase Auth is on, `getClaims()` must verify the member before contacts, pipeline, jobs, invoices, or the signed-in company are read. On Postgres those queries run as role `authenticated` with the user's JWT, not as the table owner.
- Portal, pay, Stripe webhooks, follow-up cron, and seed still use the owner connection. Empty Supabase env keeps the demo cookie and `getDb()`.
- A service-role JWT placed in `NEXT_PUBLIC_SUPABASE_ANON_KEY` is ignored.

### Follow-up timing

- A proposal the client opened is drafted after 1 day. One that was never opened waits 3 days. The two drafts read differently. Both stay pending until someone approves them.
- Signing, declining, or moving the deal to won or lost dismisses the pending proposal and quiet-lead drafts. The follow-up scan does the same if a draft is still open.
- Today lists drafts waiting for approval and links to Follow-ups. It does not send them.
- After an approved nudge, a still-open proposal gets an office call task (4 days if viewed, 7 if never opened). That task is not a second client email.

### Receipt review

- A receipt read now picks up a purchase date and priced lines when the text has them, plus the vendor and total. Demo samples still resolve Casa Tile, Harbor Plumbing, and Summit Lumber.
- The suggested cost code comes from this company's price book and past costs. If several codes match, the field stays blank. Nothing outside that list is invented.
- Reading a receipt shows a review form. Posting is a separate button. A low-confidence read cannot skip that. Today lists receipts that are not on a job yet.

### Office RLS (remaining)

- Job detail, estimates, the price book, tasks, activity, and copilot sources use the same verified-claim session as the office lists. Queries still filter `org_id`.
- Office creates and updates (contacts, leads, estimates, costs, change orders, invoices, tasks, settings) use that session when Auth is on, so `WITH CHECK` applies. Sending a proposal or change order stays a button.
- Portal, pay, Stripe webhooks, follow-up cron, and seed stay on the owner connection. The first sign-in still writes `auth_user_id` there, before a member JWT exists. SQLite cannot `SET ROLE`; the claim check still blocks the other company, and the authenticated role is Postgres.

## 2026-10-03

### Security and money

- Production and Vercel require `CRON_SECRET` before `/api/cron/follow-ups` can scan companies.
- Unsigned Stripe webhooks are rejected on a public deploy unless `FIELDLINE_ALLOW_DEMO_WEBHOOK=1`.
- File downloads return 404 for another company, stay inside the data directory, and do not serve active SVG as a page.
- Estimate lines, costs, and typed dollar amounts reject negatives and amounts over $10,000,000. Field staff cannot download the invoice CSV.
- Estimate photos are limited to the signed-in company.

### Postgres

- `DATABASE_URL` migrates and seeds Postgres on boot. An empty URL still uses the SQLite demo.
- Foreign keys are applied after the tables exist. Tests run the same seed against in-memory Postgres.

### Main flow

- Proposal, invoice, and portal routes have a loading skeleton and a retry state.
- The office shell has a skip link and marks the current section. Pay, pipeline, contacts, and change orders name their fields.

### CI

- `npm run check` runs lint, `tsc --noEmit`, tests, and `next build`.

### Stripe test mode

- With `sk_test_` and `pk_test_`, the pay page creates one PaymentIntent per invoice and amount (ACH first, card optional) and stores the id on the payment row.
- A verified `payment_intent.succeeded` webhook marks the invoice paid once. Processing and failed events do not.
- Empty Stripe keys keep the local test-number mirror. Live keys are refused. Connect and platform fees are not wired.

### Supabase Auth

- `NEXT_PUBLIC_SUPABASE_URL` plus an anon or publishable key signs in through Supabase and stores `users.auth_user_id` on the matching membership. `src/proxy.ts` refreshes that session with `getClaims()`.
- Empty Supabase env keeps the demo password and the HMAC cookie. `SUPABASE_SERVICE_ROLE_KEY` is server-only.

### Margin watch

- Open jobs warn when a cost code reaches 80% of its budget, and again when spend passes that budget.
- An overrun with no draft, sent, or approved change order offers a one-click draft. The draft is not sent to the client.
- Today and the job page list the code, percent, and overage. Copilot mentions the same codes on margin questions.
