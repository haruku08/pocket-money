# Pocket Money / Sackgeld

A small app to see where pocket money goes: PostFinance and Revolut balances, scooter gas, parking, several debts (like the driving licence), job income, and a "what if" planner. German and English.

Open it at **https://haruku08.github.io/pocket-money/**

Everything is saved in the browser on your own phone. Nothing is sent anywhere.

The app has four tabs: **Home** (balance, what is left until payday, what to pay this month), **History** (all entries, and a breakdown per week or month), **Plan** (a "what if" planner) and **Setup** (split into Money, Sharing and App).

- **Setup → Sharing → Send to parent** shares a link with all entries. Opening it shows a read-only view.
- **Setup → App → Copy backup code** keeps a copy you can restore on a new phone.

## Install on the phone

Open the link in Safari (iPhone) or Chrome (Android) and use **Add to Home Screen** / **Install app**. It then works offline too.

## Live sync to a Google Sheet (optional)

`google-sheet-sync.gs` is a small Google Apps Script. Paste it into the Sheet (Extensions → Apps Script), deploy it as a web app (Execute as: Me, Who has access: Anyone), and paste the web app link into the app under **Setup → Sharing → Google Sheet sync**. Every entry then shows up in the Sheet (deleted ones stay, crossed out). Tick **Approved** or write a **Parent note** and it shows up in the app. Debts are managed only in the Sheet's **Debts** tab.

## Family sync (Supabase)

Setup → Sharing → **Family sync** connects the phones through the Supabase project "Haruku Apps" (schema `pocket_money`, set up by `supabase/001_pocket_money.sql`).

- The parent taps **Are you the parent? → Create family** on their own phone. That phone becomes the parent view and shows a one-time code for the child's phone.
- The child types the code in Setup → Sharing → Family sync. From then on every entry is saved online, approvals and notes come back, and debts come from the parent.
- The parent sets the allowance under Setup → Money: per month (on a day of the month) or per week (on a weekday). A weekly allowance counts the real paydays, so a month with five gets five payments.
- Under **Plan**, the parent's **Allowance check** takes a start date and shows the allowance from then until today, plus any extra allowance the parent gave, minus what the child logged as spent.
- The parent view shows the child's app read-only, with **Approve** and **Note** on each entry, deleted entries at the bottom of the log, and the debt list under Setup → Money.

The database only answers the `pm_*` functions, and each one checks the phone's own secret key. The Google Sheet sync keeps working next to it.

## Releasing a new version

1. Change the app in `index.html`.
2. Raise `APP_VERSION`, `APP_DATE` and `NOTES` near the top of the script in `index.html`.
3. Put the same version and notes into `version.json`. A GitHub check fails if the two versions differ.

Phones see "New version ready" on Home and under **Setup → App → App version**, and update with one tap. The app saves a copy of the data before each update, which can be restored from the same box.
