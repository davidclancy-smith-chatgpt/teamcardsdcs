# Team Cards

A free group card app for the team. Upload a cover, add everyone's email, and each person gets a link to sign the card. They can pick from six typefaces and eight colours and add a photo or a GIPHY GIF. Once everyone has signed or the deadline passes, the organiser sends the card to the recipient.

- **Website:** static HTML/JS on GitHub Pages (`index.html`, `assets/`)
- **Data and pictures:** Supabase free tier (`supabase/schema.sql`)
- **Emails, reminders, scheduled sends and clean-up:** Google Apps Script on a Gmail account (`apps-script/Code.gs`)

There are no logins. Each person's link is a long random key.

| Link | Who | What it does |
| --- | --- | --- |
| `?m=…` | Organiser | Manage the card, nudge people, hide messages, preview, send now or later |
| `?s=…` | Signer | Write, edit or remove their message |
| `?o=…` | Anyone with the latecomer link | Add themselves and sign |
| `?v=…` | Recipient | Open the card (with confetti), save as PDF, send a thank-you |

Setup steps are in [SETUP.md](SETUP.md).
