# Setting up Team Cards (about 30 minutes, £0)

You'll use four free accounts. Do the steps in order.

| Account | Used for |
| --- | --- |
| GitHub: davidclancy-smith-chatgpt | Holds the code and hosts the website |
| Supabase (sign in with that GitHub account) | Stores cards, messages and pictures |
| Gmail: teamcardsdcs@gmail.com | Sends the emails |
| GIPHY developer key | GIF search |

Your website will be at **https://davidclancy-smith-chatgpt.github.io/teamcardsdcs/**

---

## 1. Put the code on GitHub

1. Open https://github.com/davidclancy-smith-chatgpt/teamcardsdcs while signed in as **davidclancy-smith-chatgpt**.
2. Click **Add file > Upload files**.
3. Unzip `teamcardsdcs.zip`, open the folder, select **everything inside it** (the `assets`, `supabase` and `apps-script` folders plus `index.html` and the other files) and drag them onto the page.
4. Click **Commit changes**.
5. Go to **Settings > Pages**. Under "Build and deployment", set Source to **Deploy from a branch**, Branch to **main** and folder to **/ (root)**, then **Save**.
6. After a minute or two, the site address appears at the top of that page. Opening it shows "Almost there" until step 4 is done.

## 2. Create the database (Supabase)

1. Go to https://supabase.com, click **Start your project** and choose **Continue with GitHub** (as davidclancy-smith-chatgpt). No card is needed.
2. Click **New project**. Name: `teamcards`. Region: **London (eu-west-2)**. Set a database password and save it somewhere safe. Choose the **Free** plan.
3. When it's ready, open **SQL Editor > New query**.
4. Open `supabase/schema.sql`, copy all of it, and paste it in.
5. **Scroll to the very last line and change `change-me` to your team code**, such as a short phrase your team will remember. People type it when creating a card, which stops strangers using your Gmail to send emails.
6. Click **Run**. You should see "Success. No rows returned".
7. Go to **Project Settings > API Keys** and keep this tab open. You need three things:
   - **Project URL** (looks like `https://abcd1234.supabase.co`; under Project Settings > Data API if it isn't on this page)
   - **Publishable key** (starts `sb_publishable_`), or the legacy **anon** key
   - **Secret key** (starts `sb_secret_`, click to reveal), or the legacy **service_role** key. **Never put this one in GitHub.**

To change the team code later, run this in the SQL Editor:
`update app_settings set create_code = 'new code';`

## 3. Get a GIPHY key

1. Go to https://developers.giphy.com and sign in (any account; teamcardsdcs@gmail.com is fine).
2. Click **Create an API Key**, choose **API** (not SDK), name it `Team Cards`, and copy the key.
3. The free "beta" key allows 100 searches an hour, which is plenty. The app already shows "Powered by GIPHY", as GIPHY requires.

## 4. Connect the website to the database

1. On GitHub, open `assets/config.js` and click the pencil icon to edit.
2. Replace the three placeholder values with your **Project URL**, **Publishable key** and **GIPHY key**.
3. Click **Commit changes**. The site updates within a minute or two.

## 5. Switch on the emails (Google Apps Script)

1. In a browser signed in **only** as teamcardsdcs@gmail.com (a private window is easiest), go to https://script.google.com and click **New project**.
2. Click "Untitled project" and rename it `Team Cards`.
3. Delete the sample code, then paste in all of `apps-script/Code.gs`. Press Ctrl+S (or Cmd+S).
4. Click the **gear icon (Project Settings)**, scroll to **Script properties**, and add three:

   | Property | Value |
   | --- | --- |
   | `SUPABASE_URL` | your Project URL |
   | `SUPABASE_SECRET_KEY` | your Secret key |
   | `SITE_URL` | `https://davidclancy-smith-chatgpt.github.io/teamcardsdcs/` |

5. Go back to the **Editor** (the `<>` icon). In the toolbar's function menu, choose **setup** and click **Run**.
6. Google asks for permission. Click **Review permissions**, pick teamcardsdcs@gmail.com, then **Advanced > Go to Team Cards (unsafe)** and **Allow**. It says "unsafe" only because you wrote the script yourself and Google hasn't reviewed it.
7. The log should say "Set up. Emails left today: 100".

From now on the script runs every 5 minutes. Each time, it sends queued emails, sends reminders, tells organisers when cards are ready, delivers scheduled cards and deletes cards 90 days after sending. Its regular checks also stop Supabase pausing the project.

## 6. Test it

1. Open your site and create a card for yourself, with your own email as both recipient and signer.
2. Within 5 minutes you should get the "set up" email and the invite. **Check junk**, and mark the sender as safe if needed.
3. Sign it, then press **Send now** on the manage page. The card arrives within 5 minutes.

Before rolling it out, tell the team that emails will come from **teamcardsdcs@gmail.com** and ask them to add it to their contacts or safe senders.

---

## Limits to know

- **Emails:** 100 a day (a Gmail limit). Emails over the limit wait in the queue and go out the next day.
- **Pictures:** 1 GB in total. Photos are shrunk before upload and cards are deleted 90 days after sending.
- **People:** up to 80 people when you create a card, and up to 120 per card in total.

## If something goes wrong

- **The site says "Almost there":** `assets/config.js` still has placeholder values.
- **No emails arrive:** in Apps Script, open **Executions** to see errors, and check that the three Script properties are spelled exactly as shown.
- **"That team code is not right":** the code is case-sensitive. Change it with the SQL above.
- **The Supabase project was paused:** open the Supabase dashboard and click **Restore**. The 5-minute script should keep it awake.
