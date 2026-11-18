# Enout WhatsApp BD Outreach & Airtable Sync System

A complete multi-executive web dashboard and automation engine built for **8 Business Development (BD) Executives** to run personalized WhatsApp outreach campaigns from **Airtable Views** or **CSV files**, complete with a mandatory **Demo Run Verification Gate** and automatic **Airtable Post-Shoot Field Updates**.

---

## ✨ Key System Features

1. **👥 8 BD Executive Workspaces (`bd-exec-1` to `bd-exec-8`)**:
   - Each BD executive has a dedicated workspace seat and isolated WhatsApp `LocalAuth` session.
   - Live QR code generation directly in the browser UI for linking WhatsApp accounts (`Settings -> Linked Devices -> Link a Device`), plus a Sandbox/Simulation mode for instant verification.
2. **📊 Dual Data Sources (Hardcoded Airtable Base/Table + CSV Upload)**:
   - **Airtable View Mode**: Hardcoded to Base `appxUfmx7hibOaBNb` and Table `Main`. BD executives simply enter the **Airtable View Name** (e.g. `reapply march 21`, `enout test view`, `batch shortlist 2026`) and click **Fetch View**.
   - **CSV Share/Upload Mode**: Upload any `.csv` file or use built-in presets (`test_contacts.csv` with test numbers `92173 54399` and `86900 22224`, or `file.csv`).
3. **📝 Message Template Engine & Dynamic Variable Pointing**:
   - Built-in templates (`Hi {{name}} , From enout`, AlgoUniversity Accelerator Camp Screening, Top 5% Selection) and live custom template editor.
   - Automatic variable detection (`{{name}}`, `{{Full Name}}`, `{}`) with interactive column-pointing dropdowns and live Record #1 preview.
4. **🔍 Step 1: Mandatory Demo Run & Verification Gate**:
   - Audits all loaded records to verify that every template variable points to a non-empty column and all phone numbers are valid.
   - Fires a test shoot to designated test phone numbers (`92173 54399`, `86900 22224`) and displays the rendered output before unlocking the bulk **Shoot Campaign** button.
5. **🚀 Step 2: Bulk Campaign Shoot & Automatic Airtable Field Updates**:
   - Dispatches personalized WhatsApp messages with configurable rate-limiting delay.
   - Automatically `PATCH`es specific fields under that Airtable record once shot (e.g. `WA scheduling message sent: true`, `Outreach Status: "Messaged - Enout"`).

---

## 🚀 Quick Start

```bash
npm install
npm start
```

Open **`http://localhost:3030`** in your browser.
