import type { CrmData } from "@/lib/crm-parser";

export const DEMO_CRM_DATA: CrmData = {
  fetchedAt: new Date().toISOString(),
  contactsCount: 6,
  companiesCount: 1,
  contactsCsv: `firstname,lastname,email,age,membership_level,membership_startdate,city,country
Alex,Miller,alex@example.com,28,gold,2024-01-10,Stockholm,Sweden
Priya,Shah,priya@example.com,35,silver,2023-06-14,Berlin,Germany
Leo,Nguyen,leo@example.com,23,bronze,2025-02-01,Copenhagen,Denmark
Maya,Ross,maya@example.com,41,gold,2022-11-25,Amsterdam,Netherlands
Jonas,Pettersson,jonas@example.com,32,silver,2024-09-09,Oslo,Norway
Sara,Khan,sara@example.com,29,bronze,2025-01-11,Helsinki,Finland`,
  companiesCsv: `name,domain,description,hs_logo_url
Mark Demo Company,markdemo.dev,"BRAND_NAME: Mark Demo
VOICE: Friendly, confident, practical.
PRIMARY_COLOR: #7c3aed
SECONDARY_COLOR: #ffffff
ACCENT_COLOR: #f59e0b
REQUIRED: unsubscribe, privacy policy
LEGAL_FOOTER: Copyright 2026 Mark Demo Co. All rights reserved.",https://dummyimage.com/120x40/7c3aed/ffffff.png&text=MARK`,
};
