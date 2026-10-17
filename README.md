# Pocket Money / Sackgeld

A small app to see where pocket money goes: PostFinance and Revolut balances, scooter gas, parking, several debts (like the driving licence), job income, and a "what if" planner. German and English.

Open it at **https://haruku08.github.io/pocket-money/**

Everything is saved in the browser on your own phone. Nothing is sent anywhere.

- **Setup → Send to parent** shares a link with all entries. Opening it shows a read-only view.
- **Setup → Copy backup code** keeps a copy you can restore on a new phone.

## Install on the phone

Open the link in Safari (iPhone) or Chrome (Android) and use **Add to Home Screen** / **Install app**. It then works offline too.

## Live sync to a Google Sheet (optional)

`google-sheet-sync.gs` is a small Google Apps Script. Paste it into the Sheet (Extensions → Apps Script), deploy it as a web app (Execute as: Me, Who has access: Anyone), and paste the web app link into the app under **Setup → Live sync**. Every entry then shows up in the Sheet (deleted ones stay, crossed out). Tick **Approved** or write a **Parent note** and it shows up in the app. Debts are managed only in the Sheet's **Debts** tab.
